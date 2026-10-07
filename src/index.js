import { parse } from './parser.js';
import { analyze } from './semantic.js';
export { parse, lex } from './parser.js';
export { analyze } from './semantic.js';
export { format } from './formatter.js';
export { DiagnosticError, formatDiagnostics } from './diagnostics.js';
export { valueText } from './units.js';
export { componentTopology } from './topology.js';
export function compile(source) { return analyze(parse(source)); }
export async function render(model, options = {}) {
  const { render: renderModel } = await import('./renderer/index.js');
  return renderModel(model, options);
}
