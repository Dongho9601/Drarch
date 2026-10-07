import test from 'node:test';
import assert from 'node:assert/strict';
import { compile, format, DiagnosticError } from '../src/index.js';
import { componentTopology } from '../src/topology.js';

const compileBody = body => compile(`arch Test { ${body} }`);
const withoutLocations = value => JSON.parse(JSON.stringify(value, (key, item) => key === 'loc' ? undefined : item));
function rejects(body, message) {
  assert.throws(() => compileBody(body), error => error instanceof DiagnosticError
    && error.diagnostics.some(d => d.message.includes(message)));
}

for (const [behavior, inputs, outputs] of [
  ['arbitration', 4, 1], ['selection', 4, 1], ['merge', 4, 1],
  ['dispatch', 1, 4], ['broadcast', 1, 4], ['routing', 4, 8],
]) test(`generic ${behavior} declares architectural counts without connected peers`, () => {
  const model = compileBody(`generic block { behavior: ${behavior} inputs: ${inputs} outputs: ${outputs} policy: round_robin }`);
  assert.deepEqual(componentTopology(model.components[0], model.connections), {
    declared: { behavior, inputs, outputs, policy: 'round_robin' }, flows: [], notes: [],
  });
});

test('declared behavior survives formatting, quoting, and display suppression', () => {
  const source = `arch A { generic arbiter {
    display: [] policy: "oldest first" outputs: 1 inputs: 04 behavior: "arbitration"
  } }`;
  const formatted = format(source);
  assert.equal(format(formatted), formatted);
  assert.deepEqual(withoutLocations(compile(formatted)), withoutLocations(compile(source)));
  assert.deepEqual(componentTopology(compile(source).components[0]).declared, {
    behavior: 'arbitration', inputs: 4, outputs: 1, policy: 'oldest first',
  });
});

for (const [fields, message] of [
  ['behavior: magic inputs: 2 outputs: 1', 'Unknown component behavior'],
  ['behavior: 1 inputs: 2 outputs: 1', 'Unknown component behavior'],
  ['behavior: [arbitration] inputs: 2 outputs: 1', 'Unknown component behavior'],
  ['behavior: arbitration outputs: 1', 'requires `inputs`'],
  ['behavior: arbitration inputs: 2', 'requires `outputs`'],
  ['behavior: arbitration inputs: 2 outputs: 2', 'requires `outputs: 1`'],
  ['behavior: selection inputs: 2 outputs: 2', 'requires `outputs: 1`'],
  ['behavior: merge inputs: 2 outputs: 2', 'requires `outputs: 1`'],
  ['behavior: dispatch inputs: 2 outputs: 2', 'requires `inputs: 1`'],
  ['behavior: broadcast inputs: 2 outputs: 2', 'requires `inputs: 1`'],
  ['behavior: routing inputs: 0 outputs: 2', 'Invalid numeric value for `inputs`'],
  ['behavior: routing inputs: -2 outputs: 2', 'Invalid numeric value for `inputs`'],
  ['behavior: routing inputs: 1.5 outputs: 2', 'Invalid numeric value for `inputs`'],
  ['behavior: routing inputs: 9007199254740993 outputs: 2', 'Invalid numeric value for `inputs`'],
  ['behavior: routing inputs: 2 outputs: 0', 'Invalid numeric value for `outputs`'],
  ['behavior: routing inputs: 2 entries outputs: 2', 'Invalid units or value for `inputs`'],
  ['behavior: routing inputs: 2 outputs: "four"', 'Invalid units or value for `outputs`'],
  ['behavior: arbitration inputs: 2 outputs: 1 policy: 3', '`policy` must be a string or identifier'],
]) test(`rejects invalid behavior declaration: ${fields}`, () => rejects(`generic block { ${fields} }`, message));

test('behavior declarations are supported only by generic components', () => {
  rejects('queue q { behavior: arbitration }', 'Unsupported property `behavior`');
  rejects('mux q { behavior: arbitration inputs: 4 }', 'Unsupported property `behavior`');
});

