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
  const valueText = v => v.kind === 'list' ? `[${v.items.map(valueText).join(', ')}]` : v.kind === 'number' && v.unit ? `${v.value} ${v.unit}` : v.value;
  const fieldName = name => name.replaceAll('_', ' ').replace(/^./, s => s.toUpperCase());
  function addProperty(name, value) {
    const term = document.createElement('dt'), description = document.createElement('dd');
    term.textContent = name; description.textContent = value;
    properties.append(term, description);
  }
  function select(key, element) {
    const item = items.get(key);
    if (!item) return;
    svg.querySelectorAll('.selected').forEach(e => e.classList.remove('selected'));
    if (element) element.classList.add('selected');
    document.getElementById('inspector-kind').textContent = item.type ?? item.kind;
    document.getElementById('inspector-title').textContent = item.label || item.id;
    document.getElementById('inspector-id').textContent = item.id;
    const desc = document.getElementById('inspector-desc');
    desc.textContent = item.desc; desc.hidden = !item.desc;
    properties.replaceChildren();
    if (item.kind === 'architecture') {
      addProperty('Components', model.components.length);
      addProperty('Groups', model.groups.length);
      addProperty('Connections', model.connections.length);
    }
    if (item.parent) addProperty('Group', item.parent);
    if (item.source) {
      addProperty('From', item.source); addProperty('To', item.target);
      addProperty('Direction', item.bidirectional ? 'Bidirectional' : 'Directed');
    }
    for (const [name, value] of Object.entries(item.properties ?? {})) {
      addProperty(fieldName(name) + (name === 'throughput' && item.type === 'compute' ? ' (per instance)' : ''), valueText(value));
    }
    if (item.display !== undefined && item.display !== null) addProperty('Visible fields', item.display.join(', ') || 'Label only');
    if (item.loc) addProperty('Source', `Line ${item.loc.line}, column ${item.loc.column}`);
  }
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
  const overview = () => select(`architecture:${model.architecture.id}`);
  document.getElementById('overview').addEventListener('click', overview);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { hideTooltip(); overview(); } });
  const width = svg.viewBox.baseVal.width, height = svg.viewBox.baseVal.height;
  let scale = 1, fitting = true;
  function resize(value) {
    scale = Math.max(0.1, Math.min(3, value));
    svg.style.width = `${width * scale}px`; svg.style.height = `${height * scale}px`;
    document.getElementById('zoom-level').textContent = `${Math.round(scale * 100)}%`;
    hideTooltip();
  }
  function fit() { fitting = true; resize(Math.min(1, (canvas.clientWidth - (innerWidth <= 760 ? 16 : 48)) / width)); }
  document.getElementById('zoom-in').addEventListener('click', () => { fitting = false; resize(scale * 1.2); });
  document.getElementById('zoom-out').addEventListener('click', () => { fitting = false; resize(scale / 1.2); });
  document.getElementById('fit').addEventListener('click', fit);
  canvas.addEventListener('scroll', hideTooltip);
  window.addEventListener('resize', () => { if (fitting) fit(); else hideTooltip(); });
  overview(); fit();
})();
