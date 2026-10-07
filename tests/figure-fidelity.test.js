import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { Resvg } from '@resvg/resvg-js';
import { compile, render } from '../src/index.js';
import { componentPresentation } from '../src/renderer/presentation.js';

const presentation = (model, id) => componentPresentation(model.components.find(c => c.id === id), model.connections);

test('display suppression retains declared arbitration, ratios, policy, and repeated instances', async () => {
  const model = compile(`arch A {
    generic a { behavior: arbitration inputs: 4 outputs: 1 policy: round_robin display: [] }
    mux m { inputs: 8 display: [] } demux d { outputs: 3 display: [] }
    crossbar x { inputs: 2 outputs: 4 display: [] }
    compute pe { count: 16 throughput: 4 op/cycle display: [] }
    generic unknown { inputs: 3 outputs: 1 display: [] }
  }`);
  assert.deepEqual(presentation(model, 'a').topologyLines, ['Arbitration: 4 → 1', 'Policy: round robin']);
  assert.deepEqual(presentation(model, 'm').topologyLines, ['Selection: 8 → 1']);
  assert.deepEqual(presentation(model, 'd').topologyLines, ['Dispatch: 1 → 3']);
  assert.deepEqual(presentation(model, 'x').topologyLines, ['Routing: 2 → 4']);
  assert.deepEqual(presentation(model, 'unknown').topologyLines, ['Declared I/O: 3 → 1']);
  assert.equal(presentation(model, 'pe').title, 'pe ×16');
  assert.deepEqual(presentation(model, 'pe').propertyLines, []);
  for (const format of ['svg', 'html']) {
    const dom = new JSDOM(await render(model, { format }));
    assert.match(dom.window.document.querySelector('.drarch-diagram').textContent, /Arbitration: 4 → 1/);
    dom.window.close();
  }
});

test('unannotated convergence and divergence remain visible without implying arbitration or broadcast', () => {
  const model = compile(`arch A {
    generic a {} generic b {} generic middle {} generic c {} generic d {}
    a -> middle { type: request display: [] }
    a -> middle { type: request display: [] }
    b -> middle { type: request display: [] }
    middle -> c { type: request display: [] }
    middle -> d { type: request display: [] }
    middle -> a { type: backpressure display: [] }
  }`);
  const p = presentation(model, 'middle');
  assert.deepEqual(p.topologyLines, ['Request peers: 2 in / 2 out']);
  assert.doesNotMatch(p.topologyLines.join(' '), /[Aa]rbitration|[Bb]roadcast/);
  assert.deepEqual(presentation(model, 'b').topologyLines, [], 'single canonical path stays compact');
});

test('unknown primitive dimensions and unspecified arbitration policy remain explicit', () => {
  const model = compile('arch A { mux m {} generic a { behavior: arbitration inputs: 2 outputs: 1 } }');
  assert.deepEqual(presentation(model, 'm').topologyLines, ['Selection: ? → 1']);
  assert.ok(presentation(model, 'a').topologyLines.includes('Policy: unspecified'));
});

test('static figures carry architecture title, used-flow legend, and topology interpretation', async () => {
  const model = compile('arch A { label: "A readable figure" generic a {} generic b {} a -> b { type: credit label: "returned slot" } }');
  const svg = await render(model, { format: 'svg' });
  const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
  assert.equal(dom.window.document.querySelector('.figure-title').textContent, 'A readable figure');
  assert.deepEqual([...dom.window.document.querySelectorAll('.figure-legend text')].map(e => e.textContent), ['Credit']);
  assert.match([...dom.window.document.querySelectorAll('.figure-note')].map(e => e.textContent).join(' '), /distinct connected blocks per flow/);
  assert.ok(new Resvg(svg).render().asPng().length > 1000);
  dom.window.close();
});

test('request arbitration example states retention/acceptance and renders its competing producers', async () => {
  const source = await readFile(new URL('../examples/arbitrated_requests.drarch', import.meta.url), 'utf8');
  const model = compile(source);
  const arb = model.components.find(c => c.id === 'arb');
  assert.match(arb.desc, /no request is consumed and priority does not advance/);
  assert.deepEqual(presentation(model, 'arb').topologyLines, [
    'Arbitration: 2 → 1', 'Policy: round robin',
    'Request peers: 2 in / 1 out', 'Backpressure peers: 1 in / 2 out',
  ]);
  const svg = await render(model, { format: 'svg' });
  assert.ok(new Resvg(svg).render().asPng().length > 1000);
});

test('data and untyped legend samples match their distinct diagram styles in both exports', async () => {
  const model = compile('arch A { generic a {} generic b {} generic c {} a -> c { type: data display: [] } b -> c { display: [] } }');
  for (const format of ['svg', 'html']) {
    const dom = new JSDOM(await render(model, { format }));
    const selector = format === 'svg' ? '.figure-legend path' : '.legend li path';
    const [data, untyped] = [...dom.window.document.querySelectorAll(selector)];
    assert.equal(data.getAttribute('stroke-dasharray'), 'none');
    assert.equal(untyped.getAttribute('stroke-dasharray'), '14 6');
    assert.equal(data.getAttribute('stroke-width'), '1.6');
    assert.equal(untyped.getAttribute('stroke-width'), '1.3');
    dom.window.close();
  }
});
