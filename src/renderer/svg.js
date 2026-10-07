import { componentPresentation, fieldName, flowStyle, FLOW_DASHES, textWidth, wrap } from './presentation.js';

export const escapeXML = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const n = value => Number(value.toFixed(2));
const styles = `
  .drarch-diagram { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #25292e; }
  .drarch-diagram .block-shape { fill: #fff; stroke: #434a52; stroke-width: 1.2; }
  .drarch-diagram .component-compute .block-shape { fill: #fcf7ed; stroke: #806537; }
  .drarch-diagram .component-memory .block-shape { fill: #f0f5fa; stroke: #526e90; }
  .drarch-diagram .component-queue .block-shape { fill: #f1f7f4; stroke: #53796d; }
  .drarch-diagram .component-buffer .block-shape { fill: #f5f8ef; stroke: #71834e; }
  .drarch-diagram .component-generic .block-shape { fill: #fafafa; stroke: #69717c; }
  .drarch-diagram .component-crossbar .block-shape { fill: #eff7f8; stroke: #477d84; }
  .drarch-diagram .component-mux .block-shape,
  .drarch-diagram .component-demux .block-shape { fill: #fbf4f0; stroke: #926b57; }
  .drarch-diagram .component-register .block-shape { fill: #f5f6f8; stroke: #65717e; }
  .drarch-diagram .detail { fill: none; stroke: #7d8791; stroke-width: 1.2; }
  .drarch-diagram .type { font-size: 11px; letter-spacing: 1.2px; fill: #545e69; }
  .drarch-diagram .heading { font-size: 17px; font-weight: 600; fill: #25292e; }
  .drarch-diagram .property { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 14px; fill: #424c57; }
  .drarch-diagram .topology { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 14px; fill: #25292e; }
  .drarch-diagram .figure-title { font-size: 22px; font-weight: 600; fill: #25292e; }
  .drarch-diagram .figure-note { font-size: 13px; fill: #424c57; }
  .drarch-diagram .group-shape { fill: #fafbfc; stroke: #c1c6cc; stroke-width: 1; }
  .drarch-diagram .group-label { font-size: 15px; font-weight: 500; fill: #555e68; }
  .drarch-diagram .edge-line { fill: none; stroke: #646c76; stroke-width: 1.3; }
  .drarch-diagram .edge-label { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; fill: #424c57; }
  .drarch-diagram .data .edge-line { stroke: #343b44; stroke-width: 1.6; }
  .drarch-diagram .neutral .edge-line { stroke-dasharray: 14 6; }
  ${Object.entries(FLOW_DASHES).filter(([, dash]) => dash).map(([type, dash]) => `.drarch-diagram .${type} .edge-line { stroke-dasharray: ${dash}; }`).join('\n  ')}
  .drarch-diagram .edge-hit { fill: none; stroke: transparent; stroke-width: 14; }
  .drarch-diagram .related .edge-line { stroke: #215e86; stroke-width: 2; }
  .drarch-diagram .related .block-shape { stroke: #215e86; stroke-width: 1.8; }
  .drarch-diagram [data-key] { cursor: pointer; outline: none; }
  .drarch-diagram [data-key]:focus .block-shape, .drarch-diagram .selected .block-shape { stroke: #1f5d89; stroke-width: 2.76; }
  .drarch-diagram [data-key]:focus .group-shape, .drarch-diagram .selected .group-shape { stroke: #1f5d89; stroke-width: 2.4; }
  .drarch-diagram [data-key]:focus .edge-line, .drarch-diagram .selected .edge-line { stroke: #1f5d89; stroke-width: 2.76; }
`;
function details(entity, kind, interactive) {
  const label = entity.label || entity.id;
  const attrs = interactive ? ` data-key="${escapeXML(`${kind}:${entity.id}`)}" tabindex="0" role="button" aria-pressed="false" aria-label="${escapeXML(`${label}, ${entity.type ?? kind}`)}"` : '';
  const title = entity.desc ? `<title>${escapeXML(entity.desc)}</title>` : '';
  return { attrs, title };
}
function shape(type, w, h) {
  const radius = type === 'buffer' ? 22 : 0;
  const rect = `<rect class="block-shape" width="${w}" height="${h}"${radius ? ` rx="${radius}"` : ''}/>`;
  if (type === 'compute') return `<path class="block-shape" d="M 20 0 H ${w - 20} L ${w} 20 V ${h - 20} L ${w - 20} ${h} H 20 L 0 ${h - 20} V 20 Z"/>`;
  if (type === 'mux' || type === 'demux') {
    const points = type === 'mux' ? `0,0 ${w},24 ${w},${h - 24} 0,${h}` : `0,24 ${w},0 ${w},${h} 0,${h - 24}`;
    return `<polygon class="block-shape" points="${points}"/>`;
  }
  const details = {
    queue: `<path class="detail" d="M 14 0 V ${h} M ${w - 14} 0 V ${h} M 0 ${h / 3} H 14 M 0 ${h * 2 / 3} H 14 M ${w - 14} ${h / 3} H ${w} M ${w - 14} ${h * 2 / 3} H ${w}"/>`,
    register: `<rect class="detail" x="4" y="4" width="${w - 8}" height="${h - 8}"/>`,
    memory: `<path class="detail" d="M 0 ${h - 16} H ${w} M 0 ${h - 8} H ${w} M ${w / 4} ${h - 16} V ${h} M ${w / 2} ${h - 16} V ${h} M ${w * 3 / 4} ${h - 16} V ${h}"/>`,
    crossbar: `<path class="detail" d="M ${w - 38} 10 l 24 24 m 0 -24 l -24 24"/>`,
  };
  return rect + (details[type] ?? '');
}

