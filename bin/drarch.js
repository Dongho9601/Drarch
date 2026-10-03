#!/usr/bin/env node
import { readFile, writeFile, rename, unlink, stat, realpath, chmod } from 'node:fs/promises';
import { resolve, extname, dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { compile, format, render, valueText, DiagnosticError, formatDiagnostics } from '../src/index.js';

const help = `Drarch — computer architecture diagrams as code

Usage:
  drarch check <file.drarch>
  drarch fmt <file.drarch> [--check | --stdout]
  drarch render <file.drarch> [--format html|svg] [-o <output>]
  drarch inspect <file.drarch> [--json]

Rendering writes a standalone HTML file by default. Formatting updates the
source in place; --check exits with status 1 if formatting would change it.
`;

async function atomicWrite(path, text, mode) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, text, { flag: 'wx' });
    if (mode !== undefined) await chmod(temporary, mode);
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}

async function sameFile(input, output) {
  if (resolve(input) === resolve(output)) return true;
  try {
    const [a, b] = await Promise.all([stat(input), stat(output)]);
    return a.dev === b.dev && a.ino === b.ino;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function main(args) {
  if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(help); return; }
  if (args.length === 1 && args[0] === '--version') { console.log('0.1.0'); return; }
  const command = args.shift();
  const allowed = { check: [], fmt: ['--check', '--stdout'], render: ['--format', '-o', '--output'], inspect: ['--json'] };
  if (!Object.hasOwn(allowed, command)) throw new Error(`Unknown command: ${command}. Run drarch --help.`);
  const options = new Map(); let filename;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('-')) {
      if (!allowed[command].includes(arg)) throw new Error(`Unknown option for ${command}: ${arg}.`);
      const key = arg === '-o' ? '--output' : arg;
      if (options.has(key)) throw new Error(`Duplicate option: ${key}.`);
      if (['--format', '--output'].includes(key)) {
        if (!args[i + 1] || args[i + 1].startsWith('-')) throw new Error(`Missing value for ${arg}.`);
        options.set(key, args[++i]);
      } else options.set(key, true);
    } else if (filename) throw new Error('Expected one input file.');
    else filename = arg;
  }
  if (!filename) throw new Error('Missing input file. Run drarch --help.');
  if (options.has('--check') && options.has('--stdout')) throw new Error('Use either --check or --stdout.');
  const source = await readFile(filename, 'utf8');
  try {
    if (command === 'fmt') {
      const output = format(source);
      if (options.has('--stdout')) process.stdout.write(output);
      else if (options.has('--check')) {
        if (output !== source) { console.error(`${filename}: formatting required`); process.exitCode = 1; }
        else console.log(`${filename}: formatted`);
      } else {
        if (output !== source) await atomicWrite(await realpath(filename), output, (await stat(filename)).mode);
        console.log(`${filename}: formatted`);
      }
      return;
    }
    const model = compile(source);
    if (command === 'check') console.log(`${filename}: valid (${model.components.length} components, ${model.connections.length} connections)`);
    else if (command === 'inspect') {
      if (options.has('--json')) console.log(JSON.stringify(model, null, 2));
      else {
        console.log(`Architecture ${model.architecture.label} (${model.architecture.id})`);
        if (model.architecture.desc) console.log(model.architecture.desc);
        for (const group of model.groups) console.log(`group ${group.id}${group.desc ? ` — ${group.desc}` : ''}`);
        for (const component of model.components) {
          console.log(`${component.type} ${component.id} — ${component.label}`);
          if (component.desc) console.log(`  ${component.desc}`);
          for (const [key, value] of Object.entries(component.properties)) console.log(`  ${key}: ${valueText(value)}${key === 'throughput' && component.type === 'compute' ? ' (per instance)' : ''}`);
        }
        for (const edge of model.connections) {
          console.log(`${edge.source} ${edge.bidirectional ? '<->' : '->'} ${edge.target}`);
          if (edge.desc) console.log(`  ${edge.desc}`);
          for (const [key, value] of Object.entries(edge.properties)) console.log(`  ${key}: ${valueText(value)}`);
        }
      }
    } else {
      const outputFormat = options.get('--format') ?? 'html';
      const extension = extname(filename);
      const output = options.get('--output') ?? `${extension ? filename.slice(0, -extension.length) : filename}.${outputFormat}`;
      if (await sameFile(filename, output)) throw new Error('The output file must differ from the source file.');
      const rendered = await render(model, { format: outputFormat });
      await atomicWrite(resolve(output), rendered);
      console.log(`Rendered ${output}`);
    }
  } catch (error) {
    if (error instanceof DiagnosticError) { console.error(formatDiagnostics(error, source, filename)); process.exitCode = 1; }
    else throw error;
  }
}

main(process.argv.slice(2)).catch(error => { console.error(`drarch: ${error.message}`); process.exitCode = 1; });
