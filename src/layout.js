import ELK from 'elkjs/lib/elk.bundled.js';
import { componentPresentation, connectionLabel, textWidth, wrap } from './renderer/presentation.js';

const ROOT = '$root';
const feedback = new Set(['backpressure', 'credit', 'response']);
const layoutOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.randomSeed': '1',
  'elk.spacing.nodeNode': '44',
  'elk.spacing.edgeNode': '24',
  'elk.spacing.edgeEdge': '18',
  'elk.layered.spacing.nodeNodeBetweenLayers': '72',
  'elk.layered.spacing.edgeNodeBetweenLayers': '24',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.crossingMinimization.forceNodeModelOrder': 'false',
  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
  'elk.layered.mergeEdges': 'false',
  'elk.layered.mergeHierarchyEdges': 'false',
  'elk.padding': '[top=40,left=32,bottom=32,right=32]',
};

// Layout IR: text, measured rectangles, hierarchy, edges, and soft column hints.
// It has no parser dependencies and never mutates the semantic model.
export function toLayoutIR(model) {
  return {
    id: ROOT,
    groups: model.groups.map(g => ({ id: g.id, parent: g.parent, label: g.label, columns: g.layout?.columns ?? [] })),
    nodes: model.components.map(c => ({ id: c.id, parent: c.parent, ...componentPresentation(c) })),
    edges: model.connections.map(e => ({ id: e.id, source: e.source, target: e.target, label: connectionLabel(e), feedback: feedback.has(e.properties.type?.value) })),
    columns: model.architecture.layout?.columns ?? [],
  };
}

