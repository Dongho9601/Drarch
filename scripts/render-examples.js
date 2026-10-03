import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { compile, render } from '../src/index.js';
await mkdir(new URL('../output/', import.meta.url), { recursive: true });
for (const filename of (await readdir(new URL('../examples/', import.meta.url))).filter(f => f.endsWith('.drarch')).sort()) {
  const model = compile(await readFile(new URL(`../examples/${filename}`, import.meta.url), 'utf8'));
  for (const format of ['html', 'svg']) {
    const output = filename.replace(/\.drarch$/, `.${format}`);
    await writeFile(new URL(`../output/${output}`, import.meta.url), await render(model, { format }));
    console.log(`output/${output}`);
  }
}
