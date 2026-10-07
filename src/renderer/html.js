import { readFileSync } from 'node:fs';
import { escapeXML, renderSVG } from './svg.js';
import { fieldName, FLOW_DASHES, flowStyle } from './presentation.js';
import { componentTopology } from '../topology.js';
const css = readFileSync(new URL('./viewer.css', import.meta.url), 'utf8');
const script = readFileSync(new URL('./viewer.js', import.meta.url), 'utf8');

export function renderHTML(model, geometry) {
  const title = escapeXML(model.architecture.label);
  const usedFlows = new Set(model.connections.map(edge => edge.properties.type?.value ?? 'untyped'));
  const flowTypes = [...Object.keys(FLOW_DASHES), 'untyped'].filter(type => usedFlows.has(type));
  const legend = flowTypes.length ? `<details class="legend"><summary>Flows <span id="flow-summary" class="js-only"></span></summary><p class="js-only">Uncheck a flow to dim its connections. Blocks and topology stay visible; selected or keyboard-focused connections stay emphasized.</p><ul>${flowTypes.map(type => `<li><label><input class="js-only" type="checkbox" data-flow="${escapeXML(type)}" checked aria-controls="canvas"><svg width="44" height="16" viewBox="0 0 44 16" aria-hidden="true"><path d="M 0 8 H 42" fill="none" stroke="${flowStyle(type).stroke}" stroke-width="${flowStyle(type).width}" stroke-dasharray="${flowStyle(type).dash || 'none'}"/></svg><span class="flow-name">${fieldName(type)}</span></label></li>`).join('')}</ul><p id="flow-status" class="js-only" role="status"></p></details>` : '';
  // Script-data elements still recognize </script>. Escape every '<' in source
  // data; the viewer inserts all user text with textContent, never innerHTML.
  const topology = Object.fromEntries(model.components.map(component => [component.id, componentTopology(component, model.connections)]));
  const data = JSON.stringify({ ...model, topology }).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${title} · Drarch</title>
<style>${css}</style>
</head>
<body>
<a class="skip-link" href="#canvas">Skip to diagram</a>
<header class="page-header"><div class="identity"><span class="brand">Drarch</span><span class="tagline">Architecture explorer</span></div><div class="architecture-heading"><h1>${title}</h1><p>${model.components.length} components · ${model.groups.length} groups · ${model.connections.length} connections</p></div></header>
<main class="workspace">
<section class="drawing" aria-label="Architecture diagram">
<nav class="toolbar js-only" aria-label="Diagram controls"><div class="zoom-controls"><button id="zoom-out" aria-label="Zoom out" title="Zoom out (−)">−</button><output id="zoom-level" aria-label="Zoom level"></output><button id="zoom-in" aria-label="Zoom in" title="Zoom in (+)">+</button></div><button id="fit" aria-keyshortcuts="f" title="Fit diagram (F)">Fit diagram</button><button id="actual-size" aria-keyshortcuts="0" title="Actual size (0)">Actual size</button><button id="overview" aria-keyshortcuts="Escape" title="Return to architecture details and emphasize all flows (Escape)">Overview</button></nav>
<div id="canvas" tabindex="0" aria-label="Diagram canvas. Use arrow keys to scroll.">${!model.components.length && !model.groups.length ? '<p class="empty-diagram">No blocks yet. Add a component to the source file and render it again.</p>' : ''}${renderSVG(model, geometry, { interactive: true })}</div>
<div class="canvas-footer js-only"><p class="canvas-hint">Select to inspect. Scroll to explore.</p><a href="#inspector">View details</a></div>
</section>
<aside aria-label="Architecture details">
<section class="explorer js-only" aria-label="Find a block"><label for="search">Find a block <span class="shortcut" aria-hidden="true">/</span></label><input id="search" type="search" placeholder="Search names, IDs, types…" autocomplete="off" spellcheck="false" aria-controls="outline" aria-keyshortcuts="/"><p id="search-count" role="status"></p><nav id="outline" aria-label="Blocks and groups"></nav></section>
${legend}
<section id="inspector" tabindex="-1" aria-label="Inspector"><p id="inspector-kind">Architecture</p><h2 id="inspector-title">${title}</h2><p id="inspector-id">${escapeXML(model.architecture.id)}</p><p id="inspector-desc"${model.architecture.desc ? '' : ' hidden'}>${escapeXML(model.architecture.desc)}</p><section id="inspector-topology" aria-labelledby="topology-heading" hidden><h3 id="topology-heading">Behavior and topology</h3><dl id="topology-properties"></dl><table id="topology-flows"><caption>Connected peer blocks by flow</caption><thead><tr><th scope="col">Flow</th><th scope="col">Input peers</th><th scope="col">Output peers</th></tr></thead><tbody></tbody></table><p class="topology-help">Peer counts describe distinct connected blocks, not physical ports or instances. A bidirectional connection contributes to both directions.</p><ul id="topology-notes"></ul><p id="topology-instances"></p></section><dl id="inspector-properties"><dt>Components</dt><dd>${model.components.length}</dd><dt>Groups</dt><dd>${model.groups.length}</dd><dt>Connections</dt><dd>${model.connections.length}</dd></dl><nav id="inspector-connections" aria-label="Connected blocks" hidden><h3>Connections</h3><ul></ul></nav><p class="help js-only">Tab to focus · Enter to select · Esc for overview and all flows.<br>/ to search · F to fit · 0 for actual size · + / − to zoom.</p></section>
</aside>
</main>
<p id="selection-status" class="sr-only" role="status"></p>
<div id="tooltip" role="tooltip" hidden></div>
<noscript><p>The diagram is available without JavaScript. Enable JavaScript to inspect properties.</p></noscript>
<script type="application/json" id="drarch-model">${data}</script>
<script>${script}</script>
</body>
</html>
`;
}
