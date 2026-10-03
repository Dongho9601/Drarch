import { layout } from '../layout.js';
import { renderSVG } from './svg.js';
import { renderHTML } from './html.js';

export async function render(model, { format = 'html' } = {}) {
  if (!['html', 'svg'].includes(format)) throw new Error(`Unsupported output format: ${format}. Use html or svg.`);
  const geometry = await layout(model);
  return format === 'svg' ? renderSVG(model, geometry) + '\n' : renderHTML(model, geometry);
}
