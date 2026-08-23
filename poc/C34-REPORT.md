# C34 — root integration gate repair

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

Date: 2026-08-23

## 1. Post-comptime diagnostic mapping

### Reproduction

```text
node --test --test-name-pattern='post-comptime diagnostics map back to authored lines after multiline replacement' test/cli.test.mjs
```

The CLI exited successfully and reported `ok: true`. Its only portability
diagnostic was warning `SMITHERS3006` at authored `10:5`:

```text
the /** @native */ marker no longer pins a function; import { native } from
"smithers:native" and write native(nativePinned)
```

There was no `SMITHERS3001`, and `diagnostic.mjs` was emitted. The fixture did
not contain an unbounded comptime loop, so C33's budget-position change was not
involved.

### Verdict

**Stale test.** C25 deliberately retired `/** @native */` as a pin and made it
a migration warning. The checker-owned contract is an import from
`smithers:native` followed by `native(fn)`, and C25 deliberately anchors a
failed pin at that assertion.

### Fix

`test/fixtures/comptime/diagnostic.sm` now imports the intrinsic and writes
`native(nativePinned)` after the multiline comptime replacement. The test still
requires `SMITHERS3001`, no output artifact, and a nontrivial multiline
provenance edit; its exact authored line assertion now points to the authored
pin assertion. The isolated test passes.

## 2. Checker-backed native portability pin

### Reproduction

```text
node --test --test-name-pattern='\.sm compilation enforces checker-backed native portability pins' test/cli.test.mjs
```

A direct CLI reproduction returned `ok: false`, but for
`SMITHERS2102@6:1` (the direct top-level call's unsatisfied `TypeScript`
requirement), plus warning `SMITHERS3006@1:5` on the retired marker. It emitted
no `SMITHERS3001` because the fixture never invoked the new pin intrinsic.

### Verdict

**Stale test.** C25 explicitly chose checker-resolved symbol identity and
demoted the old JSDoc spelling. Restoring JSDoc pin authority would contradict
that decision and would restore a name-matched, typo-prone assertion.

### Fix

`test/fixtures/project/invalid-native.sm` now imports `native` from
`smithers:native` and asserts `native(nativePinned)`. The root test still
requires compilation failure, `SMITHERS3001`, and no emitted module, and now
also asserts that `SMITHERS3006` is absent so it cannot silently fall back to
the retired spelling. The isolated test passes.

## 3. `Schema.derive` runtime edge

### Reproduction

```text
node --test --test-name-pattern='comptime Schema\.derive lowers to a resolvable smthrs/schema-runtime edge' test/comptime-schema.test.mjs
```

The original run returned `ok: false` with
`SMITHERS1510@6:35` and `SMITHERS1505@6:35`. Both diagnostics named the
unresolved `smthrs/schema-runtime` import inserted by the comptime lowering and
were correctly mapped to the authored `Schema.derive<Row>()` origin.

### Verdict

**Implementation regression.** C30 composed whole-project checking after
comptime lowering, while the exact compiler-owned module registries omitted
the pre-existing compiler-injected `smthrs/schema-runtime` edge. The frontend
therefore reclassified compiler output as an authored untrusted foreign import.

After the implementation repair, the test reached a second, independent stale
assertion: the declaration correctly contained
`import("smthrs/schema-runtime").DerivedSchema<Row>`, while the regex still
expected `smithers/schema-runtime`. The `smthrs` spelling is fixed by the root
package name and its `./schema-runtime` export; the colon-form `smithers:...`
namespace remains reserved for compiler virtual modules, as recorded by C30.

### Fix

The frontend and portability classifier's mirrored exact registries now include
only `smthrs/schema-runtime`; no prefix rule was restored. The package edge is
still present byte-for-byte in emitted JavaScript and remains resolvable by an
installed consumer. The declaration assertion was corrected to the exact
`smthrs/schema-runtime` package spelling. The test still checks the full edit
sequence, generated import, descriptor lowering, declaration seam, runtime
resolution, successful validation, and failure pointer. The isolated test
passes.

This required a surgical edit to `poc/src/language/semantic.ts`: that registry
is the pass which emitted the false `SMITHERS1510`/`SMITHERS1505`, so the root
CLI and test layers could not correct the regression honestly.

## 4. Fork end-to-end artifact set

### Reproduction

```text
node --test --test-name-pattern='authored \.sm compiles through the pinned fork and the emitted JavaScript runs' test/fork-e2e.test.mjs
```

The actual sorted keys were:

```text
host.js, host.js.map, order.js, order.js.map,
smithers-runtime.js, smithers-runtime.js.map, stock.js, stock.js.map
```

The expected value contained the same eight names but placed `stock.*` before
`smithers-runtime.*`. No artifact was added, removed, or renamed.

### Verdict

**Stale test.** The Vibe-to-Smithers runtime rename changed lexical ordering:
`smithers-runtime.*` sorts before `stock.*`. The fork bridge's expanded prelude
did not change the emitted file-set shape.

### Fix

The exact expected array was reordered to default lexical order. The assertion
still requires one module and source map for every input, including the runtime,
and all subsequent lowering, specifier-rewrite, execution, and stdout checks
remain unchanged. The isolated test passes.

## Final verification

Run serially, in the requested order, after the external corpus writer removed
its temporary probes:

```text
npm run build
    exit 0

node --test test/*.test.mjs
    101 pass, 0 fail, 0 skipped, 0 todo
    exit 0

cd poc && bun run check
    tsc --noEmit, 0 diagnostics, exit 0

cd poc && bun test
    1072 pass, 1 skip, 5 todo, 0 fail
    13,555 expect() calls across 93 files, exit 0

node conformance/runner/run.mjs --backend both --jobs 4
    JS reference:  192/196 pass, 4 xfail, 0 unsupported, 0 divergent, 0 unmeasured
    Go fork match: 191/196 match, 2 xfail, 3 unsupported, 0 divergent, 0 unmeasured
    Backend agreement: 187/196 identical observations
    exit 0
```

The conformance total changed while this lane was running. Another lane added
20 cases under `conformance/**` after the C33/C34 handoff; the first root-suite
attempt caught that directory midway through a write, and the successful root
run itself saw it move from 194 to 196. C34 did not edit that directory.

To verify the critical inherited contract rather than infer it from the larger
scoreboard, I loaded the settled pre-expansion case set through the runner's
public `loadCorpus`/`runConformance` APIs, asserted that it contained exactly
176 cases, and ran both real backends with four jobs. The measured summary was:

```text
JS reference:      176/176 pass, 0 xpass, 0 xfail, 0 unsupported,
                   0 divergent, 0 unmeasured
Go fork match:     176/176 pass, 0 xpass, 0 xfail, 0 unsupported,
                   0 divergent, 0 unmeasured
Backend agreement: 176/176 identical observations
Harness audit:     []
```

Thus every case in the source set handed to C34 retains full parity, and the
only non-pass/non-identical rows in the live 196-case superset are among the 20
concurrently added cases. Both the inherited set and the live superset have
zero divergences.

Finally, the exact integration command named in the brief also passed:

```text
npm test
    build: pass
    compatibility TypeScript compile: pass
    root Node tests: 101 pass, 0 fail
    compiler Go tests: pass
    cmd/smithersc-go tests: pass
    exit 0
```

SOURCE SETTLED.
