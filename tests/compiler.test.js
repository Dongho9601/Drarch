import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { compile, format, parse, DiagnosticError, formatDiagnostics } from '../src/index.js';

const exampleDir = new URL('../examples/', import.meta.url);
const withoutLocations = value => JSON.parse(JSON.stringify(value, (key, val) => key === 'loc' ? undefined : val));
function rejects(body, code, contains) {
  assert.throws(() => compile(`arch Test { ${body} }`), error => error instanceof DiagnosticError && error.diagnostics.some(d => d.code === code && (!contains || d.message.includes(contains))));
}

test('all six examples compile and survive canonical formatting', async () => {
  const files = (await readdir(exampleDir)).filter(f => f.endsWith('.drarch'));
  assert.equal(files.length, 6);
  for (const file of files) {
    const source = await readFile(new URL(file, exampleDir), 'utf8');
    const formatted = format(source);
    assert.equal(format(formatted), formatted, file);
    assert.deepEqual(withoutLocations(compile(formatted)), withoutLocations(compile(source)), file);
  }
});

test('all primitives, forward references, whole-block edges, repeated edges and custom properties', () => {
  const model = compile(`arch All {
    q -> r
    q -> r { type: control }
    queue q { depth: 32 entries input_bw: 2 req/cycle }
    register r { width: 256 bit count: 16 }
    buffer b { capacity: 1 KiB read_bw: 8 B/cycle write_bw: 4 B/cycle latency: 0 cycle }
    compute c { count: 8 throughput: 1.70 op/cycle latency: 2 cycle }
    memory m { kind: cache capacity: 512 KB bandwidth: 1.28e2 GB/s latency: 40 ns line_size: 64 B }
    mux mx { inputs: 4 width: 256 bit }
    demux dx { outputs: 2 width: 4 }
    crossbar x { inputs: 4 outputs: 8 bandwidth: 32 B/cycle }
    generic g { policy: oldest_first custom: [a, "b", 1.20, 2 widgets] constructor: "ok" __proto__: "safe" }
  }`);
  assert.equal(model.components.length, 9);
  assert.equal(model.connections.length, 2);
  assert.notEqual(model.connections[0].id, model.connections[1].id);
  const compute = model.components.find(c => c.id === 'c');
  assert.equal(compute.properties.throughput.value, '1.70');
  assert.equal(compute.properties.throughput.quantity, 'cycle_throughput');
  assert.equal(compute.throughputScope, 'per_instance');
  assert.equal(model.components.find(c => c.id === 'm').properties.bandwidth.value, '1.28e2');
  assert.equal(model.components.find(c => c.id === 'g').properties.__proto__.value, 'safe');
  assert.equal({}.safe, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(model)), model);
  assert.doesNotMatch(JSON.stringify(model), /"(?:x|y|height)":/);
});

test('hierarchy resolves nearest lexical scope and qualified cross-group references', () => {
  const model = compile(`arch A {
    generic x {}
    group a {
      generic x {}
      group inner { generic y {} y -> x y -> b.z }
      x -> inner.y
    }
    group b { generic z {} }
    x -> a.inner.y
  }`);
  assert.deepEqual(model.connections.map(e => [e.source, e.target]), [
    ['a.inner.y', 'b.z'], ['a.inner.y', 'a.x'], ['a.x', 'a.inner.y'], ['x', 'a.inner.y'],
  ].sort((a,b) => `${a[0]}->${a[1]}`.localeCompare(`${b[0]}->${b[1]}`)));
  assert.equal(model.groups.find(g => g.id === 'a.inner').parent, 'a');
});

test('descriptions default to empty; display choices are separate from properties', () => {
  const model = compile('arch A { group g { memory m { capacity: 1 MB latency: 8 cycle display: [] } } }');
  assert.equal(model.architecture.desc, '');
  assert.equal(model.groups[0].desc, '');
  assert.deepEqual(model.components[0].display, []);
  assert.deepEqual(Object.keys(model.components[0].properties), ['capacity', 'latency']);
});

