const storage = new Set(['B', 'KB', 'MB', 'GB', 'TB', 'KiB', 'MiB', 'GiB', 'TiB']);
const time = new Set(['ns', 'us', 'ms', 's']);
export function quantityOf(unit) {
  if (!unit) return 'scalar';
  if (storage.has(unit)) return 'capacity';
  if (unit === 'bit' || unit === 'bits') return 'width';
  if (unit === 'entry' || unit === 'entries') return 'entries';
  if (unit === 'cycle' || unit === 'cycles') return 'cycle_latency';
  if (time.has(unit)) return 'time_latency';
  const [numerator, denominator, extra] = unit.split('/');
  if (!extra && (denominator === 'cycle' || time.has(denominator))) {
    const basis = denominator === 'cycle' ? 'cycle' : 'time';
    if (storage.has(numerator) || ['bit', 'bits', 'Kbit', 'Mbit', 'Gbit'].includes(numerator)) return `${basis}_bandwidth`;
    if (numerator === 'op') return `${basis}_throughput`;
    if (numerator === 'req') return `${basis}_request_rate`;
    if (numerator === 'entry' || numerator === 'entries') return `${basis}_entry_rate`;
  }
  return 'custom';
}

const bandwidth = ['cycle_bandwidth', 'time_bandwidth'];
const throughput = ['cycle_throughput', 'time_throughput', 'cycle_request_rate', 'time_request_rate'];
const rate = [...bandwidth, ...throughput, 'cycle_entry_rate', 'time_entry_rate'];
export const RULES = {
  depth: { quantities: ['scalar', 'entries'], integer: true, positive: true, example: '32 or 32 entries' },
  count: { quantities: ['scalar'], integer: true, positive: true, example: '4' },
  inputs: { quantities: ['scalar'], integer: true, positive: true, example: '4' },
  outputs: { quantities: ['scalar'], integer: true, positive: true, example: '4' },
  stages: { quantities: ['scalar'], integer: true, positive: true, example: '4' },
  width: { quantities: ['scalar', 'width'], integer: true, positive: true, example: '4 or 256 bit' },
  capacity: { quantities: ['capacity'], positive: true, example: '512 KB' },
  line_size: { quantities: ['capacity'], positive: true, example: '64 B' },
  latency: { quantities: ['cycle_latency', 'time_latency'], example: '4 cycle or 40 ns' },
  bandwidth: { quantities: bandwidth, example: '32 B/cycle or 128 GB/s' },
  read_bw: { quantities: bandwidth, example: '32 B/cycle' },
  write_bw: { quantities: bandwidth, example: '32 B/cycle' },
  input_bw: { quantities: rate, example: '2 req/cycle or 32 B/cycle' },
  output_bw: { quantities: rate, example: '2 req/cycle or 32 B/cycle' },
  throughput: { quantities: throughput, example: '4 op/cycle' },
  rate: { quantities: rate, example: '2 req/cycle or 32 B/cycle' },
};

export function lowerValue(value) {
  if (value.kind === 'list') return { kind: 'list', items: value.items.map(lowerValue), loc: value.loc };
  if (value.kind === 'number') return { ...value, quantity: quantityOf(value.unit) };
  return { ...value };
}

export function valueText(value) {
  if (value.kind === 'list') return `[${value.items.map(valueText).join(', ')}]`;
  return value.kind === 'number' && value.unit ? `${value.value} ${value.unit}` : value.value;
}
