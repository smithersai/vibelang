**VibeLang implementation and specification review — September 5, 2026**

The design has a coherent core: ordinary TypeScript control flow, explicit `Result` contracts, inferred capability requirements, and durable execution driven by effects. The implementation has substantial validation infrastructure, including independent backends, emitted-TypeScript checking, replay/crash tests, and package verification. The largest remaining problems are at the boundaries between those mechanisms. Several accepted programs silently change behavior, lose their requirements, or bypass the determinism and lifetime guarantees the spec promises.

I would address findings 1–5 before expanding the accepted executable-Flow language. They affect the meaning of accepted programs. Deliberately refusing an unsupported WIP feature is a different category and is recorded separately below.

This review covers the uncommitted working tree, including new files, rather than only the last commit. I read the normative specification and decision ledger; traced the JS analyzer/emitter, the Go bridge and conformance paths, Result/effect/Layer runtimes, executable Flow compilation and replay, deployment/authentication entry points, comptime/assets, CLI/editor integration, and packaging; and ran the checks listed below. Standard-library and platform adapters were sampled. This is not a line-by-line audit of every adapter, a sandbox penetration test, or proof of distributed correctness under every fault model.

Other implementation work continued during the review. Broad measurements used an isolated source snapshot where needed to avoid concurrent `dist` cleaning. I rechecked the affected Flow code against the live workspace and reran the standalone findings probes. The private-helper overload failure described in the test results was fixed by concurrent work; it is not an outstanding finding here. No existing implementation or spec files were edited by this review.

**1. P1 — The JS emitter can silently skip effectful callees**

Location: [compile.ts:241](/Users/williamcory/effect-lang/poc/src/language/compile.ts:241), [call lowering:1438](/Users/williamcory/effect-lang/poc/src/language/compile.ts:1438). Repro cases: `async_discard`, `method_discard`, `callback_discard`.

```ts
import { Context } from 'vibelang/context';
import { Layer } from 'vibelang/provider';
abstract class C extends Context { abstract n(): number }
const seen: number[] = [];
function read(): number { seen.push(C.context().n()); return 9 }
async function f(): Promise<number> { read(); return seen.length }
export async function main(): Promise<number> {
  return await Layer.provide(
    Layer.succeed(C, { n: () => 7 }), async () => await f()
  );
}
```

The JS frontend and emitted-TypeScript check both accept this with no diagnostics. `main()` returns **0**, although `read()` should have appended one element. The Go backend returns **1**. The same omission occurs when a class method calls `read()`, and when an ordinary `forEach` callback calls it.

`read` becomes a generator, but these callers retain an ordinary `read()` call. Creating and discarding a generator does not execute its body. Delegation is only added when the caller is already considered resumable. If the caller uses the returned number, emitted-TypeScript checking can catch a `Resumable<number>`/`number` mismatch; discarding the return value hides the problem and loses the entire side effect. Public CLI `check` also accepts the async reproducer.

This violates ordinary call behavior and the [shared-syntax contract](/Users/williamcory/effect-lang/docs/src/pages/specification/compatibility.mdx:9). It is more serious than a missing async feature because the program is accepted and produces a plausible wrong answer.

Recommended correction: determine and validate the calling convention for every call edge before emission. Every accepted caller must drive the callee's computation. Unsupported async, method, accessor, and callback combinations should receive a source diagnostic until implemented. Cover discarded results as well as returned values; an emitted type check alone cannot detect omitted execution.

**2. P1 — Function-value annotations erase capability requirements**

Location: [effect-row assignment contract](/Users/williamcory/effect-lang/docs/src/pages/specification/effects.mdx:90), [known implementation gap](/Users/williamcory/effect-lang/docs/src/pages/reference/function-channels.mdx:61). Repro: `row_assign`.

```ts
import { Context } from 'vibelang/context';
abstract class C extends Context { abstract n(): number }
function read(): number { return C.context().n() }
const slot: () => number = read;
export function main(): number { return slot() }
```

Both backends compile this and then panic at runtime because `C` was not provided. The JS analysis reports `read: R = [C]` but `main: R = []`. The explicit annotation has hidden the requirement from the caller.

