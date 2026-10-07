import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { compile, render } from '../src/index.js';

async function viewer(source, viewport = { width: 900, height: 600 }) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(await render(compile(source)), {
    runScripts: 'dangerously', virtualConsole,
    beforeParse(window) {
      Object.defineProperty(window.SVGElement.prototype, 'viewBox', { get() {
        const [, , width, height] = this.getAttribute('viewBox').split(' ').map(Number);
        return { baseVal: { width, height } };
      } });
      Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return viewport.width; } });
      Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get() { return viewport.height; } });
    },
  });
  assert.deepEqual(errors, []);
  return dom;
}

test('fit respects both viewport dimensions, refits on resize, and actual size restores legibility', async () => {
  const viewport = { width: 900, height: 260 };
  const dom = await viewer('arch A { generic a {} generic b {} generic c {} a -> b b -> c layout { columns: [[a,b,c]] } }', viewport);
  const { document } = dom.window;
  try {
    const svg = document.querySelector('svg');
    assert.ok(parseFloat(svg.style.height) <= viewport.height - 48);
    assert.ok(parseFloat(svg.style.width) <= viewport.width - 48);
    document.getElementById('actual-size').click();
    assert.equal(parseFloat(svg.style.height), svg.viewBox.baseVal.height);
    document.getElementById('fit').click();
    viewport.height = 120;
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    assert.ok(parseFloat(svg.style.height) <= 72);
    document.getElementById('zoom-in').click();
    const zoomed = svg.style.width;
    viewport.width = 700;
    dom.window.dispatchEvent(new dom.window.Event('resize'));
    assert.equal(svg.style.width, zoomed, 'manual zoom should survive window resize');
  } finally { dom.window.close(); }
});

test('search finds qualified IDs and types, reveals blocks, and exposes connections and parents', async () => {
  const dom = await viewer('arch A { group tile { label: "Tile" queue q { label: "Work Queue" depth: 8 } compute pe { label: "Engine" } q -> pe { type: request } } generic other {} }');
  const { document, Event, KeyboardEvent } = dom.window;
  try {
    const search = document.getElementById('search');
    search.value = 'tile.q';
    search.dispatchEvent(new Event('input'));
    assert.equal(document.querySelectorAll('#outline button').length, 1);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    assert.equal(document.getElementById('inspector-title').textContent, 'Work Queue');
    assert.equal(document.getElementById('zoom-level').textContent, '100%');
    assert.equal(document.querySelector('[data-key="component:tile.q"]').getAttribute('aria-pressed'), 'true');
    assert.equal(document.querySelector('#outline button').getAttribute('aria-current'), 'true');
    assert.equal(document.querySelector('[data-key="component:tile.pe"]').classList.contains('related'), true);
    assert.equal(document.querySelector('[data-key="component:other"]').classList.contains('related'), false);
    assert.equal(document.querySelector('#inspector-connections small').textContent, 'Request · tile.q → tile.pe');
    document.querySelector('#inspector-connections button').click();
    assert.equal(document.getElementById('inspector-title').textContent, 'Work Queue → Engine');
    const endpointButtons = [...document.querySelectorAll('#inspector-properties button')];
    endpointButtons.find(button => button.textContent === 'Engine').click();
    assert.equal(document.getElementById('inspector-title').textContent, 'Engine');
    document.querySelector('#inspector-properties button').click();
    assert.equal(document.getElementById('inspector-title').textContent, 'Tile');
    search.value = 'COMPUTE';
    search.dispatchEvent(new Event('input'));
    assert.equal(document.querySelector('#outline button').dataset.itemKey, 'component:tile.pe');
    search.value = '<img src=x onerror=alert(1)>';
    search.dispatchEvent(new Event('input'));
    assert.equal(document.querySelectorAll('#outline button, #outline img').length, 0);
    assert.match(document.getElementById('search-count').textContent, /No matching blocks/);
    document.getElementById('overview').click();
    assert.equal(document.querySelectorAll('.selected, .related, [aria-pressed="true"]').length, 0);
  } finally { dom.window.close(); }
});

test('empty architectures explain the empty outline and still support overview and zoom', async () => {
  const dom = await viewer('arch Empty {}');
  try {
    const { document } = dom.window;
    assert.match(document.getElementById('search-count').textContent, /No blocks/);
    document.getElementById('actual-size').click();
    document.getElementById('overview').click();
    assert.equal(document.getElementById('inspector-title').textContent, 'Empty');
    assert.equal(document.getElementById('inspector-connections').hidden, true);
  } finally { dom.window.close(); }
});