for (const [body, code, contains] of [
  ['queue q { depth: 4 } queue q {}', 'DRARCH202', 'Duplicate identifier'],
  ['group g {} generic g {}', 'DRARCH202', 'Duplicate identifier'],
  ['generic g { width: 2 width: 4 }', 'DRARCH202', 'Duplicate property'],
  ['generic g {} g -> nope', 'DRARCH201', 'Unknown component'],
  ['group g {} generic x {} x -> g', 'DRARCH201', 'names a group'],
  ['generic x {} x.read -> x', 'DRARCH201', 'Unknown component'],
  ['queue q { arbitrary: 1 }', 'DRARCH203', 'Unsupported property'],
  ['memory m { latency: 32 GB/s }', 'DRARCH204', 'latency'],
  ['memory m { capacity: 4 op/cycle }', 'DRARCH204', 'capacity'],
  ['generic g { latency: 32 GB/s }', 'DRARCH204', 'latency'],
  ['generic g { width: "four" }', 'DRARCH204', 'width'],
  ['generic g { kind: 3 }', 'DRARCH205', 'kind'],
  ['queue q { depth: 1.5 }', 'DRARCH205', 'depth'],
  ['queue q { depth: 0 }', 'DRARCH205', 'depth'],
  ['compute c { count: -1 }', 'DRARCH205', 'count'],
  ['compute c { count: 9007199254740993 }', 'DRARCH205', 'count'],
  ['compute c { throughput: -1 op/cycle }', 'DRARCH205', 'throughput'],
  ['memory m { latency: 1e999 ns }', 'DRARCH205', 'latency'],
  ['memory m { latency: 4 }', 'DRARCH204', 'latency'],
  ['memory m { capacity: 4 foobar }', 'DRARCH204', 'capacity'],
  ['memory m { bandwidth: 1 req/cycle }', 'DRARCH204', 'bandwidth'],
  ['generic g { label: nope }', 'DRARCH205', 'label'],
  ['generic g { desc: 4 }', 'DRARCH205', 'desc'],
  ['generic a {} generic b {} a -> b { type: magic }', 'DRARCH205', 'flow type'],
  ['generic a {} a -> a { depth: 4 }', 'DRARCH203', 'Unsupported property'],
  ['memory m { display: [latency] }', 'DRARCH205', 'not defined'],
  ['memory m { latency: 4 cycle display: [latency, latency] }', 'DRARCH205', 'Duplicate display'],
  ['generic g { display: "width" }', 'DRARCH205', 'list of property'],
  ['pipeline p {}', 'DRARCH206', 'Unknown component type'],
  ['arch Nested {}', 'DRARCH206', 'Unknown component type'],
  ['queue q { generic nested {} }', 'DRARCH206', 'Only properties'],
  ['generic a {} a -> a { a -> a }', 'DRARCH206', 'Only properties'],
  ['layout { columns: [missing] }', 'DRARCH201', 'Unknown component'],
  ['generic a {} layout { columns: [a, a] }', 'DRARCH207', 'Repeated layout'],
  ['group g { generic a {} } layout { columns: [g.a] }', 'DRARCH207', 'direct child'],
  ['layout { columns: [[]] }', 'DRARCH207', 'cannot be empty'],
  ['layout { columns: [1] }', 'DRARCH207', 'must name declared'],
  ['layout { columns: [[[a]]] }', 'DRARCH207', 'must name declared'],
  ['layout { unknown: [] }', 'DRARCH207', 'Unsupported layout'],
  ['layout { columns: [] } layout { columns: [] }', 'DRARCH202', 'Only one layout'],
]) test(`rejects ${body}`, () => rejects(body, code, contains));

for (const source of [
  'generic a {}', 'arch A {', 'arch A {} arch B {}', 'arch A { generic a { label: "oops } }',
  'arch A { generic a { label: "\\q" } }', 'arch A { generic a { label: "\\u0000" } }',
  'arch A { generic a { label: "\\ud800" } }',
  'arch A { generic a { width: [1 2] } }', 'arch A { generic a {} a => a }',
]) test(`syntax diagnostic: ${source}`, () => assert.throws(() => parse(source), DiagnosticError));

test('diagnostics highlight the missing reference and offer a suggestion', () => {
  const source = 'arch A {\n    compute pe {}\n    pe -> pes\n}';
  try { compile(source); assert.fail('must reject'); } catch (error) {
    const diagnostic = error.diagnostics[0];
    assert.equal(diagnostic.loc.line, 3);
    assert.equal(diagnostic.loc.column, 11);
    const text = formatDiagnostics(error, source, 'input.drarch');
    assert.match(text, /error\[DRARCH201\]/);
    assert.match(text, /input\.drarch:3:11/);
    assert.match(text, /\^\^\^/);
    assert.match(text, /Did you mean `pe`/);
  }
});

test('formatting retains comments, escapes and exact written numbers, and is idempotent', () => {
  const source = `// architecture\narch A{\n// compute\ncompute p{throughput: 1.700 op/cycle // speed\n// display name\nlabel:"PE \\"fast\\""\ncount:4\ndisplay:[count, // instances\n throughput]} // block\n// final\n}\n// after`;
  // Build an escaped quote without depending on host template escape rules.
  const validSource = source.replace('label:"PE \\"fast\\""', 'label:' + JSON.stringify('PE "fast"'));
  const output = format(validSource);
  assert.equal(format(output), output);
  assert.deepEqual(withoutLocations(compile(output)), withoutLocations(compile(validSource)));
  assert.deepEqual(parse(output).comments.map(c => c.text).sort(), parse(validSource).comments.map(c => c.text).sort());
  assert.match(output, /1\.700 op\/cycle/);
  assert.ok(output.indexOf('label:') < output.indexOf('count:'));
});

test('parser limits unbounded recursive nesting with a source diagnostic', () => {
  assert.throws(() => parse(`arch A { ${'group g { '.repeat(66)}${'}'.repeat(67)}`), DiagnosticError);
});