The spec explicitly gives an unannotated function type the empty row and requires assigning a larger row to a smaller row to be a type error. Thus the assignment itself should be rejected. This is already acknowledged in the documentation, but remains a foundational implementation gap: declaration-only inference cannot enforce the advertised contract of callbacks, containers of functions, and library boundaries.

Recommended correction: represent `(E, R)` on callable types and enforce row subtyping during assignment and argument checking, including aliases, object properties, overloads, and generics. Preserve the row through declaration emission/import. Keep the failing assignment as a shared JS/Go corpus case. Do not rely on the runtime missing-provider panic to establish static soundness.

**3. P1 — Must-use checking accepts paths that never consume Results or started Promises**

Location: [semantic.ts:6403](/Users/williamcory/effect-lang/poc/src/language/semantic.ts:6403), [parameter checking:6418](/Users/williamcory/effect-lang/poc/src/language/semantic.ts:6418). Repros: `result_branch`, `result_uninvoked`, `promise_branch`, `promise_result_abort`; additional JS-only example `result_collection`.

All four of these shapes are accepted by both backends:

```ts
const r = read();
if (flag) r.isError();       // The false path drops r.
```

```ts
const r = read();
const ignored = () => r.isError(); // The closure is never called or returned.
```

```ts
const p = work();
if (flag) await p;           // The false path exits without awaiting p.
```

```ts
const p = work();
const value = read()!;       // Failure exits before the await.
await p;
return value;
```

The current check asks whether **some syntactic reference** consumes the binding. That does not establish consumption along every reachable exit. A use inside an uninvoked function also counts. For collections, the JS analyzer additionally accepts an example that only inspects the first Result and loses another; Go refuses that particular example.

This breaks the [must-consume lifetime/replay obligation](/Users/williamcory/effect-lang/docs/src/pages/specification/requirements.mdx:92): a started operation can outlive its enclosing computation. The Promise probes deliberately use simple work; the defect is the accepted unconsumed path, irrespective of whether that particular Promise happens to have settled quickly. Public CLI `check` accepts the conditional Promise and uninvoked Result closure probes.

Recommended correction: track consumption/transfer obligations over a control-flow graph, including `return`, `throw`, `!`, loops, and cleanup edges. Define when passing or returning a value transfers responsibility. Track closure escape and invocation separately from the existence of references. Collection ownership needs its own rule; consuming one element does not consume the remaining elements. These guarantees need semantic tests across paths, not just spelling-based acceptance tests.

**4. P1 — The determinism rules explicitly allow host-time-zone dependencies**

Location: [JS Date rule:9211](/Users/williamcory/effect-lang/poc/src/language/semantic.ts:9211), [JS setter exemption:9025](/Users/williamcory/effect-lang/poc/src/language/semantic.ts:9025), [Go constructor rule:629](/Users/williamcory/effect-lang/compiler/forkbridge/hostrules.go.txt:629), [Go member set:970](/Users/williamcory/effect-lang/compiler/forkbridge/hostrules.go.txt:970), [spec setter exemption](/Users/williamcory/effect-lang/docs/src/pages/specification/compatibility.mdx:242). Repros: `date_parse`, `date_constructor`, `date_setter`, `body_date`.

Both backends accept these without a capability requirement:

| Expression | `TZ=UTC` | `TZ=America/Los_Angeles` |
| --- | ---: | ---: |
| `Date.parse('2025-01-01T00:00:00')` | 1735689600000 | 1735718400000 |
| `new Date(2025, 0, 1).getTime()` | 1735689600000 | 1735718400000 |
| `const d = new Date(0); d.setHours(12); d.getTime()` | 43200000 | -14400000 |

The executable body compiler also accepts the setter inside a Flow with an empty Action set, and the loaded body returns the host-dependent value. No effect request records the zone.

The exemption's reasoning is incorrect: a setter can read ambient state while computing its write. Likewise, supplying constructor arguments does not establish an absolute instant, and a date-time string without an offset can require local-zone interpretation. This contradicts [Flow determinism](/Users/williamcory/effect-lang/docs/src/pages/specification/durable-execution.mdx:156), even though the implementations follow the narrower member-list rationale.

Recommended correction: classify operations by all their inputs, including implicit host inputs. Keep genuinely absolute/UTC operations available. Require an explicit effect or reject local-zone construction, parsing, and setters unless the compiler can prove an absolute interpretation. Add timezone-matrix tests for both frontends and an executable Flow resumed under a different zone. This needs a spec correction as well as implementation changes.

