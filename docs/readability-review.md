# Architecture readability review — ten passes

The review treats `.drarch` as the authored architecture source and the SVG, HTML, and JSON as derived views. A concise path must still expose repeated hardware, branching connections, and declared arbitration or routing. Connectivity alone cannot establish the behavior of a block.

The starting worktree contained the dual-tile example and related README/test edits. Those changes were preserved. The baseline suite passed 88 tests before the improvements below.

| Pass | Review finding | Improvement | Verification |
| --- | --- | --- | --- |
| 1. Behavioral contracts | Generic functions could name an arbiter without a checked input/output contract. | Added `arbitration`, `selection`, `merge`, `dispatch`, `broadcast`, and `routing` declarations. Explicit behavior requires both counts and validates the single-input or single-output side where appropriate. | `tests/topology.test.js` checks each behavior, invalid dimensions and units, missing counts, and formatting round trips. |
| 2. Connection topology | Labels and properties alone did not reveal the graph's fan-in and fan-out consistently. | Added a pure topology derivation that counts distinct peer blocks per flow. Bidirectional edges, repeated edges, self-loops, qualified IDs, and untyped flows have explicit rules. | Topology tests distinguish declared counts from observed peers, retain untyped flows, and verify model immutability. |
| 3. Structural visibility | `display: []` could hide array counts and primitive input/output counts. | Repeated instances, declared ratios and behavior, its policy, and branching peer counts remain visible. Unknown counts print `?`; an omitted arbitration policy stays unspecified. | `tests/figure-fidelity.test.js` checks compact 1:1 paths and non-1:1 visibility in SVG and HTML, including suppressed optional fields. |
| 4. Standalone figures | Exported SVGs lacked a visible architecture title and flow legend. Edge annotations were only 12px. | Added visible titles, used-flow legends, and a note explaining ratios, peers, and compact instances. Increased connection labels to 13px with matching layout measurements. A follow-up review found identical data/untyped legend samples; untyped now has a distinct long-dash style and both legends match their edges. | Figure tests parse and rasterize exports, verify the legends, and distinguish data from untyped flows. Static figures were inspected at readable scale. |
| 5. Group headings | A long nested group title expanded a two-block fixture to 2336px wide. | Wrapped group headings and reserved their complete header height before routing. | The same nested fixture measured 728px wide after the change. `tests/layout-readability.test.js` also checks empty groups, nested title containment, and deterministic placement. |
| 6. Route clarity | Existing geometry checks did not establish label/label or route/label clearance. | Added checks for unrelated component crossings, label overlap, obscured paths, header clearance, and directed endpoints. Layout sizes blocks using their connection-aware structural text. | All example layouts and a long-label vertical-column feedback fixture pass these checks. Raster review found no need to replace the existing mux/demux polygons. |
| 7. Behavioral inspection | The inspector echoed properties without separating declared dimensions from connected peers. | Added a behavior and topology section, a per-flow peer table, explicit unknowns, and an explanation of compact instances. Connection lists include qualified endpoints so identically named blocks in different tiles remain distinguishable. | Viewer tests cover declaration/peer separation, array scope, duplicate labels, and unchanged semantic data. Chrome search selected the dual-tile completion arbiter at actual size and showed declared 3→1 plus its separate response and backpressure counts. |
| 8. Flow visibility | Dense diagrams required following several overlaid flow types at once. | Added accessible flow checkboxes that dim connections while retaining every block, structural annotation, and keyboard target. Overview/Escape restores all flows. The collapsed control reports its active state. | Viewer tests exercise dimming and reset. Chrome desktop 1280×800 and mobile 390×844 checks covered keyboard toggles, selection, search, and View details. The mobile topology table fit the inspector without page overflow. |
| 9. Worked behavior | Existing examples did not provide a small acceptance/retention contract for contention. | Added `arbitrated_requests.drarch`: two queues, a 2:1 request arbiter, shared memory, and upstream stalls. Its descriptions state who retains a request and when priority advances. Added explicit 3:1 behavior to the dual-tile completion arbiter. | Both examples compile, format, render, and pass geometry checks. The focused example test checks the arbitration ratio and acceptance/priority description; its static figure was visually inspected. |
| 10. Reproducible source and views | Documentation described label-only display and did not explain how to review a source beside its generated model. | Updated the README and language reference with the structural display contract, authoring rules, behavior meanings, and limits. The gallery now links exact source copies and semantic JSON beside each HTML/SVG pair. Regenerated the examples and README preview. | Full suite, example generation, canonical format checks, source-copy equality, JSON/model equality, and whitespace validation form the final integration check. |

## How to reproduce the checks

Final local result: **136 tests passed, 0 failed**. All eight examples generated successfully; all eight sources were canonically formatted, each exported source matched byte-for-byte, each JSON model matched compilation of its source, and every gallery link resolved. `git diff --check` passed. The refreshed README preview and the arbitration, NoC, and dual-tile figures were inspected, alongside the browser checks recorded above.

```bash
npm test
npm run examples
node bin/drarch.js fmt examples/arbitrated_requests.drarch --check
node bin/drarch.js fmt examples/dual_tile_accelerator.drarch --check
```

Open `output/index.html` for the generated gallery. The focused arbitration example is `output/arbitrated_requests.html`; the larger integration example is `output/dual_tile_accelerator.html`. Each has adjacent `.svg`, `.drarch`, and `.json` files.

## Scope of the result

The compiler validates the authored architecture, not hardware equivalence or runtime correctness. Behavioral descriptions must still state acceptance, ownership, ordering, and policy conditions. Declared input/output dimensions are not checked against distinct peer counts because connections target whole blocks, including compact arrays, rather than named ports.

The example and stress-fixture geometry checks establish clearance for those inputs; they do not prove that every possible graph will be readable. The dual-tile architecture remains too large to read in full-fit overview, so the viewer's search and group navigation provide readable views of its parts. Browser checks cover Chrome at the desktop/mobile sizes above; the configured CI Node-version matrix was not run locally.
