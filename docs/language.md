# Drarch v0.1 language reference

Drarch describes architectural blocks and their connections. The compiler validates the description, preserves it in a semantic model, and uses ELK to produce an SVG or an offline HTML viewer.

This reference records the syntax and schemas implemented in the first version. The README also contains longer-term design goals.

## Source structure

A file contains exactly one `arch Name { ... }` block. Architecture and group bodies accept properties, component declarations, nested groups, connections, and one optional layout block. Component and connection bodies accept properties only.

Identifiers match `[A-Za-z_][A-Za-z_0-9]*`. Identifiers are case-sensitive and unique within their containing scope. A component and group cannot share an identifier in that scope. Declarations may follow references. Qualified references, such as `execution.array.pe`, name components inside groups; they never name ports.

References resolve in the containing group first, then successive enclosing groups, then the architecture. Connection endpoints must resolve to components. Multiple edges between the same endpoints and self-loops are supported. Connection validation does not impose mux fan-in or demux fan-out limits.

Whitespace separates tokens. A property uses `name: value`; no semicolons are needed. Values can be JSON-style quoted strings, bare identifiers, numbers, numbers with units, or comma-separated lists. Lists accept a trailing comma. `//` introduces a comment through the end of the line. Group and list nesting are each bounded at 64 levels.

```text
arch Example {
    desc: "A small request datapath."

    queue requests {
        label: "Request Queue"
        depth: 32 entries
    }

    generic sched {
        label: "Scheduler"
        width: 4
        display: [width]
    }

    requests -> sched { type: request rate: 4 req/cycle }
    sched -> requests { type: backpressure }
}
```

Strings support escapes such as `\n`, `\t`, `\"`, and `\uXXXX`. Literal line breaks, XML-incompatible control characters, and unpaired Unicode surrogates are rejected. Descriptions preserve explicit line breaks in the inspector.

## Properties

Architectural properties are optional unless a declared behavior requires them. Each primitive accepts exactly the fields below in addition to the presentation fields `label`, `desc`, and `display`.

| Primitive | Architectural fields |
| --- | --- |
| `queue` | `depth`, `input_bw`, `output_bw` |
| `buffer` | `capacity`, `read_bw`, `write_bw`, `latency` |
| `register` | `width`, `count` |
| `compute` | `count`, `throughput`, `latency` |
| `memory` | `kind`, `capacity`, `bandwidth`, `read_bw`, `write_bw`, `latency`, `line_size` |
| `mux` | `inputs`, `width`, `latency` |
| `demux` | `outputs`, `width`, `latency` |
| `crossbar` | `inputs`, `outputs`, `width`, `bandwidth`, `latency` |
| `generic` | Any property; known fields retain the checks below |

`label` and `desc` must be quoted strings. The default label is the local component or group identifier; the default description is empty. Architectures and groups accept `label` and `desc` but no architectural properties. Duplicate property names are errors.

`kind` and `policy` accept a string or identifier. `behavior` on `generic` accepts the values below. Other custom fields on `generic` may contain any supported value, including lists and quantities with custom units. The compiler preserves custom values without assigning them architectural meaning.

### Behavior and topology

An architecture figure must show where a path selects, arbitrates, splits, or combines work. Use `behavior`, `inputs`, and `outputs` on a `generic` block to state the intended function. An explicit behavior requires both counts as positive unitless integers.

| Behavior | Meaning | Required shape |
| --- | --- | --- |
| `arbitration` | Chooses one competing input for the output; `policy` names the selection rule | N → 1 |
| `selection` | Selects one input for an output under a selection control | N → 1 |
| `merge` | Combines input streams into one output; describe ordering and combining rules | N → 1 |
| `dispatch` | Sends an input item to a selected output | 1 → N |
| `broadcast` | Sends an input item to all outputs; describe acceptance across receivers | 1 → N |
| `routing` | Routes between inputs and outputs; describe route selection and contention | N → M |

These are architectural declarations, not executable state machines. N and M may be one. A mux intrinsically declares selection with one output, a demux dispatch with one input, and a crossbar routing. Their other counts remain optional; the figure prints `?` when a count is unspecified. An arbitration declaration with no policy prints `Policy: unspecified`. A generic block with counts but no behavior prints `Declared I/O` without claiming an operation.