**5. P1 — Flow closure extraction drops state-establishing module statements**

Location: [body-compiler.ts:178](/Users/williamcory/effect-lang/poc/src/durable/body-compiler.ts:178), [statement removal:212](/Users/williamcory/effect-lang/poc/src/durable/body-compiler.ts:212), [body factory invocation:124](/Users/williamcory/effect-lang/poc/src/durable/body-artifact.ts:124). Repro: `body_capture`.

```ts
import { durable } from 'vibelang:flows';
const cfg = { n: 1 };
cfg.n = 2;
export const F = durable((input: number) => cfg.n + input);
```

`compileDurableBody` succeeds. Loading the artifact and executing it with input `0` returns **1**, rather than **2**. The updated live body compiler still reproduces this.

Closure extraction follows symbol declarations. It retains `const cfg = { n: 1 }` but removes `cfg.n = 2` because that statement declares no referenced symbol. Re-evaluating the retained initializer in the artifact therefore creates different state. This is a deterministic, module-local example: it needs no external service, import, concurrency, or hidden host input.

The [Flow contract](/Users/williamcory/effect-lang/docs/src/pages/specification/durable-execution.mdx:146) says `durable` must preserve what the function computes. Recommended immediate correction: include execution-relevant initialization dependencies, or reject captures whose state cannot be reproduced by the supported extraction model. A declaration dependency graph is not sufficient to preserve module execution semantics.

The broader spec also needs a capture contract. It simultaneously allows unrestricted mutable/runtime captures and forbids a coordinator from depending on values outside the journal/input. Specify when captures are bound, how their state reaches an artifact or execution, which identity covers it, and what is recreated on resumption. Source identity alone cannot identify arbitrary runtime capture state.

**6. P2 — Comptime canonicalization changes observable program values**

Location: [JSON operations:1983](/Users/williamcory/effect-lang/poc/src/build/comptime-intrinsic.ts:1983), [stringify:1990](/Users/williamcory/effect-lang/poc/src/build/comptime-intrinsic.ts:1990), [literal emission:2791](/Users/williamcory/effect-lang/poc/src/build/comptime-intrinsic.ts:2791), [stable clone:63](/Users/williamcory/effect-lang/poc/src/build/stable.ts:63), [Go canonical serializer:261](/Users/williamcory/effect-lang/compiler/forkbridge/comptime.go.txt:261). Repros: `ct_stringify`, `ct_object_keys`, `ct_parse_keys`.

```ts
import { comptime } from 'vibelang:comptime';
const text = comptime(() => JSON.stringify({ z: 1, a: 2 }))();
export function main(): string[] {
  return [text, JSON.stringify({ z: 1, a: 2 })];
}
```

Both backends return `['{"a":2,"z":1}', '{"z":1,"a":2}']`. Compile-time evaluation has changed the result of `JSON.stringify`. Similarly, `Object.keys(comptime({ z: 1, a: 2 }))` yields `a,z`, while the runtime object literal yields `z,a`.

There is an additional backend difference: evaluating `Object.keys(JSON.parse('{"z":1,"a":2}'))` during comptime yields `a,z` in JS and `z,a` in Go. The JS evaluator sorts during `stableClone`; Go preserves the parse order in this expression.

Canonical serialization is appropriate for identities and hashes. Substituting it for the semantics of the program's `JSON.stringify`, or silently changing object property order, is not justified by that need. It violates [evaluation/replacement](/Users/williamcory/effect-lang/docs/src/pages/specification/comptime.mdx:15) combined with the shared TypeScript semantics contract. These changes can affect generated source, serialization protocols, and downstream hashes.

Recommended correction: separate the interpreter's semantic value representation from canonical artifact encoding. Preserve observable property order, and implement the accepted JSON builtin subset with ordinary semantics. Add compile-time/runtime equivalence cases and cross-backend cases; sorted artifact bytes alone are insufficient evidence of correct evaluation.

**7. P2 — `finally` completions are discarded during Result propagation; the spec needs a clear rule**

Location: [synchronous unwind:264](/Users/williamcory/effect-lang/poc/src/runtime/effect.ts:264), [asynchronous unwind:933](/Users/williamcory/effect-lang/poc/src/runtime/effect.ts:933). Repros: `finally_return`, `finally_throw`, `async_finally_throw`.

