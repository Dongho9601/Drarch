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