test('intrinsic routing primitives preserve unspecified counts and implicit single sides', () => {
  const model = compileBody('mux m {} demux d { outputs: 4 } crossbar c { inputs: 2 outputs: 8 }');
  const topology = id => componentTopology(model.components.find(component => component.id === id));
  assert.deepEqual(topology('m'), {
    declared: { behavior: 'selection', inputs: null, outputs: 1, policy: null },
    flows: [], notes: ['The input count is unspecified.'],
  });
  assert.deepEqual(topology('d').declared, { behavior: 'dispatch', inputs: 1, outputs: 4, policy: null });
  assert.deepEqual(topology('c').declared, { behavior: 'routing', inputs: 2, outputs: 8, policy: null });
});

test('arbitration without policy stays unspecified', () => {
  const model = compileBody('generic a { behavior: arbitration inputs: 2 outputs: 1 }');
  const topology = componentTopology(model.components[0]);
  assert.equal(topology.declared.policy, null);
  assert.deepEqual(topology.notes, ['The arbitration policy is unspecified.']);
});

test('generic input and output counts survive without a declared behavior', () => {
  const model = compileBody('generic a { inputs: 3 outputs: 1 display: [] } generic b { inputs: 2 }');
  assert.deepEqual(componentTopology(model.components[0]), {
    declared: { behavior: 'unspecified', inputs: 3, outputs: 1, policy: null },
    flows: [], notes: ['The behavior is unspecified.'],
  });
  assert.deepEqual(componentTopology(model.components[1]), {
    declared: { behavior: 'unspecified', inputs: 2, outputs: null, policy: null },
    flows: [], notes: ['The output count is unspecified.', 'The behavior is unspecified.'],
  });
});

test('fan-in does not infer arbitration, and repeated edges count unique peers per flow', () => {
  const model = compileBody(`
    generic a {} generic b {} generic c {} generic d {}
    a -> c { type: request } a -> c { type: request }
    b -> c { type: request } c -> d { type: request }
    a -> c { type: control } c -> d { type: control }
    a -> c c -> d
  `);
  assert.deepEqual(componentTopology(model.components.find(component => component.id === 'c'), model.connections), {
    declared: null,
    flows: [
      { type: 'request', inputs: 2, outputs: 1 },
      { type: 'control', inputs: 1, outputs: 1 },
      { type: 'untyped', inputs: 1, outputs: 1 },
    ],
    notes: [],
  });
});

test('bidirectional edges count once per direction and include source or sink only flows', () => {
  const model = compileBody(`
    generic a {} generic b {} generic c {}
    a <-> b { type: data } b -> a { type: data } b <-> a { type: data }
    c -> a { type: credit } a -> b { type: request }
  `);
  assert.deepEqual(componentTopology(model.components.find(component => component.id === 'a'), model.connections).flows, [
    { type: 'data', inputs: 1, outputs: 1 },
    { type: 'request', inputs: 0, outputs: 1 },
    { type: 'credit', inputs: 1, outputs: 0 },
  ]);
});

test('self-loops count the component itself once in each direction', () => {
  const model = compileBody('generic a {} a -> a a <-> a');
  assert.deepEqual(componentTopology(model.components[0], model.connections).flows, [{ type: 'untyped', inputs: 1, outputs: 1 }]);
});

test('peer identity uses qualified IDs and declared port counts stay independent from graph peers', () => {
  const model = compileBody(`
    group one { generic a {} } group two { generic a {} }
    generic arbiter { behavior: arbitration inputs: 8 outputs: 1 }
    one.a -> arbiter { type: request } two.a -> arbiter { type: request }
  `);
  const before = JSON.stringify(model);
  const arbiter = model.components.find(component => component.id === 'arbiter');
  const topology = componentTopology(arbiter, model.connections);
  assert.equal(topology.declared.inputs, 8);
  assert.deepEqual(topology.flows, [{ type: 'request', inputs: 2, outputs: 0 }]);
  assert.deepEqual(componentTopology(arbiter, [...model.connections].reverse()), topology);
  assert.equal(JSON.stringify(model), before);
});