```ts
class E extends Error {}
function fail(): Result<number, E> { throw new E('first') }
function f(): Result<number, E> {
  try { return fail()! }
  finally { throw new E('second') }
}
```

Both backends produce the **first** error. The async variant does the same. Replacing the `finally` body with `return 7` still leaves the propagated failure, rather than returning success. The block does run; its completion is lost. The emitted failure in `finally` becomes a returned Result, and the unwind driver ignores the final generator completion value.

Ordinary JavaScript `finally` can replace a pending completion. VibeLang promises shared syntax semantics, but its abort handler must complete with the propagated error, while [cleanup-error composition](/Users/williamcory/effect-lang/docs/src/pages/specification/failures.mdx:287) remains open. Consequently the measurements establish a semantic discrepancy, but the spec does not yet provide a complete rule for resolving it. This should be decided explicitly, not accidentally by discarding `gen.return()`'s result.

Specify the outcome of an original failure combined with a cleanup success-return, typed failure, panic, disposer failure, and async cleanup failure. Then implement that completion model consistently across sync/async bodies, `!`, direct throws, nested handlers, and `using`. Merely asserting that `finally` ran does not test the resulting function contract.

**8. P2 — A nested `durable` declaration crashes the compiler API**

Location: [body-compiler.ts:380](/Users/williamcory/effect-lang/poc/src/durable/body-compiler.ts:380). Repro: `body_nested`.

```ts
import { durable } from 'vibelang:flows';
export function make(bias: number) {
  const F = durable((input: number) => bias + input);
  return F;
}
```

Both `compileDurableBody` and `compileEffectManifest` throw an internal `TypeError` while evaluating `signature.getParameters`. This remains reproducible in the updated live code. The entry lookup scans only top-level variable statements and assumes that the declaration and call signature exist.

Nested runtime captures may reasonably remain unsupported in this WIP. The compiler should reject the source with a structured diagnostic before reaching that assumption. Validate declaration placement, entry shape, and signature/parameter existence at the API boundary. The broader capture feature can remain a separate task.

**Additional specification decisions and inconsistencies**

- **Unchecked indexing reintroduces an unchecked absence assumption.** [Compatibility:438](/Users/williamcory/effect-lang/docs/src/pages/specification/compatibility.mdx:438) deliberately sees through `noUncheckedIndexedAccess` for `Result[]`. The checked `result_oob` probe calls a function containing `return rs[0]!` with `[]` and gets `Panic: forged Result value`; the inferred failure row contains only `E`. Whether absence came from an authored union or index widening does not change the runtime possibility of `undefined`. Either require narrowing, provide a checked extraction operation, or explicitly specify an indexing panic with an accurate diagnostic. The current explanation that `!` remains only the error axis is incomplete.

- **The error-extraction argument confuses API bootstrapping with access to an error value.** [Failures:184](/Users/williamcory/effect-lang/docs/src/pages/specification/failures.mdx:184) says the absence of an extraction form makes error-inspecting operations unauthorable. Yet `r.match({ ok: () => undefined, error: e => e })` extracts the error today; the `error_extract` probe succeeds on both backends. Implementing `Result.match` itself without privileged representation access is a separate question. Keeping Result internals compiler-owned is reasonable, but a new syntax proposal should not rest on the claim that user code cannot obtain `E` through the public API.

- **Runtime compatibility needs to be part of the replay contract.** [Compatibility:324](/Users/williamcory/effect-lang/docs/src/pages/specification/compatibility.mdx:324) only recommends pinning an engine and says a last-ulp difference must not become a journal-integrity failure. The [body executor](/Users/williamcory/effect-lang/poc/src/durable/body-executor.ts:59) hashes request inputs exactly. If a numeric difference changes an Action argument or a branch, these guarantees conflict. Define the compatibility identity of the compiler/runtime/engine used for resumption, or precisely define allowed numerical variation and its consequences. I did not measure a cross-engine numerical failure; this is a contract gap, not a demonstrated exploit.

- **The generated-agent example uses VibeLang propagation in purported ordinary TypeScript.** The [generated turn example](/Users/williamcory/effect-lang/docs/AGENT_LIBRARY.md:55) uses `(await functions.readFile(...))!`. In ordinary TypeScript, that postfix assertion is erased and does not propagate a Result. If the function returns a Result as described, `source` is still a Result. Write this example using Result methods, or explicitly make the generated language `.vibe` and route it through that compiler. This choice affects what the sandbox must check and execute.

