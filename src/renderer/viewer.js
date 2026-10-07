(() => {
  'use strict';
  const model = JSON.parse(document.getElementById('drarch-model').textContent);
  const items = new Map();
  items.set(`architecture:${model.architecture.id}`, { ...model.architecture, kind: 'architecture' });
  for (const [collection, kind] of [[model.components, 'component'], [model.groups, 'group'], [model.connections, 'connection']]) {
    for (const item of collection) items.set(`${kind}:${item.id}`, { ...item, kind });
  }
  const svg = document.querySelector('.drarch-diagram');
  const canvas = document.getElementById('canvas');
  const tooltip = document.getElementById('tooltip');
  const properties = document.getElementById('inspector-properties');
  const elements = new Map([...svg.querySelectorAll('[data-key]')].map(element => [element.dataset.key, element]));
  const outline = document.getElementById('outline');
  const search = document.getElementById('search');
  let selectedKey = `architecture:${model.architecture.id}`;
  const valueText = v => v.kind === 'list' ? `[${v.items.map(valueText).join(', ')}]` : v.kind === 'number' && v.unit ? `${v.value} ${v.unit}` : v.value;
  const fieldName = name => name.replaceAll('_', ' ').replace(/^./, s => s.toUpperCase());
  const componentName = id => items.get(`component:${id}`)?.label || id;
  const itemTitle = item => item.label || (item.kind === 'connection' ? `${componentName(item.source)} ${item.bidirectional ? '↔' : '→'} ${componentName(item.target)}` : item.id);
  function itemButton(key, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => navigateTo(key));
    return button;
  }
  function addProperty(name, value, list = properties) {
    const term = document.createElement('dt'), description = document.createElement('dd');
    term.textContent = name;
    if (value instanceof Node) description.append(value);
    else description.textContent = value;
    list.append(term, description);
  }
  function showTopology(item) {
    const topology = item.kind === 'component' ? model.topology[item.id] : null;
    const section = document.getElementById('inspector-topology');
    section.hidden = !topology;
    const list = document.getElementById('topology-properties');
    const rows = document.querySelector('#topology-flows tbody');
    const notes = document.getElementById('topology-notes');
    list.replaceChildren(); rows.replaceChildren(); notes.replaceChildren();
    if (!topology) return;
    if (topology.declared) {
      addProperty('Behavior', fieldName(topology.declared.behavior), list);
      addProperty('Declared inputs', topology.declared.inputs ?? 'Unspecified', list);
      addProperty('Declared outputs', topology.declared.outputs ?? 'Unspecified', list);
      if (topology.declared.policy) addProperty('Policy', topology.declared.policy, list);
    }
    for (const flow of topology.flows) {
      const row = document.createElement('tr');
      const name = document.createElement('th');
      name.scope = 'row'; name.textContent = fieldName(flow.type); row.append(name);
      for (const count of [flow.inputs, flow.outputs]) {
        const cell = document.createElement('td'); cell.textContent = count; row.append(cell);
      }
      rows.append(row);
    }
    document.getElementById('topology-flows').hidden = !topology.flows.length;
    for (const note of topology.notes) {
      const line = document.createElement('li'); line.textContent = note; notes.append(line);
    }
    if (!topology.flows.length) {
      const line = document.createElement('li'); line.textContent = 'No connections are declared for this block.'; notes.append(line);
    }
    notes.hidden = !notes.children.length;
    const instances = document.getElementById('topology-instances');
    const count = item.properties?.count;
    instances.hidden = !count;
    instances.textContent = count ? `One compact block represents ${valueText(count)} ${Number(count.value) === 1 ? 'instance' : 'instances'}. Connections attach to the block; peer counts do not describe per-instance wiring.` : '';
  }
  function select(key, element) {
    const item = items.get(key);
    if (!item) return;
    selectedKey = key;
    hideTooltip();
    const related = new Set();
    const members = new Set(item.kind === 'component' ? [item.id] : item.kind === 'group' ? model.components.filter(component => component.id.startsWith(`${item.id}.`)).map(component => component.id) : []);
    const connections = model.connections.filter(edge => members.has(edge.source) || members.has(edge.target) || (item.kind === 'connection' && edge.id === item.id));
    for (const edge of connections) {
      related.add(`connection:${edge.id}`);
      related.add(`component:${edge.source}`);
      related.add(`component:${edge.target}`);
    }
    for (const [elementKey, target] of elements) {
      target.classList.toggle('selected', target === element);
      target.classList.toggle('related', related.has(elementKey) && target !== element);
      target.setAttribute('aria-pressed', String(target === element));
    }
    for (const button of outline.querySelectorAll('button')) {
      if (button.dataset.itemKey === key) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    document.getElementById('inspector-kind').textContent = item.type ?? item.kind;
    document.getElementById('inspector-title').textContent = itemTitle(item);
    document.getElementById('selection-status').textContent = `${itemTitle(item)} selected. Details are in the inspector.`;
    document.getElementById('inspector-id').textContent = item.id;
    const desc = document.getElementById('inspector-desc');
    desc.textContent = item.desc; desc.hidden = !item.desc;
    properties.replaceChildren();
    if (item.kind === 'architecture') {
      addProperty('Components', model.components.length);
      addProperty('Groups', model.groups.length);
      addProperty('Connections', model.connections.length);
    }
    if (item.parent) addProperty('Group', itemButton(`group:${item.parent}`, items.get(`group:${item.parent}`).label));
    if (item.source) {
      addProperty('From', itemButton(`component:${item.source}`, componentName(item.source)));
      addProperty('To', itemButton(`component:${item.target}`, componentName(item.target)));
      addProperty('Direction', item.bidirectional ? 'Bidirectional' : 'Directed');
    }
    for (const [name, value] of Object.entries(item.properties ?? {})) {
      if (item.kind === 'component' && model.topology[item.id]?.declared && ['behavior', 'inputs', 'outputs', 'policy'].includes(name)) continue;
      const label = name === 'count' && item.kind === 'component' ? 'Instances (compact block)' : fieldName(name);
      addProperty(label + (name === 'throughput' && item.type === 'compute' ? ' (per instance)' : ''), valueText(value));
    }
    showTopology(item);
    if (item.display !== undefined && item.display !== null) addProperty('Optional visible fields', item.display.join(', ') || (item.kind === 'component' ? 'No optional fields; structure remains visible' : 'No optional fields'));
    if (item.loc) addProperty('Source', `Line ${item.loc.line}, column ${item.loc.column}`);
    const connectionNav = document.getElementById('inspector-connections');
    const connectionList = connectionNav.querySelector('ul');
    connectionList.replaceChildren();
    connectionNav.hidden = !members.size || !connections.length;
    for (const edge of connections) {
      const row = document.createElement('li');
      const connection = items.get(`connection:${edge.id}`);
      const button = itemButton(`connection:${edge.id}`, itemTitle(connection));
      const detail = document.createElement('small');
      detail.textContent = `${fieldName(edge.properties.type?.value ?? 'untyped')} · ${edge.source} ${edge.bidirectional ? '↔' : '→'} ${edge.target}`;
      button.append(detail);
      row.append(button);
      connectionList.append(row);
    }
  }
  const navigableItems = [...items.values()].filter(item => item.kind === 'component' || item.kind === 'group');
  function updateOutline() {
    const query = search.value.trim().toLocaleLowerCase();
    const matches = navigableItems.filter(item => `${item.label} ${item.id} ${item.type ?? item.kind}`.toLocaleLowerCase().includes(query));
    outline.replaceChildren();
    for (const item of matches) {
      const key = `${item.kind}:${item.id}`;
      const button = itemButton(key, item.label);
      button.dataset.itemKey = key;
      if (key === selectedKey) button.setAttribute('aria-current', 'true');
      const detail = document.createElement('small');
      detail.textContent = `${item.type ?? 'group'} · ${item.id}`;
      button.append(detail);
      outline.append(button);
    }
    document.getElementById('search-count').textContent = !matches.length ? (navigableItems.length ? 'No matching blocks. Try another name or type.' : 'No blocks in this architecture.') : `${matches.length} of ${navigableItems.length} blocks and groups`;
  }
  search.addEventListener('input', updateOutline);
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); outline.querySelector('button')?.click(); }
    if (event.key === 'Escape' && search.value) { event.preventDefault(); search.value = ''; updateOutline(); }
  });
  let tooltipOwner;
  function hideTooltip() {
    tooltip.hidden = true;
    tooltipOwner?.removeAttribute('aria-describedby');
    tooltipOwner = null;
  }
  function showTooltip(element) {
    hideTooltip();
    const desc = items.get(element.dataset.key)?.desc;
    if (!desc?.trim()) return;
    tooltip.textContent = desc.length > 180 ? desc.slice(0, 177) + '…' : desc;
    tooltip.hidden = false;
    tooltipOwner = element;
    element.setAttribute('aria-describedby', 'tooltip');
    const rect = element.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(rect.bottom + 8, innerHeight - tooltip.offsetHeight - 8))}px`;
  }
  for (const element of svg.querySelectorAll('[data-key]')) {
    element.addEventListener('click', () => select(element.dataset.key, element));
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(element.dataset.key, element); }
    });
    element.addEventListener('pointerenter', () => showTooltip(element));
    element.addEventListener('pointerleave', hideTooltip);
    element.addEventListener('focus', () => showTooltip(element));
    element.addEventListener('blur', hideTooltip);
  }
  const flowControls = [...document.querySelectorAll('input[data-flow]')];
  function updateFlows() {
    const emphasized = new Set(flowControls.filter(input => input.checked).map(input => input.dataset.flow));
    for (const edge of model.connections) {
      elements.get(`connection:${edge.id}`)?.classList.toggle('flow-dimmed', !emphasized.has(edge.properties.type?.value ?? 'untyped'));
    }
    const summary = document.getElementById('flow-summary');
    if (summary) summary.textContent = emphasized.size === flowControls.length ? '(all emphasized)' : `(${emphasized.size}/${flowControls.length} emphasized)`;
    const status = document.getElementById('flow-status');
    if (status) status.textContent = emphasized.size === flowControls.length ? 'All flows emphasized.' : `${emphasized.size} of ${flowControls.length} flows emphasized. All connections remain visible.`;
  }
  for (const input of flowControls) input.addEventListener('change', updateFlows);
  const overview = () => {
    for (const input of flowControls) input.checked = true;
    updateFlows();
    select(`architecture:${model.architecture.id}`);
  };
  document.getElementById('overview').addEventListener('click', overview);
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') { hideTooltip(); overview(); return; }
    if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const actions = { f: 'fit', '0': 'actual-size', '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out' };
    if (event.key === '/') { event.preventDefault(); search.focus(); }
    else if (actions[event.key.toLowerCase()]) { event.preventDefault(); document.getElementById(actions[event.key.toLowerCase()]).click(); }
  });
  const width = svg.viewBox.baseVal.width, height = svg.viewBox.baseVal.height;
  let scale = 1, fitting = true;
  function viewportSize() {
    const padding = getComputedStyle(canvas);
    const availableWidth = canvas.clientWidth - parseFloat(padding.paddingLeft || 0) - parseFloat(padding.paddingRight || 0);
    const availableHeight = (canvas.clientHeight || height) - parseFloat(padding.paddingTop || 0) - parseFloat(padding.paddingBottom || 0);
    return { width: Math.max(1, availableWidth), height: Math.max(1, availableHeight) };
  }
  function fitScale() {
    const viewport = viewportSize();
    return Math.min(1, viewport.width / width, viewport.height / height);
  }
  function resize(value) {
    const previous = svg.getBoundingClientRect(), viewport = canvas.getBoundingClientRect();
    const centerX = viewport.left + canvas.clientWidth / 2, centerY = viewport.top + canvas.clientHeight / 2;
    const focusX = Math.max(0, Math.min(width, (centerX - previous.left) / scale));
    const focusY = Math.max(0, Math.min(height, (centerY - previous.top) / scale));
    scale = Math.max(Math.min(0.1, fitScale()), Math.min(3, value));
    svg.style.width = `${width * scale}px`; svg.style.height = `${height * scale}px`;
    const current = svg.getBoundingClientRect();
    canvas.scrollLeft = Math.max(0, canvas.scrollLeft + current.left + focusX * scale - centerX);
    canvas.scrollTop = Math.max(0, canvas.scrollTop + current.top + focusY * scale - centerY);
    document.getElementById('zoom-level').textContent = scale < 0.01 ? '<1%' : `${Math.round(scale * 100)}%`;
    document.getElementById('zoom-in').disabled = scale >= 3;
    document.getElementById('zoom-out').disabled = scale <= Math.min(0.1, fitScale());
    hideTooltip();
  }
  function fit() { fitting = true; resize(fitScale()); canvas.scrollLeft = 0; canvas.scrollTop = 0; }
  function navigateTo(key) {
    const element = elements.get(key);
    if (!element) return;
    fitting = false;
    const bounds = element.getBoundingClientRect();
    const available = viewportSize();
    // Groups and long connections fit as a whole; individual blocks return to
    // a readable scale. Selection never changes the underlying layout.
    resize(key.startsWith('component:') ? Math.max(1, scale) : Math.min(1, available.width * scale / Math.max(1, bounds.width), available.height * scale / Math.max(1, bounds.height)));
    const target = element.getBoundingClientRect(), viewport = canvas.getBoundingClientRect();
    canvas.scrollLeft = Math.max(0, canvas.scrollLeft + target.left - viewport.left - (canvas.clientWidth - target.width) / 2);
    canvas.scrollTop = Math.max(0, canvas.scrollTop + target.top - viewport.top - (canvas.clientHeight - target.height) / 2);
    select(key, element);
  }
  document.getElementById('zoom-in').addEventListener('click', () => { fitting = false; resize(scale * 1.2); });
  document.getElementById('zoom-out').addEventListener('click', () => { fitting = false; resize(scale / 1.2); });
  document.getElementById('fit').addEventListener('click', fit);
  document.getElementById('actual-size').addEventListener('click', () => { fitting = false; resize(1); });
  canvas.addEventListener('scroll', hideTooltip);
  window.addEventListener('resize', () => { if (fitting) fit(); else hideTooltip(); });
  document.documentElement.dataset.enhanced = 'true';
  updateOutline(); overview(); fit();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => { if (fitting) fit(); }).observe(canvas);
  }
})();
