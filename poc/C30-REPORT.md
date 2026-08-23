# C30 — compose native-pin portability and durable lowering into the JS reference

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

Date: 2026-08-23

## Outcome

The JS conformance reference now composes the two missing compiler-owned passes
around `compileProject` without weakening emitted-output validation or any
harness-integrity stage:

1. `compileProject` folds the whole-project portability classifier's diagnostics
   into its ordinary project diagnostics.
2. `conformance/runner/js-lower.mjs` invokes the standalone durable source
   compiler only for an exact `smithers:flows` module edge, after comptime and
   before Smithers lowering.

The native pin is also a complete compiler virtual module in the language POC:
its declaration participates in checking, its exact import rewrites to the
runtime, and the runtime export is the compile-time assertion's identity
operation.

The result is JS 174/176 (up from 168/176), Go 171/176 (up from 170/176 after
retiring one stale marker), and 169/176 identical observations (up from
168/176). Both backends remain at zero divergent and zero unmeasured cases.

One durable case remains a genuine reference/API finding after composition; it
was not forced green and its xfail now states the measured reason.

## Native-pin specifier and spelling evidence

The registered specifier is exactly `smithers:native`.

This was read from the live tree rather than inferred from a prefix:

- `poc/src/targets/classify.ts` declares
  `NATIVE_PIN_MODULE = "smithers:native"`, declares that exact module in its
  compiler prelude, and recognizes the resolved `native` export's checker
  symbol.
- Every `conformance/corpus/21-native-pin/*.sm` case imports that spelling.
- `poc/src/targets/classify.test.ts` exercises direct, aliased, and namespace
  imports from that spelling, plus lookalike rejection.
- The native-pin lane report selects the colon form because sibling
  compiler-owned virtual modules already use `smithers:comptime`,
  `smithers:exceptions`, and `smithers:flows` consistently.

This does not conflate package modules and compiler virtual modules. The
package-exported capability surface is `smthrs/context` and `smthrs/provider`
because the package is named `smthrs`; compiler-owned virtual modules use the
separate `smithers:...` colon namespace. Both the language frontend and the
portability classifier use explicit membership sets. No `smithers:` or
`smthrs/` prefix matching was added or restored.

The corresponding implementation changes are:

- `poc/src/language/semantic.ts`: add the exact specifier to
  `COMPILER_INTRINSIC_SPECIFIERS` and declare its generic identity signature in
  the checker prelude.
- `poc/src/language/compile.ts`: add the exact specifier to
  `isCompilerVirtualModule`, making the existing runtime-import rewrite used by
  `smithers:exceptions` apply to the pin.
- `poc/src/runtime/index.ts`: export
  `native = <F>(pinned: F): F => pinned`.

## Portability composition

`poc/src/language/project-compile.ts` now calls
`analyzeCompatibilityProject` over the complete supplied Smithers source set.
Its diagnostics are converted to ordinary `ProjectDiagnostic` values with the
original project file identity, authored line/column, and an authored offset,
then appended to the semantic diagnostics. This mirrors the root CLI's
whole-project composition at `src/cli.ts:864` while putting the composition at
the reference API boundary requested by this lane.

All five native-pin JS cases consequently observe the real rule:

- the clean graph and capability-only graph compile, survive the stock emitted
  TypeScript check, execute, and print `48010`;
- the host graph reports the declared `SMITHERS1510` cascade plus
  `SMITHERS3001` at the assertion; and
- the direct and transitive TypeScript graphs report `SMITHERS3001` at their
  assertions.

Running this classifier for every `compileProject` call caused no status change
outside the five native-pin cases in the full corpus measurement.

## Durable composition

`conformance/runner/js-lower.mjs` now follows the comptime composition shape:

1. It lexically looks for the exact `smithers:flows` module edge. A local
   same-spelled `durable` function remains on the identity path.
2. It calls `compileDurableSource` without executing author code.
3. Durable diagnostics return through the normal successful driver protocol as
   authored `SMITHERS41xx` language diagnostics with `emitChecked: false`.
4. A successful durable result replaces the compiler-owned call with its static
   descriptor, erases the virtual import, and builds an exact offset source map
   for all unchanged text. That map composes under comptime's map when both
   passes apply and under `compileProject`'s map for emitted diagnostics.
5. The existing stock emitted-TypeScript check and execution stages remain
   mandatory for accepted output cases.

The two corpus files with virtual imports were updated from the legacy
`vibelang:flows` alias to the live canonical `smithers:flows` spelling. The Go
fork already accepts that canonical spelling and its observations did not move.

`17-durable/statement-branch-fails-closed` now observes the standalone
compiler's exact `SMITHERS4106` at authored 4:3 and passes on JS.

### Genuine durable finding left visible

`17-durable/static-plan-shape-is-digest-pinned` remains a JS xfail, but no
longer for unresolved-module plumbing. The adapter reaches
`compileDurableSource`, which reports:

```text
SMITHERS4100 at 7:24
Property 'run' does not exist on type 'typeof Lookup'.
```

The standalone API accepts imported Actions only through caller-supplied
`DurableSourceActionBinding` descriptors. It does not derive the same-file
`Lookup` and `Audit` subclasses used by this cross-backend case, and the
conformance request has no external descriptor-binding input. The adapter
therefore passes `actions: []` and exposes the real fail-closed API boundary.
Inventing descriptors in the harness or rewriting the case to fit the
standalone subset would suppress a semantic/integration finding, so the xfail
was retained and rewritten with this reason.

## Stale markers and coverage text

- Removed the false Go xfail from
  `08-promise-chaining/promise-catch-is-rejected`. Both backends produce exactly
  `SMITHERS1401@6:22` and `SMITHERS1402@6:22`; its status is now pass/pass.
- Corrected `conformance/COVERAGE.md`'s stale namespace claim. The settled split
  is package modules `smthrs/context` and `smthrs/provider` versus exact
  compiler virtual modules in the `smithers:...` colon namespace. The coverage
  text also no longer lists the retired Promise-catch xfail as active.

## Full before/after

Both measurements used the same live 176-case tree and the runner's prepared,
forkpatch-verified Go checkout.

| backend | before | after |
| --- | --- | --- |
| JS reference | 168/176 pass, 0 xpass, 8 xfail, 0 unsupported, 0 divergent, 0 unmeasured | 174/176 pass, 0 xpass, 2 xfail, 0 unsupported, 0 divergent, 0 unmeasured |
| Go fork | 170/176 pass, 1 xpass, 5 xfail, 0 unsupported, 0 divergent, 0 unmeasured | 171/176 pass, 0 xpass, 5 xfail, 0 unsupported, 0 divergent, 0 unmeasured |
| backend agreement | 168/176 identical observations | 169/176 identical observations |

### Every status movement

JS `xfail -> pass`:

- `17-durable/statement-branch-fails-closed`
- `21-native-pin/a-clean-graph-satisfies-the-pin`
- `21-native-pin/a-pin-reaching-a-host-module-is-rejected`
- `21-native-pin/a-pin-reaching-only-a-capability-is-accepted`
- `21-native-pin/a-pin-reaching-typescript-is-rejected`
- `21-native-pin/a-pin-reaching-typescript-transitively-is-rejected`

Go `xpass -> pass` (marker-only movement; its raw observation was already
correct and in agreement):

- `08-promise-chaining/promise-catch-is-rejected`

No other JS or Go case changed status. The durable statement diagnostic is the
one newly identical backend observation, accounting for agreement moving by
one. The five native-pin JS observations now satisfy the contract but remain
different from the Go fork's unimplemented `TS2307` observations.

One raw observation changed without a status movement:

- `17-durable/static-plan-shape-is-digest-pinned` remains `xfail`, changing from
  unresolved virtual-module emitted-TypeScript plumbing to the real
  `SMITHERS4100@7:24` same-file Action descriptor limitation described above.

## Xfails deliberately left

JS reference (2):

- `16-comptime/an-unbounded-comptime-loop-exhausts-its-step-budget`: unchanged
  genuine position mismatch; the reference reports `VCT1012` at authored 6:9,
  while the contract and Go fork anchor the exhausted loop at 5:3.
- `17-durable/static-plan-shape-is-digest-pinned`: the newly measured
  `SMITHERS4100@7:24` same-file Action descriptor limitation.

Go fork (5), all area-21 native-pin cases:

- the Go fork still does not register or implement `smithers:native` and
  reports `TS2307` at its import; the host-module case additionally reports
  `TS2591` for `node:fs`. Their reasons were narrowed to this Go-only gap when
  the JS xfails were retired.

## Verification

Run serially in the requested order:

```text
cd poc && bun run check
    tsc --noEmit
    0 errors, exit 0

cd poc && bun test
    1065 pass, 1 skip, 5 todo, 0 fail
    13,500 expect() calls across 93 files
    exit 0

node conformance/runner/run.mjs --backend both --jobs 4
    JS reference: 174/176 pass, 2 xfail, 0 divergent, 0 unmeasured
    Go fork:      171/176 pass, 5 xfail, 0 divergent, 0 unmeasured
    Agreement:    169/176 identical observations
    exit 0

node --test test/conformance.test.mjs
    6 tests passed, 0 failed, exit 0
    JS interop: 6/6
    Go interop: 6/6
```

Additional scoped checks were clean: `node --check` for the JS lowering driver,
`jq empty` for every edited expectation, and `git diff --check` for every
C30-touched implementation/corpus/coverage path. Stage auditing, the
`unmeasured` status, the emitted-output check, and their self-tests were not
weakened. No file under `compiler/**`, `vendor/**`, `cmd/**`, `src/**`, or
`docs/**` was changed by C30, and nothing was committed.

SOURCE SETTLED