- **Calling convention needs an explicit, stable declaration contract.** In a declaration-emission probe, adding `export const alias = read` changed an exported capability-reading function from `read(): Resumable<number>` to `read(): number`, while both declarations published the same `@vibelangEffects` requirement row. A fallible capability reader also uses an ordinary Result-returning convention. Meanwhile [callConvention:452](/Users/williamcory/effect-lang/poc/src/language/compile.ts:452) treats a nonempty declared requirement row as delegation. A requirement row alone therefore cannot identify the convention. I did not establish an isolated cross-package runtime failure with this probe, so this is an ABI review concern in addition to the proven local failures in findings 1 and 2. Test actual emitted package declarations with the source implementations unavailable to the consumer.

The provisional Effect Manifest, `(site, occurrence)` journal, and fail-closed version decisions are already identified as PR-1/2/3 in the ledger. Ratify them explicitly before treating dependent artifact formats as settled. Also resolve the already-recorded order-independent Promise-combinator/scheduler question: deterministic submission order is necessary even when the combinator's returned value is independent of completion order.

**Implementation coverage and documentation accuracy**

The current CLI does materialize executable Flow modules before ordinary compilation, and `Deployment.build` plus the authenticated coordinator have executable-body paths. It would be incorrect to report those integrations as wholly absent. The new code also supports more ordinary Flow body structure than the legacy Plan compiler.

Remaining WIP boundaries include compiler-bound import restrictions for extracted bodies, a single recognized Flow declaration in the body API, incomplete external-capability execution, and durable intrinsics whose executable driver is not connected. The Go durable path and the new JS body path are not interchangeable implementations of the complete target semantics. These should have an explicit supported-feature matrix, with unsupported cases diagnosed consistently. Their incompleteness is not itself a finding of incorrect behavior.

The editor staging path still lists assets → comptime → row analysis → emitted-TypeScript checking and does not invoke `compileDurableModule` ([lsp.ts:648](/Users/williamcory/effect-lang/poc/src/language/lsp.ts:648)), whereas the CLI now does. This is an integration gap found by inspection; I did not reproduce it through a running editor client. Share the project staging pipeline so editor and CLI cannot quietly diverge when a new stage is added. The specified unplugin factory is also not implemented; the package's `plugin` export is a TypeScript language-service integration, not the bundler factory the spec requires. Node-importable exports passed the package smoke check below; that does not establish browser or Deno neutrality for modules that import Node host facilities.

The normative pages are carrying too much obsolete implementation history. In particular, the [status register](/Users/williamcory/effect-lang/docs/src/pages/specification/index.mdx:78) still says:

- SA-3: the effect runtime is not exported and the compiler emits no calls into it; the current runtime index and emitter do both.
- SA-6: `layer.ts` still uses `v8.promiseHooks`; the current file does not. Residual ambient scoping questions are separate from that obsolete assertion.
- SA-7: ten Result methods do not exist; the current implementation and corpus include those methods.
- SA-8: `flowSourceDigest`, `journalSchemaVersion`, and `routingManifest` occur in no production code; the new signed body deployment has them.

For spec-driven development, these contradictions make the spec a poor implementation oracle even when individual paragraphs accurately describe past work. Keep normative rules concise, move historical measurements to a dated status document, and give each normative rule a traceable conformance obligation. Preserve the historical record without asking a reader to resolve several generations of it to discover the current rule. No spec rewrites were made during this review.

**Validation performed**

Environment included Node 22.4.1, Bun 1.2.20, Go 1.24.6, and the pinned TypeScript fork revision `c087644e82dc3d48cf87e4c5519eeaaea9daf35c`.

