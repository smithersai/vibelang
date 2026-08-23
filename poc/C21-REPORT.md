# C21 durable intrinsic report

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

Date: 2026-08-23

## Outcome

The Go fork now recognizes the compiler-owned durable surface and lowers a useful checked-AST subset to a static, serializable, digest-pinned Plan descriptor. A successfully lowered call emits `{ artifactSource, id, plan, version }`; it does not emit or retain a runtime callback wrapper.

The live repository was renamed from VibeLang/VIBE to Smithers while this lane was in progress. The checked-in TypeScript reference and normative document now use `smithers:flows` and `SMITHERS41xx`. The Go bridge accepts both `vibelang:flows` (the task's pinned spelling) and `smithers:flows` as aliases of the same compiler-owned virtual module, and reports the live reference's `SMITHERS41xx` codes.

## Files and integration

- `compiler/forkbridge/durable.go.txt` is the checked-AST Plan lowerer and compiler-owned flows module.
- `compiler/forkbridge/lowering.go.txt` gives the flows module an isolated resolution target, rewrites its emitted import to `__smithers_flows.js`, and invokes durable lowering at the expression visitor.
- `compiler/forkbridge/main.go.txt` injects the flows module into checking and emission with a collision guard.
- `compiler/fork.go` embeds the new bridge unit as `cmd/tsc/smithersdurable.go`.
- `compiler/fork_durable_test.go` contains pinned-fork semantic, fail-closed, artifact-validation, and determinism tests.
- `conformance/corpus/17-durable/` contains three new corpus cases.

No forkpatch, PoC source, root source, vendor, docs, or `cmd/vibec`/`cmd/smithersc` implementation file was changed by this lane.

## Resolved intrinsic identity

`smithers:flows` and compatibility spelling `vibelang:flows` resolve through compiler `paths` to the distinct virtual source `/src/__smithers_flows.ts`. Recognition asks the checker for the expression's symbol, repeatedly unwraps aliases, and accepts it only when a declaration belongs to that virtual source and has the expected exported declaration. Type-only imports do not count.

This identity rule covers:

- `durable`, including named aliases and namespace access;
- the `Action` base used in a class heritage clause;
- `sleep`, `waitSignal`, `fanOut`, `sequential`, `loopWhile`, `dequeue`, and `waitBroadcast`;
- the compiler-owned Flow `run` surface, which is recognized for a fail-closed child-flow diagnostic in the current subset.

Consequently, `import { durable as compileFlow } ...` lowers, while an unrelated local function named `durable` remains an ordinary runtime function. A re-export from another compiler-owned module cannot acquire durable authority by spelling alone. Direct Action subclasses are found from their resolved heritage symbol, not a class or property name.

The source function may be an inline arrow/function, a same-file `const` initialized by one, or a same-file function declaration. Assigned or ambiguous bindings are rejected instead of guessed.

## Lowered subset

The following now lowers in Go:

- exactly one plain durable input parameter and a synchronous block body with an explicit return;
- straight-line `const` bindings;
- canonical scalar, array, and object literals, including shorthand properties;
- input projections and projections from prior symbolic bindings;
- direct calls to locally declared or imported direct `Action` subclasses, with checked Action input assignability and structural input/success schemas;
- direct final `Action.run(...)` results;
- `.unwrap()` directly on an Action result, represented as an error-propagating sequencing dependency on later nodes;
- conditional expressions, represented by an explicit branch node and true/false fragments rather than by observing an Action result;
- `sleep(duration)` timer nodes for statically bound finite nonnegative durations;
- typed `waitSignal<Payload>("portable.identity")` signal nodes with structural payload schemas and duplicate-identity rejection;
- `sequential(firstAction, secondAction)` with an explicit control dependency from the second Action to the first;
- structural persistence descriptors for primitives, literals, unions, arrays, tuples, and plain objects with optional fields.

The descriptor contains the reference Plan fields, node dependencies/control dependencies, action and signal contracts, sorted requirements, schemas, and debug metadata. Synthetic Plan object/array/scalar nodes are built exclusively with the fork AST factory and printed by the fork printer. Synthesized Plan data carries no authored source mapping; authored diagnostics retain authored spans.

## Fail-closed boundary and remaining TypeScript surface

The Go subset intentionally rejects rather than approximates:

- stable-key `fanOut`, including multi-step templates (`SMITHERS4117`);
- child Flow invocation (`SMITHERS4120`);
- budgeted `loopWhile` (`SMITHERS4121`);
- broadcast waits (`SMITHERS4122`);
- queue dequeue (`SMITHERS4123`);
- statement `if`/`switch` and loops (`SMITHERS4106`/`SMITHERS4107`);
- optional/dynamic projections, dynamic or higher-order calls, unsupported captures, and non-persistence types;
- complete composed success/error schema inference across arbitrary Action-result projections. Action-bearing flows currently use the reference legacy success/error schema where a sound composed result type is not available.

The TypeScript instrument additionally implements the rejected fan-out, child-flow, loop, broadcast, and queue forms. Those are the principal remaining semantic gap. No unsupported form is left partially lowered.

## Proof that lowering executes no author code

There is no evaluator, VM, proxy, symbolic callback invocation, or Action implementation call in the durable bridge. The only lowering entry point receives a checked call-expression node. It resolves the function declaration, walks statements and expressions, asks the checker for symbols/types/signatures, and constructs IR data plus AST-factory literals.

The compiler-owned runtime bodies for `durable`, `Action.run`, `sleep`, `waitSignal`, `fanOut`, `loopWhile`, `dequeue`, and `waitBroadcast` throw if an unlowered intrinsic reaches runtime. The positive tests also inspect emitted JavaScript and fail if the source `compileFlow(...)` callback survives. The same-spelled-local test proves that ordinary author code is not intercepted.

## Canonical bytes, IDs, and artifact compatibility

Stable node IDs are SHA-256-derived from the reference-style semantic identity plus deterministic occurrence count and are truncated to the reference's 24-hex form. Plan/schema/contract digests use canonical JSON with UTF-16 key ordering and ECMAScript-compatible string/number serialization. Requirements are sorted and deduplicated. Literal object properties are emitted in canonical order; `__proto__` uses a computed factory-built property so it remains data.

The pinned test compiles byte-identical checked input twice and requires byte-identical emitted `main.js`, including node IDs and the 64-hex Plan digest. It then passes the Go-emitted Plan to the TypeScript `PlanArtifact.validate` implementation and requires the validator's recomputed digest to equal the Go digest.

Exact emitted-byte parity with `compileDurableSource` is not claimed. The standalone TypeScript API receives externally supplied Action/Flow descriptors and normalizes its synthetic source filename differently, whereas this Go compiler derives contracts from checked local/imported Action subclasses inside the normal project compilation. Artifact validation, node/control-edge assertions, matching digest recomputation, and deterministic recompilation establish semantic and canonical-artifact compatibility for the landed subset.

## Corpus coverage

New cases:

- `17-durable/unrelated-local-durable-stays-ordinary`: both JS and Go pass; proves spelling is not authority.
- `17-durable/static-plan-shape-is-digest-pinned`: Go passes; observes the static descriptor marker, node sequence `action,branch,timer,action,action,signal`, 64-character digest, unwrap edge, sequential edge, and sorted requirements.
- `17-durable/statement-branch-fails-closed`: Go passes with exact `SMITHERS4106` at authored line 4, column 3.

Final isolated area result using the real runner backends and the pinned checkout:

```text
JS reference:  1/3 pass, 2 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Go fork match: 3/3 match the reference, 0 xfail, 0 unsupported, 0 divergent, 0 unmeasured
Backend agreement: 1/3 identical observations
```

The two JS xfails are explicit adapter limitations, not claimed reference failures: `conformance/runner` sends JS cases only through `poc/src/language/compileProject`, which does not compose the standalone `poc/src/durable/source-compiler.ts`. It therefore cannot currently observe durable Plan IR or its `SMITHERS4106` diagnostic. The expectation files cite that source and state the limitation. The standalone TypeScript artifact validator is exercised directly by the Go pinned test.

The exact requested unfiltered command could not produce a final shared-tree scoreboard at handoff because a concurrently added, out-of-scope case is incomplete:

```text
conformance/corpus/21-native-pin/a-clean-graph-satisfies-the-pin.sm:
missing the sibling a-clean-graph-satisfies-the-pin.expected.json expectation
```

The runner fails during corpus loading before applying `--filter` or starting either backend. This lane did not modify area 21. Immediately before that concurrent incomplete case appeared, the expanded shared corpus already contained unrelated non-durable Go unsupported/divergent cases outside area 17; they were not changed or hidden by C21. Area 17 itself remains fully measured with zero Go divergences and zero unmeasured cases by invoking the runner's exported `runConformance` with the three area-17 case objects.

## Verification

- Pinned checkout status: `state: applied`, `divergentFromApplied: 0`.
- `go build ./...`: pass.
- `go vet ./compiler ./cmd/smithersc-go`: pass. (`cmd/vibec-go` has been renamed in the live tree.)
- `go test ./compiler -count=1` against `/private/tmp/vibelang-ts-fork-cache/c087644e82dc3d48cf87e4c5519eeaaea9daf35c`: pass, 166.721s.
- `go test ./compiler -run '^TestPinnedForkDurable' -count=1 -v`: both durable tests pass, including TypeScript artifact validation.
- `git diff --check` on C21-owned implementation and corpus paths: pass.
- Isolated `17-durable` both-backend measurement: results above, zero Go divergence and zero unmeasured.
- Exact unfiltered `node conformance/runner/run.mjs --backend both --jobs 1`: blocked before measurement by the missing out-of-scope area-21 expectation described above.

SOURCE SETTLED
