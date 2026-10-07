import { DEFAULT_DISPLAY } from '../schema.js';
import { valueText } from '../units.js';
import { componentTopology } from '../topology.js';

const names = { input_bw: 'Input', output_bw: 'Output', read_bw: 'Read', write_bw: 'Write', line_size: 'Line size' };
export const FLOW_DASHES = { data: '', request: '8 3', response: '5 3', control: '2 3', backpressure: '7 3 2 3', credit: '2 2 2 6', dependency: '1 5' };
export const flowStyle = type => ({
  dash: type === 'untyped' ? '14 6' : FLOW_DASHES[type] || 'none',
  stroke: type === 'data' ? '#343b44' : '#646c76',
  width: type === 'data' ? 1.6 : 1.3,
});
export const fieldName = name => Object.hasOwn(names, name) ? names[name] : name.replaceAll('_', ' ').replace(/^./, s => s.toUpperCase());
export function textWidth(text, size = 13) {
  // Conservative bounds for system monospace text, including wide Unicode.
  return [...text].reduce((width, char) => width + (char.codePointAt(0) > 255 ? size : size * 0.64), 0);
}
export function wrap(text, width, size = 13) {
  const lines = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/u)) {
      if (line && textWidth(`${line} ${word}`, size) <= width) {
        line += ` ${word}`;
        continue;
      }
      if (line) { lines.push(line); line = ''; }
      // Break a token only when the token itself cannot fit, including IDs
      // and text without spaces. Iterate code points to preserve Unicode.
      for (const char of word) {
        if (line && textWidth(line + char, size) > width) { lines.push(line); line = ''; }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}
export function componentPresentation(component, connections = []) {
  const visible = component.display ?? DEFAULT_DISPLAY[component.type];
  const count = component.properties.count;
  // Instance count and topology describe structure, so a display preference
  // cannot turn an array or a many-to-one function into an apparent 1:1 block.
  const showCount = count && (Number(count.value) > 1 || visible.includes('count'));
  const title = component.label + (showCount ? ` ×${valueText(count)}` : '');
  const topology = componentTopology(component, connections);
  const structural = new Set(['count', 'inputs', 'outputs', 'behavior']);
  if (topology.declared?.policy) structural.add('policy');
  const topologyText = [];
  if (topology.declared) {
    const { behavior, inputs, outputs, policy } = topology.declared;
    topologyText.push(`${behavior === 'unspecified' ? 'Declared I/O' : fieldName(behavior)}: ${inputs ?? '?'} → ${outputs ?? '?'}`);
    if (policy) topologyText.push(`Policy: ${policy.replaceAll('_', ' ')}`);
    else if (behavior === 'arbitration') topologyText.push('Policy: unspecified');
  }
  for (const flow of topology.flows) {
    if (flow.inputs > 1 || flow.outputs > 1) topologyText.push(`${fieldName(flow.type)} peers: ${flow.inputs} in / ${flow.outputs} out`);
  }
  const properties = visible.filter(name => !structural.has(name) && component.properties[name]).map(name => {
    const suffix = name === 'throughput' && component.type === 'compute' ? ' / instance' : '';
    return `${fieldName(name)}: ${valueText(component.properties[name])}${suffix}`;
  });
  const longest = Math.max(textWidth(title, 17), ...[...topologyText, ...properties].map(line => textWidth(line, 14)), 160);
  const width = Math.min(400, Math.max(240, Math.ceil(longest + 48)));
  const titleLines = wrap(title, width - 48, 17);
  const topologyLines = topologyText.flatMap(line => wrap(line, width - 48, 14));
  const propertyLines = properties.flatMap(line => wrap(line, width - 48, 14));
  const detailCount = topologyLines.length + propertyLines.length;
  const height = 52 + titleLines.length * 22 + (detailCount ? 12 + detailCount * 22 : 0);
  return { title, titleLines, topologyLines, propertyLines, width, height };
}
export function connectionLabel(edge) {
  if (edge.label) return edge.label;
  const fields = edge.display ?? ['type', 'rate', 'bandwidth', 'latency'];
  return fields.filter(name => edge.properties[name]).map(name => name === 'latency' ? `${valueText(edge.properties[name])} latency` : valueText(edge.properties[name])).join(' · ');
}
