import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { compile, render } from '../src/index.js';
import { escapeXML } from '../src/renderer/svg.js';

const examples = [];
await mkdir(new URL('../output/', import.meta.url), { recursive: true });
for (const filename of (await readdir(new URL('../examples/', import.meta.url))).filter(f => f.endsWith('.drarch')).sort()) {
  const model = compile(await readFile(new URL(`../examples/${filename}`, import.meta.url), 'utf8'));
  examples.push({ filename, model });
  for (const format of ['html', 'svg']) {
    const output = filename.replace(/\.drarch$/, `.${format}`);
    await writeFile(new URL(`../output/${output}`, import.meta.url), await render(model, { format }));
    console.log(`output/${output}`);
  }
}

// Keep a local entry point beside the generated files so users can discover
// every example without knowing its filename. No server or scripts are needed.
const entries = examples.map(({ filename, model }) => {
  const stem = encodeURIComponent(filename.replace(/\.drarch$/, ''));
  return `<li>
  <div><h2><a href="${stem}.html">${escapeXML(model.architecture.label)}</a></h2>
  ${model.architecture.desc ? `<p>${escapeXML(model.architecture.desc)}</p>` : ''}
  <p class="meta">${model.components.length} components · ${model.groups.length} groups · ${model.connections.length} connections</p></div>
  <nav aria-label="${escapeXML(model.architecture.label)} files"><a href="${stem}.html">Explore diagram →</a><a href="${stem}.svg">View SVG</a></nav>
</li>`;
}).join('\n');

const index = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'">
<title>Architecture examples · Drarch</title>
<style>
:root { color-scheme: light; color: #25292e; background: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; scrollbar-color: #b9bec4 #f5f6f7; }
* { box-sizing: border-box; }
body { max-width: 1080px; margin: 0 auto; padding: 56px 32px; }
.brand { font-size: 14px; font-weight: 600; margin: 0 0 32px; }
h1 { font-size: clamp(28px, 5vw, 42px); font-weight: 600; letter-spacing: -1px; margin: 0 0 16px; }
header > p:last-child { color: #5c6570; max-width: 620px; font-size: 16px; line-height: 1.7; }
a { color: #215e86; text-underline-offset: 4px; }
a:hover { color: #173f5a; }
:focus-visible { outline: 2px solid #215e86; outline-offset: 4px; }
figure { margin: 40px 0; }
figure img { display: block; width: 100%; height: auto; }
figcaption { color: #5c6570; font-size: 13px; line-height: 1.6; margin-top: 16px; }
ol { list-style: none; padding: 0; margin: 0; }
li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 32px; padding: 28px 0; border-top: 1px solid #e4e7eb; }
h2 { font-size: 20px; font-weight: 550; margin: 0; overflow-wrap: anywhere; }
h2 a { color: inherit; text-decoration: none; }
li p { font-family: Georgia, serif; font-size: 18px; line-height: 1.65; margin: 12px 0; max-width: 720px; }
li .meta { font-family: inherit; color: #5c6570; font-size: 12px; margin-bottom: 0; }
nav { display: flex; flex-direction: column; align-items: flex-start; gap: 16px; padding-top: 4px; font-size: 13px; }
footer { color: #5c6570; margin-top: 32px; font-size: 13px; line-height: 1.7; }
@media (max-width: 600px) { body { padding: 32px 20px; } li { grid-template-columns: 1fr; gap: 16px; } nav { flex-direction: row; flex-wrap: wrap; gap: 24px; } }
</style></head><body>
<header><p class="brand">Drarch / Examples</p><h1>Architecture examples</h1><p>Explore ${examples.length} example architectures. Open a diagram to inspect its blocks and connections, or use an SVG in a document. Every file works offline.</p></header>
<main><figure><img src="queue_scheduler_pe.svg" alt="A request queue feeds a scheduler and four processing elements, with backpressure upstream and an L2 cache below the processing elements."><figcaption>Start with the <a href="queue_scheduler_pe.html">queue, scheduler, and PE example</a>. Select a block to see its properties.</figcaption></figure>
<ol aria-label="Example architectures">${entries}</ol></main>
<footer>In a diagram, press / to find a block, F to fit the architecture, or 0 to read at actual size.</footer>
</body></html>\n`;
await writeFile(new URL('../output/index.html', import.meta.url), index);
console.log('output/index.html');