```text
generic arb {
    behavior: arbitration
    inputs: 3
    outputs: 1
    policy: round_robin
    desc: "The winner retains its request until the output accepts it. Priority rotates after acceptance."
    display: []
}
```

The figure always shows the declared behavior and ratio, even with `display: []`. A separate arbiter can drive a mux with a control flow; if one block includes both arbitration and payload selection, state that in its description. The compiler does not infer readiness, ordering, fairness, broadcast atomicity, or per-cycle capacity from a behavior name or policy string. State those conditions and ownership changes in `desc`.

The renderer also derives **peer counts** from the connections. For each flow type, the figure lists input and output peers when either count exceeds one. A peer is a distinct component ID, including its group-qualified path. Parallel connections of the same type to the same block count once. Bidirectional connections contribute once in each direction; a self-loop counts the component itself in both directions. Connections with no flow type stay `untyped`. Different flow types are counted separately, so data and backpressure do not become one combined ratio.

Peer counts describe graph connectivity, not physical ports, runtime arbitration, or internal wiring of a compact array. Declared input/output counts and connected peer counts can differ. The compiler does not check one against the other because the language connects whole blocks, not individual ports. The HTML inspector shows both independently. The JavaScript API exports `componentTopology(component, connections)` for the same derived information without modifying the semantic model.

### Numeric values and units

Numbers retain their original spelling, including decimal precision and exponents. Rates and latencies are nonnegative. Counts, widths, capacities, and line sizes must be positive. Counts and widths must be safe integers (at most 9,007,199,254,740,991). Known numeric fields reject nonfinite values.

| Field | Accepted quantity |
| --- | --- |
| `depth` | Integer with no unit, `entry`, or `entries` |
| `count`, `inputs`, `outputs`, `stages` | Unitless integer |
| `width` | Integer with no unit, `bit`, or `bits` |
| `capacity`, `line_size` | Storage capacity |
| `latency` | Cycles or elapsed time |
| `bandwidth`, `read_bw`, `write_bw` | Bytes or bits per cycle or time unit |
| `throughput` | Operations or requests per cycle or time unit |
| `input_bw`, `output_bw`, connection `rate` | Bandwidth, operations, requests, or entries per cycle or time unit |

Storage units are `B`, `KB`, `MB`, `GB`, `TB`, `KiB`, `MiB`, `GiB`, and `TiB`. Elapsed-time units are `ns`, `us`, `ms`, and `s`; cycle latencies use `cycle` or `cycles`.

A rate uses a numerator followed by `/cycle`, `/ns`, `/us`, `/ms`, or `/s`. Numerators can be a storage unit, `bit`, `bits`, `Kbit`, `Mbit`, `Gbit`, `op`, `req`, `entry`, or `entries`, subject to the field's quantity requirement. Units are case-sensitive. A number and its unit must be on the same source line.

The model distinguishes cycle-based and time-based quantities. It never converts unit scales, needs a clock frequency, or compares their magnitudes. Compute throughput applies to each instance. An edge rate is preserved even when the connected component has `count: 8`.

### Visible properties

The README's default display table is implemented. A supplied `display` list replaces the optional fields, in the listed order. Each entry must be a distinct architectural property present on the same element. `display: []` suppresses optional properties while retaining structural information: repeated-instance counts greater than one, declared behavior and input/output ratios, its policy when supplied, and per-flow branching peer counts. Instance counts appear once in the heading, such as `PE ×4`. A count of one may be suppressed. Other hidden properties remain in the inspector.

```text
memory l2 {
    capacity: 1 MB
    bandwidth: 32 B/cycle
    latency: 8 cycle
    display: [capacity, latency]
}
```

## Connections

Use `a -> b` for a directed connection or `a <-> b` for a bidirectional connection. Optional properties are `label`, `desc`, `display`, `type`, `rate`, `bandwidth`, and `latency`. A connection's explicit label replaces its automatic annotation. Otherwise, the annotation shows its visible type, rate, bandwidth, and latency, when present.

