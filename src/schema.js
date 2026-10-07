export const SCHEMAS = {
  queue: ['depth', 'input_bw', 'output_bw'],
  buffer: ['capacity', 'read_bw', 'write_bw', 'latency'],
  register: ['width', 'count'],
  compute: ['count', 'throughput', 'latency'],
  memory: ['kind', 'capacity', 'bandwidth', 'read_bw', 'write_bw', 'latency', 'line_size'],
  mux: ['inputs', 'width', 'latency'],
  demux: ['outputs', 'width', 'latency'],
  crossbar: ['inputs', 'outputs', 'width', 'bandwidth', 'latency'],
  generic: [],
};
export const DEFAULT_DISPLAY = {
  ...SCHEMAS,
  memory: ['capacity', 'bandwidth', 'read_bw', 'write_bw', 'latency'],
  mux: ['inputs', 'width'],
  demux: ['outputs', 'width'],
  crossbar: ['inputs', 'outputs', 'bandwidth'],
};
export const FLOW_TYPES = ['data', 'request', 'response', 'control', 'backpressure', 'credit', 'dependency'];
export const BEHAVIORS = ['arbitration', 'selection', 'dispatch', 'broadcast', 'routing', 'merge'];
export const COMMON = ['label', 'desc', 'display'];
export const EDGE_FIELDS = ['type', 'rate', 'bandwidth', 'latency'];
export const PROPERTY_ORDER = [...new Set(['label', 'desc', 'kind', 'type', 'behavior', 'count', 'depth', 'capacity', 'width', 'inputs', 'outputs', 'stages', 'throughput', 'rate', 'bandwidth', 'input_bw', 'output_bw', 'read_bw', 'write_bw', 'latency', 'line_size', 'policy', 'display', 'columns'])];

export function compareProperties(a, b) {
  const rank = name => PROPERTY_ORDER.includes(name) ? PROPERTY_ORDER.indexOf(name) : PROPERTY_ORDER.length;
  return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
}