export async function layout(model) {
  const input = toLayoutIR(model);
  const containers = new Map();
  const root = { id: ROOT, children: [], edges: [], layoutOptions: { ...layoutOptions } };
  containers.set(ROOT, root);
  const parents = new Map(), partition = new Map();
  for (const group of input.groups) {
    parents.set(group.id, group.parent ?? ROOT);
    containers.set(group.id, {
      id: group.id, children: [],
      width: Math.max(220, textWidth(group.label, 15) + 64), height: 100,
      layoutOptions: { ...layoutOptions, 'elk.padding': '[top=58,left=28,bottom=28,right=28]', 'elk.nodeSize.constraints': 'MINIMUM_SIZE', 'elk.nodeSize.minimum': `(${Math.max(220, textWidth(group.label, 15) + 64)},100)` },
    });
  }
  for (const group of input.groups) containers.get(group.parent ?? ROOT).children.push(containers.get(group.id));
  for (const node of input.nodes) {
    parents.set(node.id, node.parent ?? ROOT);
    containers.get(node.parent ?? ROOT).children.push({ id: node.id, width: node.width, height: node.height, layoutOptions: {} });
  }
  for (const scope of [{ id: ROOT, columns: input.columns }, ...input.groups]) {
    const container = containers.get(scope.id);
    if (!scope.columns.length) { container.children.sort((a, b) => a.id < b.id ? -1 : 1); continue; }
    const ordered = scope.columns.flat();
    scope.columns.forEach((col, i) => col.forEach(id => partition.set(id, i)));
    // Unspecified children share the final suggested partition. This keeps hints
    // partial and leaves the final placement and routing to ELK.
    for (const child of container.children) {
      if (!partition.has(child.id)) partition.set(child.id, scope.columns.length);
      child.layoutOptions['elk.partitioning.partition'] = String(partition.get(child.id));
    }
    container.layoutOptions['elk.partitioning.activate'] = 'true';
    container.layoutOptions['elk.separateConnectedComponents'] = 'false';
    container.children.sort((a, b) => {
      const rank = id => ordered.includes(id) ? ordered.indexOf(id) : ordered.length;
      return rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : 1);
    });
  }
  const reversed = new Set();
  const columnOf = new Map(), columnLayouts = new Map(), internalEdges = new Set();
  for (const scope of [{ id: ROOT, columns: input.columns }, ...input.groups]) {
    for (const [index, members] of scope.columns.entries()) {
      if (members.length < 2 || members.some(id => containers.has(id))) continue;
      const id = `$column:${scope.id}:${index}`;
      for (const [order, member] of members.entries()) columnOf.set(member, { id, order });
    }
  }
  const ancestorPath = id => {
    const result = [id];
    while (parents.has(result.at(-1))) result.push(parents.get(result.at(-1)));
    return result.reverse();
  };
  const makeEdge = edge => {
    const a = ancestorPath(edge.source), b = ancestorPath(edge.target);
    let i = 0; while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
    const pa = partition.get(a[i]), pb = partition.get(b[i]);
    const sameColumn = columnOf.has(edge.source) && columnOf.get(edge.source).id === columnOf.get(edge.target)?.id;
    const reverse = sameColumn ? columnOf.get(edge.source).order > columnOf.get(edge.target).order : pa !== undefined && pb !== undefined && pa !== pb ? pa > pb : edge.feedback;
    if (reverse) reversed.add(edge.id);
    const lines = edge.label ? wrap(edge.label, 240, 12) : [];
    return {
      id: edge.id, sources: [reverse ? edge.target : edge.source], targets: [reverse ? edge.source : edge.target],
      labels: lines.length ? [{ text: lines.join('\n'), width: Math.max(...lines.map(l => textWidth(l, 12))) + 12, height: lines.length * 18 + 8,
        layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' } }] : [],
    };
  };
  const elkEdges = new Map(input.edges.map(edge => [edge.id, makeEdge(edge)]));
  const elk = new ELK();
  // ELK layered normally separates connected nodes into successive layers.
  // For an explicit vertical column, let a second ELK graph arrange and route
  // its contents downward. The outer graph sees one rectangle with fixed ports.
  // These rectangles, ports, and ordering edges exist only in Layout IR.
  for (const scope of [{ id: ROOT, columns: input.columns }, ...input.groups]) {
    const container = containers.get(scope.id);
    for (const members of scope.columns) {
      const column = columnOf.get(members[0]);
      if (!column) continue;
      const memberSet = new Set(members);
      const children = members.map(id => {
        const node = container.children.find(child => child.id === id);
        return { id, width: node.width, height: node.height };
      });
      const edges = input.edges.filter(edge => memberSet.has(edge.source) && memberSet.has(edge.target)).map(edge => {
        internalEdges.add(edge.id); return elkEdges.get(edge.id);
      });
      for (let i = 1; i < members.length; i++) {
        if (!edges.some(edge => edge.sources[0] === members[i - 1] && edge.targets[0] === members[i])) {
          edges.push({ id: `$order:${column.id}:${i}`, sources: [members[i - 1]], targets: [members[i]] });
        }
      }
      const inner = await elk.layout({ id: column.id, children, edges, layoutOptions: {
        ...layoutOptions, 'elk.direction': 'DOWN', 'elk.padding': '[top=0,left=24,bottom=0,right=24]',
        'elk.separateConnectedComponents': 'false',
      } });
      const columnNode = { id: column.id, width: inner.width, height: inner.height, ports: [], layoutOptions: {
        'elk.portConstraints': 'FIXED_POS', 'elk.partitioning.partition': String(partition.get(members[0])),
      } };
      const firstIndex = container.children.findIndex(child => child.id === members[0]);
      container.children.splice(firstIndex, 0, columnNode);
      container.children = container.children.filter(child => !memberSet.has(child.id));
      columnLayouts.set(column.id, { graph: inner, node: columnNode });
    }
  }
  const endpoints = new Map(), portsByMember = new Map();
  for (const edge of input.edges) {
    if (internalEdges.has(edge.id)) continue;
    const elkEdge = elkEdges.get(edge.id);
    for (const [field, side] of [['sources', 'EAST'], ['targets', 'WEST']]) {
      const member = elkEdge[field][0], column = columnOf.get(member);
      if (!column) continue;
      const key = `${member}:${side}`;
      if (!portsByMember.has(key)) portsByMember.set(key, []);
      portsByMember.get(key).push({ edge: elkEdge, field, side, member, column });
    }
    root.edges.push(elkEdge);
  }
  for (const list of portsByMember.values()) {
    for (const [index, endpoint] of list.entries()) {
      const { edge, field, side, member, column } = endpoint;
      const { graph: inner, node } = columnLayouts.get(column.id);
      const box = inner.children.find(child => child.id === member);
      const y = box.y + box.height * (index + 1) / (list.length + 1);
      const x = side === 'EAST' ? node.width : 0;
      const port = { id: `$port:${edge.id}:${field}`, width: 0, height: 0, x, y, layoutOptions: { 'elk.port.side': side } };
      node.ports.push(port); edge[field] = [port.id];
      endpoints.set(port.id, { column: column.id, x: side === 'EAST' ? box.x + box.width : box.x, y });
    }
  }
  const graph = await elk.layout(root);
  const offsets = new Map([[ROOT, { x: 0, y: 0 }]]), nodes = [], groups = [];
  function collect(container, ox, oy) {
    for (const child of container.children ?? []) {
      const x = ox + (child.x ?? 0), y = oy + (child.y ?? 0);
      offsets.set(child.id, { x, y });
      const box = { id: child.id, x, y, width: child.width, height: child.height };
      if (columnLayouts.has(child.id)) collect(columnLayouts.get(child.id).graph, x, y);
      else if (containers.has(child.id)) { groups.push(box); collect(child, x, y); }
      else nodes.push(box);
    }
  }
  collect(graph, 0, 0);
  const edges = [];
  function collectEdges(container) {
    for (const edge of container.edges ?? []) {
      if (edge.id.startsWith('$order:')) continue;
      const offset = offsets.get(edge.container ?? container.id);
      if (!offset || !edge.sections?.length) throw new Error(`Layout did not route connection ${edge.id}.`);
      const point = p => ({ x: p.x + offset.x, y: p.y + offset.y });
      const paths = edge.sections.map(section => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(point));
      const source = endpoints.get(edge.sources[0]), target = endpoints.get(edge.targets[0]);
      const endpointPoint = endpoint => ({ x: endpoint.x + offsets.get(endpoint.column).x, y: endpoint.y + offsets.get(endpoint.column).y });
      if (source) paths[0].unshift(endpointPoint(source));
      if (target) paths.at(-1).push(endpointPoint(target));
      if (reversed.has(edge.id)) { paths.reverse(); paths.forEach(path => path.reverse()); }
      edges.push({ id: edge.id, paths, labels: (edge.labels ?? []).map(label => ({ ...point(label), width: label.width, height: label.height, lines: label.text.split('\n') })) });
    }
    for (const child of container.children ?? []) collectEdges(child);
  }
  collectEdges(graph);
  for (const { graph: inner } of columnLayouts.values()) collectEdges(inner);
  return { width: Math.max(graph.width ?? 0, 320), height: Math.max(graph.height ?? 0, 160), nodes, groups, edges };
}