Flow types are `data`, `request`, `response`, `control`, `backpressure`, `credit`, and `dependency`. Untyped connections remain neutral; quantity units never infer a flow type. Styling uses restrained line weights and dash patterns. The viewer can inspect a connection by click or keyboard.

## Layout hints

Every architecture or group can contain one `layout` block:

```text
layout {
    columns: [requests, sched, [pe, l2]]
}
```

Outer entries suggest left-to-right order. A nested list suggests top-to-bottom order in one column. Every entry must name a direct child component or group of that scope. To arrange a group's contents, put its layout block inside the group. Entries cannot repeat, and inner lists cannot be empty. Partial lists are valid; unspecified children are placed after the suggested columns, with connection-based layout within that remainder.

Without hints, ELK infers order from connections. Returning flow types (`response`, `credit`, `backpressure`) influence placement as upstream flows; their arrows retain the declared direction. A bidirectional edge uses its written left-to-right order for layout. Cycles and disconnected blocks use deterministic engine settings and sorted IDs as a fallback.

The adapter uses ELK partitions for column order. For a nested list consisting entirely of components, a separate downward ELK layout arranges its contents; the outer layout routes connections through generated attachment points. These temporary containers, ports, and ordering edges do not enter the semantic model or the exported diagram. Lists containing groups use soft partition and model-order preferences; exact vertical stacking of such groups is not guaranteed in this version.

ELK still controls spacing, sizing, and routing. No source coordinates or manual canvas editing are supported. Dense cyclic graphs and complex group arrangements may need different grouping or hints. Component, connection, and group labels wrap using conservative font measurements; long group titles reserve additional header space rather than stretching the entire diagram. System font differences can affect their appearance.

## Formatting and diagnostics

`drarch fmt` normalizes indentation and property order while preserving numbers and units. It retains comments with their statements; a comment embedded in a list moves above its property. Declarations and connections retain their source order. `--stdout` prints without modifying the file; `--check` exits with status 1 when the source needs formatting.

Syntax diagnostics stop at the first parse error. Semantic validation collects multiple errors. Diagnostics include a code, file, line, column, highlighted source, and an explanation or suggestion.

| Code | Meaning |
| --- | --- |
| `DRARCH101` | Invalid token or string |
| `DRARCH102` | Invalid syntax |
| `DRARCH201` | Unknown or invalid component reference |
| `DRARCH202` | Duplicate identifier, property, or layout |
| `DRARCH203` | Unsupported property |
| `DRARCH204` | Wrong value type or units |
| `DRARCH205` | Invalid known value or display list |
| `DRARCH206` | Invalid declaration or hierarchy |
| `DRARCH207` | Invalid layout hint |

## Semantic model and rendering

`drarch inspect --json` outputs versioned JSON containing architecture metadata and arrays of groups, components, and connections. Components have qualified stable IDs, explicit parents, typed values, descriptions, display preferences, and source locations. Numbers are strings so `1.700` survives inspection and formatting unchanged. Parallel connections have endpoint-based IDs with an occurrence suffix. Coordinates exist only in the separate Layout IR.

HTML contains inline SVG, styles, the semantic model with a derived topology map, and viewer code. It makes no external requests and requires no server. Search finds components and groups by label, qualified ID, or type. Selecting a search result brings it into view; selecting a component highlights its connected paths. The inspector links to parent groups and connection endpoints and separates declared behavior from connected peer counts. The Flows controls show only used types and dim unchecked flows without removing blocks, structural annotations, or keyboard access. Overview restores every flow.

Fit sizes the entire diagram to the canvas width and height. Actual size restores 100% zoom. Keyboard controls are `/` for search, `F` for fit, `0` for actual size, and `+` / `-` for zoom. Tab, Enter, and Space focus and select elements. Escape clears an active search first, then returns to architecture details. Zoom and selection do not recompute layout. On small screens, View details links to the inspector below the canvas. Without JavaScript, the diagram and architecture metadata remain visible. SVG exports contain no scripts and can be used directly in documents.

Static SVG exports include a visible architecture title, a legend for the flows present, and a note distinguishing declared ratios from peer counts. They include no scripts. The implementation deliberately omits simulation, utilization estimates, unit conversion, individually named ports in the source language, a browser source editor, and manual positioning.
