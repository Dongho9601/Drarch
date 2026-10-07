import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Resvg } from '@resvg/resvg-js';
import { compile, render } from '../src/index.js';
import { layout } from '../src/layout.js';
import { renderSVG } from '../src/renderer/svg.js';
import { componentPresentation } from '../src/renderer/presentation.js';

const inside = (a, b) => a.x >= b.x - 0.01 && a.y >= b.y - 0.01 && a.x + a.width <= b.x + b.width + 0.01 && a.y + a.height <= b.y + b.height + 0.01;
const overlaps = (a, b) => a.x < b.x + b.width - 0.01 && a.x + a.width > b.x + 0.01 && a.y < b.y + b.height - 0.01 && a.y + a.height > b.y + 0.01;
const onBoundary = (p, box) => {
  const near = (a, b) => Math.abs(a - b) < 0.01;
  return ((near(p.x, box.x) || near(p.x, box.x + box.width)) && p.y >= box.y - .01 && p.y <= box.y + box.height + .01)
    || ((near(p.y, box.y) || near(p.y, box.y + box.height)) && p.x >= box.x - .01 && p.x <= box.x + box.width + .01);
};
function assertGeometry(model, geometry) {
  assert.equal(geometry.nodes.length, model.components.length);
  assert.equal(geometry.groups.length, model.groups.length);
  assert.equal(geometry.edges.length, model.connections.length);
  const boxes = new Map([...geometry.nodes, ...geometry.groups].map(n => [n.id, n]));
  const bounds = { x: 0, y: 0, width: geometry.width, height: geometry.height };
  for (const node of [...geometry.nodes, ...geometry.groups]) {
    assert.ok(Object.values(node).filter(v => typeof v === 'number').every(Number.isFinite));
    assert.ok(inside(node, bounds), `${node.id} is outside diagram`);
  }
  for (const component of [...model.components, ...model.groups]) {
    if (component.parent) assert.ok(inside(boxes.get(component.id), boxes.get(component.parent)), `${component.id} escaped its group`);
  }
  for (let i = 0; i < geometry.nodes.length; i++) {
    for (let j = i + 1; j < geometry.nodes.length; j++) assert.ok(!overlaps(geometry.nodes[i], geometry.nodes[j]), 'components overlap');
  }
  for (const edge of geometry.edges) {
    const semantic = model.connections.find(e => e.id === edge.id);
    assert.ok(onBoundary(edge.paths[0][0], boxes.get(semantic.source)), `${edge.id} start misses source`);
    assert.ok(onBoundary(edge.paths.at(-1).at(-1), boxes.get(semantic.target)), `${edge.id} end misses target`);
    for (const path of edge.paths) for (const point of path) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
    for (const label of edge.labels) {
      assert.ok(inside(label, bounds), 'edge label outside diagram');
      for (const node of geometry.nodes) assert.ok(!overlaps(label, node), `${edge.id} label overlaps ${node.id}`);
    }
  }
}

test('all examples have finite, nonoverlapping geometry and rasterize as standalone SVGs', async () => {
  const directory = new URL('../examples/', import.meta.url);
  for (const filename of (await readdir(directory)).filter(f => f.endsWith('.drarch'))) {
    const model = compile(await readFile(new URL(filename, directory), 'utf8'));
    const before = JSON.stringify(model), geometry = await layout(model);
    assertGeometry(model, geometry);
    assert.equal(JSON.stringify(model), before, 'rendering mutated semantic IR');
    const svg = renderSVG(model, geometry);
    const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
    assert.equal(dom.window.document.querySelectorAll('script').length, 0);
    assert.equal(dom.window.document.querySelectorAll('.edge-line[marker-end]').length, model.connections.length);
    assert.equal(dom.window.document.querySelectorAll('.edge-line[marker-start]').length, model.connections.filter(e => e.bidirectional).length);
    assert.ok(new Resvg(svg).render().asPng().length > 1000);
    dom.window.close();
  }
});

test('default ordering follows connections and survives declaration order and queue-depth edits', async () => {
  const a = compile('arch A { generic z {} queue middle { depth: 16 } generic a {} z -> middle middle -> a }');
  const b = compile('arch A { generic a {} queue middle { depth: 32 } generic z {} z -> middle middle -> a }');
  const first = await layout(a), second = await layout(b);
  assert.deepEqual(first, second);
  const nodes = new Map(first.nodes.map(n => [n.id, n]));
  assert.ok(nodes.get('z').x < nodes.get('middle').x);
  assert.ok(nodes.get('middle').x < nodes.get('a').x);
  assert.deepEqual(first, await layout(a));
});

test('README core product edit puts an 8-cycle L2 below PE and keeps backpressure directed upstream', async () => {
  const model = compile(await readFile(new URL('../examples/queue_scheduler_pe.drarch', import.meta.url), 'utf8'));
  const geometry = await layout(model);
  assertGeometry(model, geometry);
  const nodes = new Map(geometry.nodes.map(n => [n.id, n]));
  const { pe, l2, requests, sched } = Object.fromEntries(nodes);
  assert.ok(requests.x < sched.x && sched.x < pe.x);
  assert.ok(l2.y > pe.y + pe.height);
  assert.ok(l2.x < pe.x + pe.width && l2.x + l2.width > pe.x);
  const backpressure = geometry.edges.find(e => e.id === 'sched->requests#1');
  assert.ok(backpressure.paths[0][0].x > backpressure.paths.at(-1).at(-1).x);
  assert.equal(model.components.find(c => c.id === 'l2').properties.latency.value, '8');
});

