import { componentPresentation } from './presentation.js';

export const escapeXML = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const n = value => Number(value.toFixed(2));
const styles = `
  .drarch-diagram { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #25292e; }
  .drarch-diagram .block-shape { fill: #fff; stroke: #434a52; stroke-width: 1.2; }
  .drarch-diagram .detail { fill: none; stroke: #a4a9af; stroke-width: 1; }
  .drarch-diagram .type { font-size: 10px; letter-spacing: 1.4px; fill: #727982; }
  .drarch-diagram .heading { font-size: 17px; font-weight: 600; fill: #25292e; }
  .drarch-diagram .property { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; fill: #4e5660; }
  .drarch-diagram .group-shape { fill: #fafbfc; stroke: #c1c6cc; stroke-width: 1; }
  .drarch-diagram .group-label { font-size: 15px; font-weight: 500; fill: #555e68; }
  .drarch-diagram .edge-line { fill: none; stroke: #646c76; stroke-width: 1.3; }
  .drarch-diagram .edge-label { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; fill: #555e68; }
  .drarch-diagram .data .edge-line { stroke: #343b44; stroke-width: 1.6; }
  .drarch-diagram .request .edge-line { stroke-dasharray: 8 3; }
  .drarch-diagram .response .edge-line { stroke-dasharray: 5 3; }
  .drarch-diagram .control .edge-line { stroke-dasharray: 2 3; }
  .drarch-diagram .backpressure .edge-line { stroke-dasharray: 7 3 2 3; }
  .drarch-diagram .credit .edge-line { stroke-dasharray: 2 2 2 6; }
  .drarch-diagram .dependency .edge-line { stroke-dasharray: 1 5; }
  .drarch-diagram .edge-hit { fill: none; stroke: transparent; stroke-width: 14; }
  .drarch-diagram [data-key] { cursor: pointer; outline: none; }
  .drarch-diagram [data-key]:focus .block-shape, .drarch-diagram .selected .block-shape { stroke: #1f5d89; stroke-width: 2.3; }
  .drarch-diagram [data-key]:focus .group-shape, .drarch-diagram .selected .group-shape { stroke: #1f5d89; stroke-width: 2; }
  .drarch-diagram [data-key]:focus .edge-line, .drarch-diagram .selected .edge-line { stroke: #1f5d89; stroke-width: 2.3; }
`;
function details(entity, kind, interactive) {
  const label = entity.label || entity.id;
  const attrs = interactive ? ` data-key="${escapeXML(`${kind}:${entity.id}`)}" tabindex="0" role="button" aria-label="${escapeXML(label)}"` : '';
  const title = entity.desc ? `<title>${escapeXML(entity.desc)}</title>` : '';
  return { attrs, title };
}
function shape(type, w, h) {
  const rect = `<rect class="block-shape" width="${w}" height="${h}"${type === 'buffer' ? ' rx="8"' : ''}/>`;
  if (type === 'compute') return `<path class="block-shape" d="M 8 0 H ${w - 8} L ${w} 8 V ${h - 8} L ${w - 8} ${h} H 8 L 0 ${h - 8} V 8 Z"/>`;
  if (type === 'mux' || type === 'demux') {
    const points = type === 'mux' ? `0,0 ${w},12 ${w},${h - 12} 0,${h}` : `0,12 ${w},0 ${w},${h} 0,${h - 12}`;
    return `<polygon class="block-shape" points="${points}"/>`;
  }
  const details = {
    queue: `<path class="detail" d="M 10 0 V ${h} M ${w - 10} 0 V ${h}"/>`,
    register: `<rect class="detail" x="4" y="4" width="${w - 8}" height="${h - 8}"/>`,
    memory: `<path class="detail" d="M 0 ${h - 8} H ${w} M 0 ${h - 4} H ${w}"/>`,
    crossbar: `<path class="detail" d="M ${w - 30} 12 l 16 16 m 0 -16 l -16 16"/>`,
  };
  return rect + (details[type] ?? '');
}

export function renderSVG(model, layout, { interactive = false } = {}) {
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" class="drarch-diagram" width="${n(layout.width)}" height="${n(layout.height)}" viewBox="0 0 ${n(layout.width)} ${n(layout.height)}" role="${interactive ? 'group' : 'img'}" aria-label="${escapeXML(model.architecture.label)} architecture diagram">`,
    `<title>${escapeXML(model.architecture.label)}</title>`, model.architecture.desc ? `<desc>${escapeXML(model.architecture.desc)}</desc>` : '',
    `<style>${styles}</style><defs><marker id="drarch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="#646c76" stroke-width="1.4" stroke-dasharray="none"/></marker><marker id="drarch-arrow-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 9 1 L 1 5 L 9 9" fill="none" stroke="#646c76" stroke-width="1.4" stroke-dasharray="none"/></marker></defs>`,
    `<rect width="100%" height="100%" fill="white"/>`];
  const groupMap = new Map(model.groups.map(g => [g.id, g]));
  for (const box of layout.groups) {
    const group = groupMap.get(box.id), d = details(group, 'group', interactive);
    parts.push(`<g${d.attrs}>${d.title}<rect class="group-shape" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}"/><text class="group-label" x="${n(box.x + 20)}" y="${n(box.y + 30)}">${escapeXML(group.label)}</text></g>`);
  }
  const edgeMap = new Map(model.connections.map(e => [e.id, e]));
  for (const edge of layout.edges) {
    const entity = edgeMap.get(edge.id), d = details(entity, 'connection', interactive);
    parts.push(`<g class="${escapeXML(entity.properties.type?.value ?? 'neutral')}"${d.attrs}>${d.title}`);
    edge.paths.forEach((points, i) => {
      const path = points.map((p, j) => `${j ? 'L' : 'M'} ${n(p.x)} ${n(p.y)}`).join(' ');
      if (interactive) parts.push(`<path class="edge-hit" d="${path}"/>`);
      parts.push(`<path class="edge-line" d="${path}"${i === edge.paths.length - 1 ? ' marker-end="url(#drarch-arrow)"' : ''}${entity.bidirectional && i === 0 ? ' marker-start="url(#drarch-arrow-start)"' : ''}/>`);
    });
    for (const label of edge.labels) {
      parts.push(`<rect x="${n(label.x)}" y="${n(label.y)}" width="${n(label.width)}" height="${n(label.height)}" fill="white"/>`);
      label.lines.forEach((line, i) => parts.push(`<text class="edge-label" x="${n(label.x + 6)}" y="${n(label.y + 16 + i * 18)}">${escapeXML(line)}</text>`));
    }
    parts.push('</g>');
  }
  const componentMap = new Map(model.components.map(c => [c.id, c]));
  for (const box of layout.nodes) {
    const component = componentMap.get(box.id), p = componentPresentation(component), d = details(component, 'component', interactive);
    parts.push(`<g transform="translate(${n(box.x)} ${n(box.y)})"${d.attrs}>${d.title}${shape(component.type, n(box.width), n(box.height))}<text class="type" x="24" y="23">${component.type.toUpperCase()}</text>`);
    p.titleLines.forEach((line, i) => parts.push(`<text class="heading" x="24" y="${48 + i * 22}">${escapeXML(line)}</text>`));
    p.propertyLines.forEach((line, i) => parts.push(`<text class="property" x="24" y="${48 + p.titleLines.length * 22 + i * 20}">${escapeXML(line)}</text>`));
    parts.push('</g>');
  }
  parts.push('</svg>');
  return parts.join('\n');
}
