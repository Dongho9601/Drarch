import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../bin/drarch.js', import.meta.url));
const run = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

test('CLI check, inspect, formatting, HTML and SVG rendering work end to end', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drarch-cli-'));
  try {
    const input = join(dir, 'architecture with spaces.drarch');
    const original = 'arch A{generic sched{label:"Scheduler" width:4 display:[width]} queue q{depth:32} q -> sched}';
    await writeFile(input, original);
    assert.equal(run(['check', input]).status, 0);
    const inspect = run(['inspect', input, '--json']);
    assert.equal(inspect.status, 0);
    assert.equal(JSON.parse(inspect.stdout).components.length, 2);
    assert.match(run(['inspect', input]).stdout, /width: 4/);
    assert.equal(run(['fmt', input, '--check']).status, 1);
    assert.equal(run(['fmt', input, '--stdout']).status, 0);
    assert.equal(await readFile(input, 'utf8'), original);
    assert.equal(run(['fmt', input]).status, 0);
    assert.equal(run(['fmt', input, '--check']).status, 0);
    assert.equal(run(['render', input]).status, 0);
    assert.match(await readFile(input.replace('.drarch', '.html'), 'utf8'), /<!doctype html>/);
    assert.equal(run(['render', input, '--format', 'svg']).status, 0);
    assert.match(await readFile(input.replace('.drarch', '.svg'), 'utf8'), /<svg/);
    const custom = join(dir, 'custom.svg');
    assert.equal(run(['render', input, '--format', 'svg', '-o', custom]).status, 0);
    assert.match(await readFile(custom, 'utf8'), /<svg/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI errors preserve source and existing output; source aliases cannot be overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'drarch-cli-'));
  try {
    const input = join(dir, 'source.drarch'), output = join(dir, 'existing.html');
    await writeFile(input, 'arch A { queue q { depth: 32 } }');
    for (const alias of [input, join(dir, 'symlink'), join(dir, 'hardlink')]) {
      if (alias.endsWith('symlink')) await symlink(input, alias);
      if (alias.endsWith('hardlink')) await link(input, alias);
      const result = run(['render', input, '-o', alias]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /must differ/);
    }
    const invalid = 'arch A { memory m { latency: 4 GB/s } }';
    await writeFile(input, invalid); await writeFile(output, 'existing');
    const result = run(['render', input, '-o', output]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DRARCH204/);
    assert.equal(await readFile(input, 'utf8'), invalid);
    assert.equal(await readFile(output, 'utf8'), 'existing');
    assert.equal(run(['check', join(dir, 'missing')]).status, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

for (const args of [['nope'], ['check'], ['check', '--json'], ['render', '--format'], ['fmt', 'a', '--check', '--stdout'], ['inspect', 'a', 'b']]) {
  test(`CLI rejects invalid arguments ${args.join(' ')}`, () => assert.equal(run(args).status, 1));
}
test('CLI exposes help and version', () => {
  assert.match(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }), /drarch render/);
  assert.equal(run(['--version']).stdout.trim(), '0.1.0');
});
