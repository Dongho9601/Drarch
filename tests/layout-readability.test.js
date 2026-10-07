import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { compile } from '../src/index.js';
import { layout, toLayoutIR } from '../src/layout.js';
import { componentPresentation, textWidth } from '../src/renderer/presentation.js';

const epsilon = 0.01;
const overlaps = (a, b) => a.x < b.x + b.width - epsilon && a.x + a.width > b.x + epsilon
  && a.y < b.y + b.height - epsilon && a.y + a.height > b.y + epsilon;
const contains = (a, b) => b.x >= a.x - epsilon && b.y >= a.y - epsilon
  && b.x + b.width <= a.x + a.width + epsilon && b.y + b.height <= a.y + a.height + epsilon;
const onBoundary = (p, b) => contains(b, { ...p, width: 0, height: 0 })
  && [p.x - b.x, p.x - b.x - b.width, p.y - b.y, p.y - b.y - b.height].some(n => Math.abs(n) < epsilon);

function segmentCrossesBox(a, b, box) {
  if (Math.abs(a.x - b.x) < epsilon) {
    return a.x > box.x + epsilon && a.x < box.x + box.width - epsilon
      && Math.min(a.y, b.y) < box.y + box.height - epsilon && Math.max(a.y, b.y) > box.y + epsilon;
  }
  assert.ok(Math.abs(a.y - b.y) < epsilon, 'connection segment must remain orthogonal');
  return a.y > box.y + epsilon && a.y < box.y + box.height - epsilon
    && Math.min(a.x, b.x) < box.x + box.width - epsilon && Math.max(a.x, b.x) > box.x + epsilon;
}

function assertReadable(model, geometry) {
  const boxes = new Map(geometry.nodes.map(n => [n.id, n]));
  const semanticEdges = new Map(model.connections.map(e => [e.id, e]));
  const labels = geometry.edges.flatMap(e => e.labels.map(l => ({ ...l, edge: e.id })));
  const canvas = { x: 0, y: 0, width: geometry.width, height: geometry.height };
  for (const label of labels) {
    assert.ok(contains(canvas, label), `${label.edge} label leaves the canvas`);
    for (const node of geometry.nodes) assert.ok(!overlaps(label, node), `${label.edge} label covers ${node.id}`);
    for (const line of label.lines) assert.ok(textWidth(line, 13) <= label.width - 12 + epsilon, 'label measurement matches its font');
    assert.equal(label.height, label.lines.length * 20 + 8);
  }
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    assert.ok(!overlaps(labels[i], labels[j]), `${labels[i].edge} and ${labels[j].edge} labels overlap`);
  }
  for (const edge of geometry.edges) {
    const semantic = semanticEdges.get(edge.id);
    assert.ok(onBoundary(edge.paths[0][0], boxes.get(semantic.source)), `${edge.id} misses its source`);
    assert.ok(onBoundary(edge.paths.at(-1).at(-1), boxes.get(semantic.target)), `${edge.id} misses its target`);
    for (const path of edge.paths) for (let i = 1; i < path.length; i++) {
      for (const node of geometry.nodes) {
        if (node.id === semantic.source || node.id === semantic.target) continue;
        assert.ok(!segmentCrossesBox(path[i - 1], path[i], node), `${edge.id} crosses unrelated component ${node.id}`);
      }
      for (const label of labels) {
        if (label.edge === edge.id) continue;
        assert.ok(!segmentCrossesBox(path[i - 1], path[i], label), `${label.edge} label hides ${edge.id}`);
      }
    }
  }
  for (const group of geometry.groups) {
    assert.ok(group.titleLines.length, `${group.id} has no visible title`);
    const title = { x: group.x + 20, y: group.y + 15,
      width: Math.max(...group.titleLines.map(line => textWidth(line, 15))), height: group.titleLines.length * 20 };
    assert.ok(contains(group, title), `${group.id} title leaves its group`);
    for (const label of labels) assert.ok(!overlaps(title, label), `${label.edge} covers the ${group.id} title`);
    for (const child of [...model.components, ...model.groups].filter(c => c.parent === group.id)) {
      const box = [...geometry.nodes, ...geometry.groups].find(b => b.id === child.id);
      assert.ok(box.y >= group.y + group.headerHeight - epsilon, `${child.id} covers the ${group.id} heading`);
    }
  }
}

test('every example keeps labels, routes, and group headings readable', async () => {
  const directory = new URL('../examples/', import.meta.url);
  for (const filename of (await readdir(directory)).filter(f => f.endsWith('.drarch')).sort()) {
    const model = compile(await readFile(new URL(filename, directory), 'utf8'));
    assertReadable(model, await layout(model));
  }
});

test('long nested and empty group titles wrap without widening the entire architecture', async () => {
  const model = compile(`arch A {
    group outer {
      label: "${'Memory subsystem with long descriptive labels '.repeat(5)}"
      group inner {
        label: "${'Inner group title '.repeat(10)}"
        generic a {} generic b {} a -> b
      }
    }
    group empty { label: "${'Empty group with a long descriptive heading '.repeat(4)}" }
  }`);
  const geometry = await layout(model);
  assertReadable(model, geometry);
  for (const group of geometry.groups) {
    assert.ok(group.titleLines.length > 1);
    assert.equal(group.headerHeight, 58 + (group.titleLines.length - 1) * 20);
  }
  assert.ok(geometry.width < 1200, `long headings inflated the canvas to ${geometry.width}px`);
  assert.deepEqual(geometry, await layout(model), 'wrapping remains deterministic');
});

test('vertical columns keep long internal labels clear of incoming and feedback paths', async () => {
  const model = compile(`arch A {
    generic start {} generic a {} generic b {} generic c {} generic end {}
    start -> b { label: "Long incoming signal and its description" }
    a -> b { label: "A signal with a very long label that occupies more than one line" }
    b -> c { label: "Another long internal signal label" }
    a -> end { type: request } c -> end { type: request } end -> b { type: response }
    layout { columns: [start, [a, b, c], end] }
  }`);
  const before = JSON.stringify(model);
  const geometry = await layout(model);
  assertReadable(model, geometry);
  assert.equal(JSON.stringify(model), before, 'layout changed the architecture source model');
  const boxes = Object.fromEntries(geometry.nodes.map(n => [n.id, n]));
  assert.ok(boxes.a.y + boxes.a.height < boxes.b.y && boxes.b.y + boxes.b.height < boxes.c.y);
  const response = geometry.edges.find(e => e.id === 'end->b#1');
  assert.ok(response.paths[0][0].x > response.paths.at(-1).at(-1).x, 'feedback arrow lost its semantic direction');
});

test('layout reserves the full connection-aware component presentation', () => {
  const model = compile('arch A { generic a {} generic b {} mux choose { inputs: 2 } generic out {} a -> choose b -> choose choose -> out }');
  const ir = toLayoutIR(model);
  for (const component of model.components) {
    const presentation = componentPresentation(component, model.connections);
    const node = ir.nodes.find(n => n.id === component.id);
    assert.equal(node.width, presentation.width);
    assert.equal(node.height, presentation.height);
  }
});
