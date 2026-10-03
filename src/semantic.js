import { DiagnosticError } from './diagnostics.js';
import { SCHEMAS, COMMON, EDGE_FIELDS, FLOW_TYPES, compareProperties } from './schema.js';
import { RULES, lowerValue, quantityOf } from './units.js';

function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] !== b[j])));
    row = next;
  }
  return row[b.length];
}

export function analyze(ast) {
  const diagnostics = [], symbols = new Map();
  const components = [], groups = [], connections = [], pendingEdges = [], pendingLayouts = [];
  const report = (code, message, loc, hint) => diagnostics.push({ code, message, loc, hint });
  const qualified = (parent, id) => parent ? `${parent}.${id}` : id;

  function checkValue(name, value) {
    const rule = Object.hasOwn(RULES, name) ? RULES[name] : undefined;
    if (rule) {
      if (value.kind !== 'number' || !rule.quantities.includes(quantityOf(value.unit))) {
        report('DRARCH204', `Invalid units or value for \`${name}\`.`, value.loc, `Use ${rule.example}.`);
        return;
      }
      const number = Number(value.value);
      if (!Number.isFinite(number) || number < 0 || (rule.positive && number === 0) || (rule.integer && !Number.isSafeInteger(number))) {
        report('DRARCH205', `Invalid numeric value for \`${name}\`.`, value.loc,
          `Expected a ${rule.positive ? 'positive' : 'nonnegative'}${rule.integer ? ' safe integer' : ' finite number'}; for example, ${rule.example}.`);
      }
    } else if (['kind', 'policy'].includes(name) && !['string', 'symbol'].includes(value.kind)) {
      report('DRARCH205', `\`${name}\` must be a string or identifier.`, value.loc);
    }
  }

  function properties(node, allowed, custom = false, presentation = COMMON) {
    const props = Object.create(null), fields = new Map();
    for (const entry of node.entries) {
      if (entry.kind !== 'property') continue;
      if (fields.has(entry.name)) report('DRARCH202', `Duplicate property \`${entry.name}\`.`, entry.loc);
      fields.set(entry.name, entry);
      if (presentation.includes(entry.name)) continue;
      if (!custom && !allowed.includes(entry.name)) {
        report('DRARCH203', `Unsupported property \`${entry.name}\` on ${node.type ?? node.kind}.`, entry.loc,
          `Supported fields: ${[...presentation, ...allowed].join(', ') || 'none'}. Use a generic block for custom architectural properties.`);
        continue;
      }
      checkValue(entry.name, entry.value);
      props[entry.name] = lowerValue(entry.value);
    }
    for (const name of ['label', 'desc']) {
      if (fields.has(name) && fields.get(name).value.kind !== 'string') report('DRARCH205', `\`${name}\` must be a quoted string.`, fields.get(name).value.loc);
    }
    let display = null;
    if (fields.has('display') && presentation.includes('display')) {
      const value = fields.get('display').value;
      if (value.kind !== 'list' || value.items.some(item => item.kind !== 'symbol')) {
        report('DRARCH205', '`display` must be a list of property names.', value.loc);
      } else {
        display = value.items.map(item => item.value);
        const seen = new Set();
        for (const item of value.items) {
          if (!Object.hasOwn(props, item.value)) report('DRARCH205', `Displayed property \`${item.value}\` is not defined on this element.`, item.loc);
          if (seen.has(item.value)) report('DRARCH205', `Duplicate display field \`${item.value}\`.`, item.loc);
          seen.add(item.value);
        }
      }
    }
    return {
      label: fields.get('label')?.value.value ?? node.id ?? '',
      desc: fields.get('desc')?.value.value ?? '',
      display,
      properties: Object.fromEntries(Object.entries(props).sort(([a], [b]) => compareProperties(a, b))),
    };
  }

  function requirePropertiesOnly(node) {
    for (const entry of node.entries) if (entry.kind !== 'property') report('DRARCH206', 'Only properties are allowed inside a component or connection.', entry.loc, 'Declare groups and connections inside an architecture or group.');
  }

  const rootProps = properties(ast, [], false, ['label', 'desc']);
  const architecture = { id: ast.id, label: rootProps.label, desc: rootProps.desc, loc: ast.loc, layout: null };
  function visit(node, parent, owner) {
    let hasLayout = false;
    for (const entry of node.entries) {
      if (entry.kind === 'declaration') {
        const id = qualified(parent, entry.id);
        if (symbols.has(id)) { report('DRARCH202', `Duplicate identifier \`${entry.id}\` in this scope.`, entry.idLoc); continue; }
        if (entry.type === 'group') {
          const p = properties(entry, [], false, ['label', 'desc']);
          const group = { id, name: entry.id, parent, label: p.label, desc: p.desc, loc: entry.loc, layout: null };
          symbols.set(id, { kind: 'group', ...group }); groups.push(group);
          visit(entry, id, group);
        } else if (Object.hasOwn(SCHEMAS, entry.type)) {
          requirePropertiesOnly(entry);
          const p = properties(entry, SCHEMAS[entry.type], entry.type === 'generic');
          const component = { id, name: entry.id, type: entry.type, parent, ...p, loc: entry.loc };
          if (entry.type === 'compute' && p.properties.throughput) component.throughputScope = 'per_instance';
          components.push(component); symbols.set(id, { kind: 'component', ...component });
        } else {
          report('DRARCH206', `Unknown component type \`${entry.type}\`.`, entry.loc,
            `Use ${Object.keys(SCHEMAS).join(', ')}, or group. Nested arch blocks are not allowed.`);
        }
      } else if (entry.kind === 'connection') {
        requirePropertiesOnly(entry);
        const p = properties(entry, EDGE_FIELDS);
        const flowType = p.properties.type;
        if (flowType && (!['symbol', 'string'].includes(flowType.kind) || !FLOW_TYPES.includes(flowType.value))) {
          report('DRARCH205', 'Unknown flow type.', flowType.loc, `Use ${FLOW_TYPES.join(', ')}.`);
        }
        pendingEdges.push({ entry, parent, p });
      } else if (entry.kind === 'layout') {
        if (hasLayout) report('DRARCH202', 'Only one layout block is allowed per scope.', entry.loc);
        hasLayout = true; pendingLayouts.push({ entry, parent, owner });
      }
    }
  }
  visit(ast, null, architecture);

  function resolve(ref, scope, allowGroup = false) {
    let parent = scope;
    while (true) {
      const id = qualified(parent, ref.value);
      const symbol = symbols.get(id);
      if (symbol) {
        if (symbol.kind !== 'component' && !allowGroup) { report('DRARCH201', `\`${ref.value}\` names a group, not a component.`, ref.loc, 'Connect a component inside the group using a qualified reference.'); return null; }
        return id;
      }
      if (!parent) break;
      parent = parent.includes('.') ? parent.slice(0, parent.lastIndexOf('.')) : null;
    }
    const choices = [...symbols.values()].filter(s => allowGroup || s.kind === 'component');
    const suggestion = choices.map(s => ({ id: s.id, score: Math.min(distance(ref.value, s.id), distance(ref.value, s.name)) })).sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))[0];
    report('DRARCH201', `Unknown component \`${ref.value}\`.`, ref.loc,
      suggestion && suggestion.score <= Math.max(2, ref.value.length / 3) ? `Did you mean \`${suggestion.id}\`?` : 'Declare the component, or use a group-qualified reference such as execution.pe.');
    return null;
  }
  const edgeCounts = new Map();
  for (const { entry, parent, p } of pendingEdges) {
    const source = resolve(entry.from, parent), target = resolve(entry.to, parent);
    if (!source || !target) continue;
    const base = `${source}${entry.bidirectional ? '<->' : '->'}${target}`;
    const count = (edgeCounts.get(base) ?? 0) + 1; edgeCounts.set(base, count);
    connections.push({ id: `${base}#${count}`, source, target, bidirectional: entry.bidirectional, parent, ...p, loc: entry.loc });
  }
  for (const { entry, parent, owner } of pendingLayouts) {
    requirePropertiesOnly(entry);
    const fields = entry.entries.filter(e => e.kind === 'property');
    const columns = fields.find(e => e.name === 'columns');
    for (const field of fields) if (field.name !== 'columns') report('DRARCH207', `Unsupported layout field \`${field.name}\`.`, field.loc, 'Use columns: [a, [b, c], d].');
    if (fields.filter(e => e.name === 'columns').length > 1) report('DRARCH202', 'Duplicate layout columns.', entry.loc);
    if (!columns || columns.value.kind !== 'list') { report('DRARCH207', 'A layout needs a `columns` list.', entry.loc, 'Use columns: [a, [b, c], d].'); continue; }
    const seen = new Set(), resolved = [];
    for (const col of columns.value.items) {
      const items = col.kind === 'list' ? col.items : [col];
      const result = [];
      if (!items.length) report('DRARCH207', 'A layout column cannot be empty.', col.loc);
      for (const item of items) {
        if (item.kind !== 'symbol') { report('DRARCH207', 'Layout entries must name declared blocks or groups.', item.loc); continue; }
        const id = resolve(item, parent, true);
        if (!id) continue;
        if (symbols.get(id).parent !== parent) { report('DRARCH207', `Layout reference \`${item.value}\` must be a direct child of this scope.`, item.loc, 'Place a layout block inside the group to arrange its children.'); continue; }
        if (seen.has(id)) report('DRARCH207', `Repeated layout reference \`${item.value}\`.`, item.loc);
        seen.add(id); result.push(id);
      }
      resolved.push(result);
    }
    owner.layout = { columns: resolved, loc: entry.loc };
  }
  if (diagnostics.length) throw new DiagnosticError(diagnostics);
  // Lexical sorting makes independent declarations deterministic. Connection IDs
  // retain an ordinal only where endpoints repeat.
  const sort = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return { version: '0.1', architecture, groups: groups.sort(sort), components: components.sort(sort), connections: connections.sort(sort) };
}
