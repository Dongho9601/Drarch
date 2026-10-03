import { DEFAULT_DISPLAY } from '../schema.js';
import { valueText } from '../units.js';

const names = { input_bw: 'Input', output_bw: 'Output', read_bw: 'Read', write_bw: 'Write', line_size: 'Line size' };
export const fieldName = name => Object.hasOwn(names, name) ? names[name] : name.replaceAll('_', ' ').replace(/^./, s => s.toUpperCase());
export function textWidth(text, size = 13) {
  // Conservative bounds for system monospace text, including wide Unicode.
  return [...text].reduce((width, char) => width + (char.codePointAt(0) > 255 ? size : size * 0.64), 0);
}
export function wrap(text, width, size = 13) {
  const lines = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const char of paragraph) {
      if (line && textWidth(line + char, size) > width) { lines.push(line.trimEnd()); line = ''; }
      line += char;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
export function componentPresentation(component) {
  const visible = component.display ?? DEFAULT_DISPLAY[component.type];
  const count = component.properties.count;
  const showCount = count && visible.includes('count');
  const title = component.label + (showCount ? ` ×${valueText(count)}` : '');
  const properties = visible.filter(name => name !== 'count' && component.properties[name]).map(name => {
    const suffix = name === 'throughput' && component.type === 'compute' ? ' / instance' : '';
    return `${fieldName(name)}: ${valueText(component.properties[name])}${suffix}`;
  });
  const longest = Math.max(textWidth(title, 17), ...properties.map(line => textWidth(line)), 160);
  const width = Math.min(360, Math.max(220, Math.ceil(longest + 48)));
  const titleLines = wrap(title, width - 48, 17);
  const propertyLines = properties.flatMap(line => wrap(line, width - 48));
  const height = 52 + titleLines.length * 22 + (propertyLines.length ? 12 + propertyLines.length * 20 : 0);
  return { title, titleLines, propertyLines, width, height };
}
export function connectionLabel(edge) {
  if (edge.label) return edge.label;
  const fields = edge.display ?? ['type', 'rate', 'bandwidth', 'latency'];
  return fields.filter(name => edge.properties[name]).map(name => name === 'latency' ? `${valueText(edge.properties[name])} latency` : valueText(edge.properties[name])).join(' · ');
}