for (const [name, source] of [
  ['empty architecture', 'arch A {}'],
  ['empty group', 'arch A { group empty {} }'],
  ['disconnected nodes', 'arch A { generic a {} generic b {} generic c {} }'],
  ['self-loop and repeated edges', 'arch A { generic a {} generic b {} a -> a { type: dependency } a -> b a -> b b -> a }'],
  ['cycle with conflicting hints', 'arch A { generic a {} generic b {} generic c {} a -> b b -> c c -> a layout { columns: [c, b, a] } }'],
  ['partial hints', 'arch A { generic a {} generic b {} generic c {} a -> b b -> c layout { columns: [b] } }'],
  ['vertical feedback and self-loop', 'arch A { generic a {} generic b {} a -> b b -> a { type: backpressure } b -> b layout { columns: [[a,b]] } }'],
  ['columns within nested groups', 'arch A { group g { generic a {} generic b {} a -> b layout { columns: [[a,b]] } } generic c {} c -> g.a g.b -> c { type: response } }'],
  ['group order hints', 'arch A { group a { generic x {} } group b { generic y {} } a.x -> b.y layout { columns: [b,a] } }'],
]) test(`layout handles ${name}`, async () => {
  const model = compile(source);
  const geometry = await layout(model);
  assertGeometry(model, geometry);
});

test('compact count, per-instance throughput, defaults and explicit display overrides', async () => {
  const model = compile('arch A { compute pe { label: "PE" count: 4 throughput: 1 op/cycle } compute hidden { count: 8 throughput: 2 op/cycle display: [] } generic g { width: 4 } }');
  const byId = new Map(model.components.map(c => [c.id, c]));
  assert.equal(componentPresentation(byId.get('pe')).title, 'PE ×4');
  assert.match(componentPresentation(byId.get('pe')).propertyLines.join(' '), /1 op\/cycle.*instance/);
  assert.equal(componentPresentation(byId.get('hidden')).title, 'hidden ×8');
  assert.deepEqual(componentPresentation(byId.get('hidden')).propertyLines, []);
  assert.deepEqual(componentPresentation(byId.get('g')).propertyLines, []);
  assert.equal((await layout(model)).nodes.length, 3);
});

test('long Unicode labels and custom properties produce valid XML and wrap within measured blocks', async () => {
  const model = compile(`arch A { generic g { label: "메모리 ${'a very long label '.repeat(5)}" constructor: "safe" display: [constructor] } }`);
  const p = componentPresentation(model.components[0]);
  assert.ok(p.titleLines.length > 1);
  const svg = await render(model, { format: 'svg' });
  assert.ok(new Resvg(svg).render().asPng().length > 1000);
});

test('offline HTML viewer supports selection, keyboard, tooltip, zoom and hostile text safely', async () => {
  const attack = '</script><script>globalThis.drarchInjected = true</script><img src="https://invalid.example">';
  const model = compile(`arch A { desc: "Overview" queue q { label: "Queue" desc: ${JSON.stringify(attack)} depth: 32 } compute pe { count: 4 throughput: 1 op/cycle } q -> pe { desc: "Carries requests." type: request } }`);
  const html = await render(model);
  const consoleErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => consoleErrors.push(error));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'file:///offline/diagram.html', virtualConsole,
    beforeParse(window) {
      // jsdom has no layout engine. Provide only browser geometry primitives;
      // SVG placement itself is checked against ELK above.
      Object.defineProperty(window.SVGElement.prototype, 'viewBox', { get() { return { baseVal: { width: 1000, height: 400 } }; } });
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 1000; } });
    },
  });
  const { window } = dom, document = window.document;
  try {
    assert.deepEqual(consoleErrors, []);
    assert.equal(window.drarchInjected, undefined);
    assert.equal(document.querySelectorAll('script').length, 2);
    assert.equal(document.querySelectorAll('script[src], link[href], img[src], iframe, object').length, 0);
    assert.match(document.querySelector('[http-equiv="Content-Security-Policy"]').content, /default-src 'none'/);
    const queue = document.querySelector('[data-key="component:q"]');
    const pe = document.querySelector('[data-key="component:pe"]');
    const positions = [...document.querySelectorAll('[data-key]')].map(e => e.getAttribute('transform'));
    queue.dispatchEvent(new window.Event('pointerenter'));
    assert.equal(document.getElementById('tooltip').hidden, false);
    assert.equal(document.getElementById('tooltip').textContent, attack);
    queue.dispatchEvent(new window.MouseEvent('click'));
    assert.equal(document.getElementById('inspector-desc').textContent, attack);
    assert.equal(document.getElementById('inspector-title').textContent, 'Queue');
    assert.equal(document.querySelectorAll('img').length, 0);
    pe.dispatchEvent(new window.FocusEvent('focus'));
    assert.equal(document.getElementById('tooltip').hidden, true, 'empty desc should not open tooltip');
    pe.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
    assert.match(document.getElementById('inspector-properties').textContent, /Throughput \(per instance\)1 op\/cycle/);
    assert.ok(pe.classList.contains('selected'));
    assert.deepEqual([...document.querySelectorAll('[data-key]')].map(e => e.getAttribute('transform')), positions);
    const svg = document.querySelector('svg'), previousWidth = parseFloat(svg.style.width);
    document.getElementById('zoom-in').click();
    assert.ok(parseFloat(svg.style.width) > previousWidth);
    document.getElementById('fit').click();
    assert.equal(parseFloat(svg.style.width), previousWidth);
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.equal(document.getElementById('inspector-title').textContent, 'A');
    assert.equal(document.querySelectorAll('.selected').length, 0);
  } finally { window.close(); }
});