export function renderSVG(model, layout, { interactive = false } = {}) {
  const width = interactive ? layout.width : Math.max(640, layout.width);
  const titleLines = interactive ? [] : wrap(model.architecture.label, width - 64, 22);
  const header = titleLines.length ? 26 + titleLines.length * 28 : 0;
  const flowTypes = [...Object.keys(FLOW_DASHES), 'untyped'].filter(type => model.connections.some(edge => (edge.properties.type?.value ?? 'untyped') === type));
  const legend = [];
  let legendX = 32, legendY = 0;
  for (const type of flowTypes) {
    const itemWidth = 66 + textWidth(fieldName(type), 13);
    if (legendX + itemWidth > width - 32) { legendX = 32; legendY += 26; }
    legend.push({ type, x: legendX, y: legendY });
    legendX += itemWidth;
  }
  const noteLines = interactive ? [] : wrap('Ratios show declared inputs → outputs; ? means unspecified. Peer counts show distinct connected blocks per flow, not ports or arbitration. ×N denotes repeated instances; connections attach to the compact block.', width - 64, 13);
  const footer = interactive ? 0 : 26 + (legend.length ? legendY + 30 : 0) + noteLines.length * 20 + 20;
  const height = layout.height + header + footer;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" class="drarch-diagram" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}" role="${interactive ? 'group' : 'img'}" aria-label="${escapeXML(model.architecture.label)} architecture diagram">`,
    `<title>${escapeXML(model.architecture.label)}</title>`, model.architecture.desc ? `<desc>${escapeXML(model.architecture.desc)}</desc>` : '',
    `<style>${styles}</style><defs><marker id="drarch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="#646c76" stroke-width="1.4" stroke-dasharray="none"/></marker><marker id="drarch-arrow-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 9 1 L 1 5 L 9 9" fill="none" stroke="#646c76" stroke-width="1.4" stroke-dasharray="none"/></marker></defs>`,
    `<rect width="100%" height="100%" fill="white"/>`];
  titleLines.forEach((line, i) => parts.push(`<text class="figure-title" x="32" y="${38 + i * 28}">${escapeXML(line)}</text>`));
  parts.push(`<g class="architecture-geometry" transform="translate(0 ${header})">`);
  const groupMap = new Map(model.groups.map(g => [g.id, g]));
  for (const box of layout.groups) {
    const group = groupMap.get(box.id), d = details(group, 'group', interactive);
    parts.push(`<g${d.attrs}>${d.title}<rect class="group-shape" x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}"/>`);
    (box.titleLines ?? [group.label]).forEach((line, i) => parts.push(`<text class="group-label" x="${n(box.x + 20)}" y="${n(box.y + 30 + i * 20)}">${escapeXML(line)}</text>`));
    parts.push('</g>');
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
      label.lines.forEach((line, i) => parts.push(`<text class="edge-label" x="${n(label.x + 6)}" y="${n(label.y + 17 + i * 20)}">${escapeXML(line)}</text>`));
    }
    parts.push('</g>');
  }
  const componentMap = new Map(model.components.map(c => [c.id, c]));
  for (const box of layout.nodes) {
    const component = componentMap.get(box.id), p = componentPresentation(component, model.connections), d = details(component, 'component', interactive);
    const typeY = component.type === 'mux' || component.type === 'demux' ? 30 : 23;
    parts.push(`<g class="component-${escapeXML(component.type)}" transform="translate(${n(box.x)} ${n(box.y)})"${d.attrs}>${d.title}${shape(component.type, n(box.width), n(box.height))}<text class="type" x="24" y="${typeY}">${component.type.toUpperCase()}</text>`);
    p.titleLines.forEach((line, i) => parts.push(`<text class="heading" x="24" y="${48 + i * 22}">${escapeXML(line)}</text>`));
    p.topologyLines.forEach((line, i) => parts.push(`<text class="topology" x="24" y="${48 + p.titleLines.length * 22 + i * 22}">${escapeXML(line)}</text>`));
    p.propertyLines.forEach((line, i) => parts.push(`<text class="property" x="24" y="${48 + (p.titleLines.length + p.topologyLines.length) * 22 + i * 22}">${escapeXML(line)}</text>`));
    parts.push('</g>');
  }
  parts.push('</g>');
  if (!interactive) {
    const y = header + layout.height + 20;
    for (const item of legend) {
      const style = flowStyle(item.type);
      parts.push(`<g class="figure-legend"><path d="M ${item.x} ${y + item.y} h 36" fill="none" stroke="${style.stroke}" stroke-width="${style.width}" stroke-dasharray="${style.dash}" marker-end="url(#drarch-arrow)"/><text class="figure-note" x="${item.x + 46}" y="${y + item.y + 4}">${fieldName(item.type)}</text></g>`);
    }
    noteLines.forEach((line, i) => parts.push(`<text class="figure-note" x="32" y="${y + (legend.length ? legendY + 30 : 0) + i * 20}">${escapeXML(line)}</text>`));
  }
  parts.push('</svg>');
  return parts.join('\n');
}