test('keyboard shortcuts respect text input and browser shortcuts; Escape clears search before selection', async () => {
  const dom = await viewer('arch A { generic a { label: "Alpha" } generic b {} a -> b }');
  const { document, KeyboardEvent, Event } = dom.window;
  const key = (target, value, options = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options }));
  try {
    const search = document.getElementById('search');
    key(document, '/');
    assert.equal(document.activeElement, search);
    search.value = 'Alpha';
    search.dispatchEvent(new Event('input'));
    key(search, 'Enter');
    assert.equal(document.getElementById('inspector-title').textContent, 'Alpha');
    const width = document.querySelector('svg').style.width;
    key(search, '+');
    assert.equal(document.querySelector('svg').style.width, width);
    key(search, 'Escape');
    assert.equal(search.value, '');
    assert.equal(document.getElementById('inspector-title').textContent, 'Alpha');
    key(search, 'Escape');
    assert.equal(document.getElementById('inspector-title').textContent, 'A');
    key(document, '+', { ctrlKey: true });
    assert.equal(document.querySelector('svg').style.width, width);
    for (let i = 0; i < 30; i++) key(document, '+');
    assert.equal(document.getElementById('zoom-level').textContent, '300%');
    assert.equal(document.getElementById('zoom-in').disabled, true);
    key(document, '0');
    assert.equal(document.getElementById('zoom-level').textContent, '100%');
    assert.equal(document.getElementById('zoom-in').disabled, false);
    key(document, 'F');
    assert.equal(document.querySelectorAll('.selected').length, 0);
  } finally { dom.window.close(); }
});

test('small viewports fit below ten percent and zoom controls stop at their lower bound', async () => {
  const dom = await viewer('arch A { generic a {} generic b {} generic c {} a -> b b -> c }', { width: 80, height: 80 });
  try {
    const { document } = dom.window;
    const svg = document.querySelector('svg');
    assert.ok(parseFloat(svg.style.width) <= 32);
    assert.ok(parseFloat(svg.style.height) <= 32);
    assert.equal(document.getElementById('zoom-out').disabled, true);
    document.getElementById('zoom-in').click();
    assert.equal(document.getElementById('zoom-out').disabled, false);
  } finally { dom.window.close(); }
});

test('without JavaScript the document contains architecture details and a legend for only the flows in use', async () => {
  const html = await render(compile('arch A { desc: "Architecture description" queue q {} compute pe {} q -> pe { type: request } pe -> q { type: backpressure } }'));
  const dom = new JSDOM(html);
  try {
    const { document } = dom.window;
    assert.equal(document.getElementById('inspector-desc').textContent, 'Architecture description');
    assert.match(document.getElementById('inspector-properties').textContent, /Components2Groups0Connections2/);
    assert.deepEqual([...document.querySelectorAll('.legend li')].map(li => li.textContent), ['Request', 'Backpressure']);
    assert.ok(document.querySelector('noscript'));
    assert.equal(document.querySelector('.canvas-footer a').getAttribute('href'), '#inspector');
  } finally { dom.window.close(); }
});

test('component inspector distinguishes declared dimensions, unique flow peers, and compact instances', async () => {
  const dom = await viewer(`arch A {
    generic source0 {} generic source1 {} generic sink {}
    generic arb { behavior: arbitration inputs: 4 outputs: 1 policy: round_robin display: [] }
    compute array { count: 8 throughput: 2 op/cycle }
    source0 -> arb { type: request }
    source0 -> arb { type: request }
    source1 -> arb { type: request }
    arb -> sink { type: request }
    arb -> source0 { type: credit }
    arb <-> array { type: data }
  }`);
  try {
    const { document } = dom.window;
    document.querySelector('[data-key="component:arb"]').dispatchEvent(new dom.window.MouseEvent('click'));
    assert.equal(document.getElementById('inspector-topology').hidden, false);
    assert.match(document.getElementById('inspector-properties').textContent, /Optional visible fieldsNo optional fields; structure remains visible/);
    assert.match(document.getElementById('topology-properties').textContent, /BehaviorArbitrationDeclared inputs4Declared outputs1Policyround_robin/);
    const rows = [...document.querySelectorAll('#topology-flows tbody tr')].map(row => [...row.children].map(cell => cell.textContent));
    assert.deepEqual(rows, [['Data', '1', '1'], ['Request', '2', '1'], ['Credit', '0', '1']]);
    assert.match(document.querySelector('.topology-help').textContent, /not physical ports or instances/);
    assert.equal(document.getElementById('topology-instances').hidden, true);
    document.querySelector('[data-key="component:array"]').dispatchEvent(new dom.window.MouseEvent('click'));
    assert.match(document.getElementById('inspector-properties').textContent, /Instances \(compact block\)8Throughput \(per instance\)2 op\/cycle/);
    assert.match(document.getElementById('topology-instances').textContent, /8 instances.*do not describe per-instance wiring/);
    document.getElementById('overview').click();
    assert.equal(document.getElementById('inspector-topology').hidden, true);
  } finally { dom.window.close(); }
});

