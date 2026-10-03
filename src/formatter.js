import { parse } from './parser.js';
import { compareProperties } from './schema.js';

export function format(source) {
  const ast = parse(source);
  const leading = new Map(), trailing = new Map(), closing = new Map();
  const append = (map, node, comment) => map.set(node, [...(map.get(node) ?? []), comment.text]);
  // Keep comments attached to their statement while properties are reordered.
  // Comments inside a value move above that property, where they remain stable.
  function attach(comment, container) {
    const entries = container.entries ?? [];
    const inside = entries.find(e => comment.loc.offset >= e.loc.offset && comment.loc.offset < e.loc.offset + e.loc.length);
    if (inside) {
      if (inside.entries) attach(comment, inside); else append(leading, inside, comment);
      return;
    }
    const previous = entries.filter(e => e.loc.offset + e.loc.length <= comment.loc.offset).at(-1);
    if (previous && previous.loc.endLine === comment.loc.line) { append(trailing, previous, comment); return; }
    const next = entries.find(e => e.loc.offset > comment.loc.offset);
    append(next ? leading : closing, next ?? container, comment);
  }
  const before = [], after = [];
  for (const comment of ast.comments) {
    if (comment.loc.offset < ast.loc.offset) before.push(comment.text);
    else if (comment.loc.offset >= ast.loc.offset + ast.loc.length) after.push(comment.text);
    else attach(comment, ast);
  }
  const printValue = v => v.kind === 'list' ? `[${v.items.map(printValue).join(', ')}]` : v.kind === 'string' ? JSON.stringify(v.value) : v.kind === 'number' && v.unit ? `${v.value} ${v.unit}` : v.value;
  const commentLines = (comments, indent) => (comments ?? []).map(c => `${indent}//${c ? ` ${c}` : ''}`);
  function printBody(node, level) {
    const indent = '    '.repeat(level);
    const props = node.entries.filter(e => e.kind === 'property').sort((a, b) => compareProperties(a.name, b.name));
    const rest = node.entries.filter(e => e.kind !== 'property');
    const lines = [];
    for (const entry of [...props, ...rest]) {
      if (entry.kind !== 'property' && lines.length) lines.push('');
      lines.push(...commentLines(leading.get(entry), indent));
      if (entry.kind === 'property') lines.push(`${indent}${entry.name}: ${printValue(entry.value)}`);
      else {
        const head = entry.kind === 'layout' ? 'layout' : entry.kind === 'declaration' ? `${entry.type} ${entry.id}` : `${entry.from.value} ${entry.bidirectional ? '<->' : '->'} ${entry.to.value}`;
        if (entry.kind === 'connection' && !entry.entries.length && !closing.has(entry)) lines.push(indent + head);
        else lines.push(`${indent}${head} {`, ...printBody(entry, level + 1), `${indent}}`);
      }
      const tail = trailing.get(entry);
      if (tail?.length) {
        lines[lines.length - 1] += ` //${tail[0] ? ` ${tail[0]}` : ''}`;
        lines.push(...commentLines(tail.slice(1), indent));
      }
    }
    lines.push(...commentLines(closing.get(node), indent));
    return lines;
  }
  return [...commentLines(before, ''), `arch ${ast.id} {`, ...printBody(ast, 1), '}', ...commentLines(after, ''), ''].join('\n');
}
