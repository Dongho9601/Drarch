export class DiagnosticError extends Error {
  constructor(diagnostics) {
    super(diagnostics.map(d => d.message).join('\n'));
    this.name = 'DiagnosticError';
    this.diagnostics = diagnostics;
  }
}

export function fail(code, message, loc, hint) {
  throw new DiagnosticError([{ code, message, loc, hint }]);
}

export function formatDiagnostics(error, source, filename = '<input>') {
  const lines = source.split(/\r?\n/);
  return error.diagnostics.map(({ code, message, loc, hint }) => {
    const line = loc?.line ?? 1;
    const column = loc?.column ?? 1;
    const content = lines[line - 1] ?? '';
    const gutter = String(line).length;
    const length = Math.max(1, Math.min(loc?.length ?? 1, content.length - column + 1));
    return `error[${code}]: ${message}\n\n  ${filename}:${line}:${column}\n\n${line} | ${content}\n${' '.repeat(gutter)} | ${' '.repeat(column - 1)}${'^'.repeat(length)}${hint ? `\n\n${hint}` : ''}`;
  }).join('\n\n');
}
