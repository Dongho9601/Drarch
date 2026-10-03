import { readFileSync } from 'node:fs';
import { escapeXML, renderSVG } from './svg.js';
const css = readFileSync(new URL('./viewer.css', import.meta.url), 'utf8');
const script = readFileSync(new URL('./viewer.js', import.meta.url), 'utf8');

export function renderHTML(model, geometry) {
  const title = escapeXML(model.architecture.label);
  // Script-data elements still recognize </script>. Escape every '<' in source
  // data; the viewer inserts all user text with textContent, never innerHTML.
  const data = JSON.stringify(model).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
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
<header><span class="brand">DRARCH</span><div><h1>${title}</h1><p>${model.components.length} components · ${model.connections.length} connections</p></div></header>
<main class="workspace">
<section class="drawing" aria-label="Architecture diagram">
<nav class="toolbar" aria-label="Diagram controls"><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-in" aria-label="Zoom in">+</button><button id="fit">Fit</button><button id="overview">Overview</button><span id="zoom-level"></span></nav>
<div id="canvas">${renderSVG(model, geometry, { interactive: true })}</div>
</section>
<aside aria-label="Inspector"><p id="inspector-kind">Architecture</p><h2 id="inspector-title">${title}</h2><p id="inspector-id"></p><p id="inspector-desc"></p><dl id="inspector-properties"></dl><p class="help">Select a block, group, or connection to inspect it. Use Tab to focus, Enter to select, and Escape to return to the overview.</p></aside>
</main>
<div id="tooltip" role="tooltip" hidden></div>
<noscript><p>The diagram is available without JavaScript. Enable JavaScript to inspect properties.</p></noscript>
<script type="application/json" id="drarch-model">${data}</script>
<script>${script}</script>
</body>
</html>
`;
}
