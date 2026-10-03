import { fail } from './diagnostics.js';

// Tokens and AST nodes retain spans; the renderer never consumes these nodes.
export function lex(source) {
  const tokens = [], comments = [];
  let offset = 0, line = 1, column = 1;
  function consume(text) {
    for (const ch of text) {
      if (ch === '\n') { line++; column = 1; } else { column++; }
    }
    offset += text.length;
  }
  while (offset < source.length) {
    const rest = source.slice(offset);
    const loc = { offset, line, column, length: 1 };
    const space = rest.match(/^\s+/);
    if (space) { consume(space[0]); continue; }
    if (rest.startsWith('//')) {
      const raw = rest.match(/^\/\/[^\r\n]*/)[0];
      comments.push({ text: raw.slice(2).trim(), loc: { ...loc, length: raw.length } });
      consume(raw); continue;
    }
    let kind, raw, value;
    if (rest[0] === '"') {
      raw = rest.match(/^"(?:[^"\\\r\n]|\\[^\r\n])*"/)?.[0];
      if (!raw) fail('DRARCH101', 'Unterminated string.', loc, 'Close the string with a double quote; use \\n for a line break.');
      try { value = JSON.parse(raw); } catch { fail('DRARCH101', 'Invalid string escape.', loc, 'Use JSON string escapes, such as \\n or \\".'); }
      // XML 1.0 excludes these control characters, including escaped versions.
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(value)) {
        fail('DRARCH101', 'Strings cannot contain control characters or unpaired Unicode surrogates.', loc);
      }
      kind = 'string';
    } else if (rest.startsWith('<->') || rest.startsWith('->')) {
      kind = 'arrow'; raw = rest.startsWith('<->') ? '<->' : '->'; value = raw;
    } else if ((raw = rest.match(/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/)?.[0])) {
      kind = 'number'; value = raw;
    } else if ((raw = rest.match(/^[A-Za-z_][A-Za-z_0-9]*/)?.[0])) {
      kind = 'identifier'; value = raw;
    } else if ('{}[]:,./'.includes(rest[0])) {
      kind = raw = value = rest[0];
    } else {
      fail('DRARCH101', `Unexpected character ${JSON.stringify(rest[0])}.`, loc);
    }
    tokens.push({ kind, value, raw, loc: { ...loc, length: raw.length } });
    consume(raw);
  }
  tokens.push({ kind: 'eof', value: '', loc: { offset, line, column, length: 1 } });
  return { tokens, comments };
}

export function parse(source) {
  const { tokens, comments } = lex(source);
  let pos = 0;
  const peek = (n = 0) => tokens[pos + n];
  const take = () => tokens[pos++];
  function expect(kind, description = kind) {
    if (peek().kind !== kind) fail('DRARCH102', `Expected ${description}, found ${peek().raw ?? 'end of file'}.`, peek().loc);
    return take();
  }
  function span(start) {
    const end = tokens[pos - 1].loc;
    return { ...start, length: end.offset + end.length - start.offset, endLine: end.line };
  }
  function reference() {
    const token = expect('identifier', 'a block identifier');
    let value = token.value;
    while (peek().kind === '.') { take(); value += '.' + expect('identifier').value; }
    return { kind: 'symbol', value, loc: span(token.loc) };
  }
  function value(depth = 0) {
    if (depth > 64) fail('DRARCH102', 'Lists may nest at most 64 levels.', peek().loc);
    const token = peek();
    if (token.kind === '[') {
      take(); const items = [];
      while (peek().kind !== ']') {
        items.push(value(depth + 1));
        if (peek().kind !== ',') break;
        take();
      }
      expect(']');
      return { kind: 'list', items, loc: span(token.loc) };
    }
    if (token.kind === 'string') { take(); return { kind: 'string', value: token.value, loc: token.loc }; }
    if (token.kind === 'identifier') return reference();
    if (token.kind === 'number') {
      take(); let unit = null;
      if (peek().kind === 'identifier' && peek().loc.line === token.loc.line && peek(1).kind !== ':') {
        unit = take().value;
        if (peek().kind === '/') { take(); unit += '/' + expect('identifier', 'a rate denominator').value; }
      }
      return { kind: 'number', value: token.value, unit, loc: span(token.loc) };
    }
    fail('DRARCH102', 'Expected a string, number, identifier, or list.', token.loc);
  }
  function body(depth = 0) {
    if (depth > 64) fail('DRARCH102', 'Groups may nest at most 64 levels.', peek().loc);
    expect('{'); const entries = [];
    while (peek().kind !== '}') {
      const first = expect('identifier', 'a declaration, connection, or property');
      if (peek().kind === ':') {
        take(); const val = value();
        entries.push({ kind: 'property', name: first.value, value: val, loc: span(first.loc) });
      } else if (first.value === 'layout' && peek().kind === '{') {
        const entriesInLayout = body(depth + 1);
        entries.push({ kind: 'layout', entries: entriesInLayout, loc: span(first.loc) });
      } else if (peek().kind === 'identifier') {
        const id = take(); const children = body(depth + 1);
        entries.push({ kind: 'declaration', type: first.value, id: id.value, idLoc: id.loc, entries: children, loc: span(first.loc) });
      } else {
        pos--; const from = reference();
        const arrow = expect('arrow', '`->` or `<->`');
        const to = reference();
        const properties = peek().kind === '{' ? body(depth + 1) : [];
        entries.push({ kind: 'connection', from, to, bidirectional: arrow.value === '<->', entries: properties, loc: span(first.loc) });
      }
    }
    take(); return entries;
  }
  const start = expect('identifier', '`arch`');
  if (start.value !== 'arch') fail('DRARCH102', 'A file must contain one `arch` block.', start.loc);
  const id = expect('identifier', 'an architecture name');
  const entries = body();
  const ast = { kind: 'architecture', id: id.value, entries, loc: span(start.loc), comments };
  expect('eof', 'end of file');
  return ast;
}