test('fan-in alone does not claim arbitration and unspecified dimensions remain explicit', async () => {
  const dom = await viewer(`arch A {
    generic a {} generic b {} generic join {} generic incomplete { inputs: 4 }
    mux select {} generic isolated {}
    a -> join b -> join join -> select
  }`);
  try {
    const { document } = dom.window;
    const select = id => document.querySelector(`[data-key="component:${id}"]`).dispatchEvent(new dom.window.MouseEvent('click'));
    select('join');
    assert.equal(document.getElementById('topology-properties').textContent, '');
    assert.equal(document.querySelector('#topology-flows tbody').textContent, 'Untyped21');
    assert.doesNotMatch(document.getElementById('inspector-topology').textContent, /arbitration/i);
    select('incomplete');
    assert.match(document.getElementById('topology-properties').textContent, /BehaviorUnspecifiedDeclared inputs4Declared outputsUnspecified/);
    select('select');
    assert.match(document.getElementById('topology-properties').textContent, /BehaviorSelectionDeclared inputsUnspecifiedDeclared outputs1/);
    select('isolated');
    assert.equal(document.getElementById('topology-flows').hidden, true);
    assert.match(document.getElementById('topology-notes').textContent, /No connections are declared/);
  } finally { dom.window.close(); }
});

test('HTML embeds derived topology without changing the semantic model', async () => {
  const model = compile('arch A { generic a {} mux m { inputs: 4 } a -> m }');
  const original = JSON.stringify(model);
  const dom = new JSDOM(await render(model));
  try {
    const payload = JSON.parse(dom.window.document.getElementById('drarch-model').textContent);
    assert.equal(payload.topology.m.declared.inputs, 4);
    assert.deepEqual(payload.topology.m.flows, [{ type: 'untyped', inputs: 1, outputs: 0 }]);
    assert.equal(JSON.stringify(model), original);
    assert.equal(Object.hasOwn(model, 'topology'), false);
  } finally { dom.window.close(); }
});

test('flow controls dim edges without hiding structure or changing topology, and overview resets them', async () => {
  const dom = await viewer(`arch A {
    generic a {} generic b {} generic c {}
    a -> b { type: request } b -> c { type: data } c -> a
  }`, { width: 360, height: 400 });
  try {
    const { document, Event, KeyboardEvent } = dom.window;
    const controls = [...document.querySelectorAll('input[data-flow]')];
    assert.deepEqual(controls.map(input => input.dataset.flow), ['data', 'request', 'untyped']);
    assert.ok(controls.every(input => input.type === 'checkbox' && input.checked && input.labels.length === 1 && input.getAttribute('aria-controls') === 'canvas'));
    document.querySelector('[data-key="component:a"]').dispatchEvent(new dom.window.MouseEvent('click'));
    const beforeTopology = document.getElementById('inspector-topology').textContent;
    const model = JSON.parse(document.getElementById('drarch-model').textContent);
    const request = controls.find(input => input.dataset.flow === 'request');
    request.click();
    const dimmed = [...document.querySelectorAll('.flow-dimmed')];
    assert.equal(dimmed.length, 1);
    assert.equal(dimmed[0].dataset.key, `connection:${model.connections[0].id}`);
    assert.ok(dimmed.every(element => element.getAttribute('tabindex') === '0' && !element.hidden && element.getAttribute('aria-hidden') !== 'true'));
    assert.equal(document.querySelectorAll('[data-key^="component:"].flow-dimmed').length, 0);
    assert.equal(document.getElementById('inspector-topology').textContent, beforeTopology);
    assert.match(document.getElementById('flow-status').textContent, /2 of 3 flows emphasized.*All connections remain visible/);
    assert.equal(document.getElementById('flow-summary').textContent, '(2/3 emphasized)');
    dimmed[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(dimmed[0].getAttribute('aria-pressed'), 'true', 'dimmed edges remain keyboard-selectable');
    for (const control of controls) { control.checked = false; control.dispatchEvent(new Event('change')); }
    assert.equal(document.querySelectorAll('.flow-dimmed').length, 3);
    request.focus();
    request.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(controls.every(input => input.checked));
    assert.equal(document.querySelectorAll('.flow-dimmed').length, 0);
    assert.equal(document.getElementById('inspector-title').textContent, 'A');
    request.click();
    document.getElementById('overview').click();
    assert.ok(controls.every(input => input.checked));
    assert.equal(document.getElementById('flow-status').textContent, 'All flows emphasized.');
  } finally { dom.window.close(); }
});

test('HTML legend distinguishes data from untyped flows using the rendered line styles', async () => {
  const dom = new JSDOM(await render(compile('arch A { generic a {} generic b {} a -> b { type: data } b -> a }')));
  try {
    const { document } = dom.window;
    const sample = type => document.querySelector(`.legend input[data-flow="${type}"]`).closest('label').querySelector('path');
    assert.equal(sample('data').getAttribute('stroke'), '#343b44');
    assert.equal(sample('data').getAttribute('stroke-width'), '1.6');
    assert.equal(sample('data').getAttribute('stroke-dasharray'), 'none');
    assert.equal(sample('untyped').getAttribute('stroke'), '#646c76');
    assert.equal(sample('untyped').getAttribute('stroke-width'), '1.3');
    assert.equal(sample('untyped').getAttribute('stroke-dasharray'), '14 6');
  } finally { dom.window.close(); }
});