| Check | Observed result | Interpretation |
| --- | --- | --- |
| Root build and compatibility TypeScript check | Passed during the initial `npm test`; isolated snapshot build also passed | Generated source builds, but emitted types alone do not prove semantic preservation |
| Node gate on isolated snapshot | 231 passed, 1 failed; 232 tests; no skips/todos | The failure compared `/tmp/...` with `/private/tmp/...` for the same source-map path on macOS; focused retry reproduced the path-spelling mismatch |
| Bun gate | 2,738 passed, 2 failed, 1 allowed live-model skip; 147 files | Scheduler race failure passed a focused rerun. Helper-overload failure reproduced on the snapshot, then passed all 8 module-compiler tests on the updated live source |
| Go gate | 1,638 passed, 0 failed, 0 skipped | Full gate completed |
| Shared corpus, explicit `--backend both` | JS: 553 pass, 1 expected failure; Go: 527 pass, 27 expected failures; 554 cases each | No unexpected failures, unexpected passes, unmeasured cases, or integrity-audit errors; backend verdicts agreed on 528/554 cases |
| Product CLI versus oracle differential | 35 divergences: 0 product-only accepts, 2 product-only refusals, 33 diagnostic differences | The command failed its stale baseline: 38 previously recorded divergences were now fixed. The baseline was left untouched |
| Docs production build | Passed; large-chunk warning | Rendering/build validation, not evidence that the normative text is internally consistent |
| Tarball inventory and Node import smoke | 562 packaged files; all 42 export subpaths' declared targets present; 11 selected module imports passed | Built via `npm pack --ignore-scripts`; this did not substitute for `verify:pack` or a clean installed-consumer release gate |
| Additional review probes | 23 saved cases, including JS/Go comparisons and timezone variants | Findings above include accepted programs outside the existing corpus |

The initial live `npm test` was interrupted by failures consistent with another build cleaning `dist` while tests ran. The isolated Node run eliminated those missing-module failures. I did not claim a clean end-to-end `npm test` or `release:verify`, and did not rerun every broad suite after concurrent source changes.

One gate issue deserves attention: the Go corpus execution under [test/conformance.test.mjs:240](/Users/williamcory/effect-lang/test/conformance.test.mjs:240) is deliberately report-only for semantic disagreement. It checks that measurement happened, but does not make a new Go conformance failure fail `npm test`. The standalone strict corpus command does enforce expectations. Use a gating expectation baseline for the Go corpus as well, allowing explicit known failures while rejecting new ones. Similarly, run the CLI differential in the normal integration gate; the oracle and product pipeline have materially different stage composition.

The test infrastructure's strengths are real: it checks emissions, independently executes the Go output, audits missing measurements, exercises ordinary TypeScript interoperability, and tests crash/replay behavior. The missing dimension is composition. Add a small systematic matrix over callable shape × effect channel × sync/async × callback boundary, and lifetime path × early exit. Add compile-time/runtime equivalence and fresh execution/replay equivalence cases. Broad test counts cannot replace those combinations.

**Suggested implementation order**

1. Settle callable rows and the emitted calling-convention ABI; fix skipped call execution and requirement erasure together.
2. Establish control-flow-sensitive Result/Promise consumption, then pin cleanup completion semantics.
3. Close ambient nondeterminism and define capture-state identity before broadening executable Flow acceptance.
4. Separate comptime value semantics from artifact canonicalization, and make unsupported compiler inputs produce diagnostics.
5. Share CLI/editor/bundler staging and gate backend/product agreement; then update the status register from those measurements.

This ordering lets the current WIP remain useful while making each newly accepted program rely on established invariants.

**Reproducing the findings**

The adjacent [cases.json](/Users/williamcory/effect-lang/reviews/2026-09-05/cases.json) contains the complete 23 source programs. [probe.ts](/Users/williamcory/effect-lang/reviews/2026-09-05/probe.ts) reports compiler diagnostics, rows, and runtime observations without changing conformance expectations. From the repository root:

```sh
bun reviews/2026-09-05/probe.ts
bun reviews/2026-09-05/probe.ts --go
TZ=UTC bun reviews/2026-09-05/probe.ts date_parse date_constructor date_setter body_date
TZ=America/Los_Angeles bun reviews/2026-09-05/probe.ts date_parse date_constructor date_setter body_date
```

Individual case names can be supplied to either command. The direct body-API cases are JS-only and are explicitly skipped by the Go mode. The runner creates its generated outputs under the system temporary directory. Its observations describe behavior; a successful runner exit does not mean the language passed the review.

The broader run logs and the original isolated snapshot are available locally under `/tmp/vibelang-review-xajmkn`. They were kept outside the repository; the review report and standalone probes are the only files this review added.
