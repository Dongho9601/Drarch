import { FLOW_TYPES } from './schema.js';

const intrinsicBehaviors = { mux: 'selection', demux: 'dispatch', crossbar: 'routing' };

/**
 * Describe authored behavior and observed graph topology independently.
 *
 * Declared inputs/outputs count architectural inputs/outputs. Flow inputs/outputs
 * count unique peer component IDs for each explicit flow type, or `untyped` when
 * an edge has no type. Parallel edges count once; bidirectional edges count in
 * both directions. A self-loop counts this component once in each direction.
 * Peer counts neither establish behavior nor constrain declared port counts.
 */
export function componentTopology(component, connections = []) {
  const props = component.properties ?? {};
  const behavior = Object.hasOwn(intrinsicBehaviors, component.type) ? intrinsicBehaviors[component.type]
    : component.type === 'generic' ? props.behavior?.value ?? (props.inputs || props.outputs ? 'unspecified' : null) : null;
  let declared = null;
  const notes = [];
  if (behavior) {
    declared = {
      behavior,
      inputs: component.type === 'demux' ? 1 : props.inputs ? Number(props.inputs.value) : null,
      outputs: component.type === 'mux' ? 1 : props.outputs ? Number(props.outputs.value) : null,
      policy: props.policy?.value ?? null,
    };
    if (declared.inputs === null) notes.push('The input count is unspecified.');
    if (declared.outputs === null) notes.push('The output count is unspecified.');
    if (behavior === 'unspecified') notes.push('The behavior is unspecified.');
    if (behavior === 'arbitration' && declared.policy === null) notes.push('The arbitration policy is unspecified.');
  }

  const peers = new Map();
  const add = (type, direction, peer) => {
    if (!peers.has(type)) peers.set(type, { inputs: new Set(), outputs: new Set() });
    peers.get(type)[direction].add(peer);
  };
  for (const connection of connections) {
    const type = connection.properties?.type?.value ?? 'untyped';
    if (connection.source === component.id) {
      add(type, 'outputs', connection.target);
      if (connection.bidirectional) add(type, 'inputs', connection.target);
    }
    if (connection.target === component.id) {
      add(type, 'inputs', connection.source);
      if (connection.bidirectional) add(type, 'outputs', connection.source);
    }
  }
  const order = type => FLOW_TYPES.includes(type) ? FLOW_TYPES.indexOf(type) : FLOW_TYPES.length;
  const flows = [...peers].sort(([a], [b]) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map(([type, counts]) => ({ type, inputs: counts.inputs.size, outputs: counts.outputs.size }));
  return { declared, flows, notes };
}
