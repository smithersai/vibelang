# Smithers existing-code diagnostics: EK9206 and EK4402

Verdict: **EK9206 is a regression at these sites. EK4402 is intended, but the existing-code rejection must remain a warning until the preserving `--fix-migration-only` repair ships.** This is a specification ruling, with no compiler, codemod, or live migration-tree fix. migfix-smithers owns `fix:smithers-command-reentered-EK9206` and `fix:smithers-incur-platform-migration-EK4402`.

## EK9206: regression

The reported `Command.test.vibe` sites are at 155:49, 161:47, 169:54, 228:53 and 289:66 in the migration replay. Each is an `is Exit.Failure` expression. They contain no source self-call or mutually recursive source functions. The checker is treating its own inference reentry as evidence of source recursion.

Appendix B, [900:1142](../design/src/900-appendices.md#appendix-b-diagnostics), describes interim EK9206 as:

> error: a recursive function has a success type that depends on its own result, or the legacy partial-contract inference cannot break its call cycle

Neither limb covers a nonrecursive predicate over an inferred callee. The generated predicate has no written partial contract either. Chapter 1, [001:306](../design/src/001-functions.md#return-types), independently says:

> A recursive function whose type can't be inferred gets TypeScript's own TS7022, TS7023 or TS7024, and no VibeLang diagnostic

A minimal witness reduced from the Command test has one hard diagnostic, EK9206 (and an unrelated advisory EK4834 on `fail`):

```vibe
function observe<T>(value: T): void {}
effect function lex() { return try fail("bad") }
export const check = effect () => {
  observe(try exit(lex()) is Exit.Failure)
}
```

There is no recursion: `check` calls `lex`; `lex` calls neither itself nor `check`. No source annotation is owed. Adding a return contract would mask the compiler defect rather than implement the language. The fix owner should exclude generated predicate inference reentry from the legacy recursion diagnostic without hiding real source cycles.

The mechanism is visible in the checker: `effect_functions.go` gives an immediately called compiler-generated `is` arrow the enclosing Effect form; `infer.go` sets `reentered[fn]` on a read while `connecting[fn]`; and `recursion.go` reports that flag through `checkReenteredFunction` without first establishing a source call cycle. The lazy-signature change makes the generated predicate reach that old reentry path. An inference dependency is not proof of a recursive source function.

## EK4402: intended; repair before error

The four reported post-migration sites in `Incur.test.vibe` are 108:14 (`process.stdout`), 575:16 (`process`, as `vi.spyOn(process, "exit")`), and 625:44 / 626:14 (`process.env` in the restore callback). Their line numbers move as migration imports are inserted. A type-only `typeof process.stdout.write` is erased and is not the offending value read.

Appendix B, [900:1109](../design/src/900-appendices.md#appendix-b-diagnostics), assigns EK4402 to a statically named platform value, including a global declared by `@types/node` rather than `lib.es*`. Chapter 5, [005:608](../design/src/005-services.md#the-platform-standard-library), says:

> a `.vibe` file has no `node:*` value imports, no Node globals (`process`, `Buffer`) and no platform calls such as `fetch`, anywhere: in plain and `async` functions, and inside `Effect.try` and `tryPromise` arrows too

The deciding [005:645](../design/src/005-services.md#the-platform-standard-library) row says:

> The quick fix and the codemod move the code into a sibling `.ts` module that does not exist yet; never rewrite an existing foreign file, and refuse with the not-fixed explanation if the move cannot preserve run phase, captures, receiver and public types

The next paragraph, 005:647, includes reading or changing host state. Spying on host stdout/exit and restoring the real environment are exactly that case. [VIP-33:20–21](../design/vips/0033-platform-stdlib.md) removes any wrapper exception; [VIP-33:48](../design/vips/0033-platform-stdlib.md) and [VIP-34:34](../design/vips/0034-compiler-and-tooling.md) permit a fresh owned TypeScript companion subject to preservation.

These tests intentionally spy on the host. Replacing the spies with Console or Config would change what they observe. The required repair extracts the platform wrappers, with their captured inputs, into one absent stable sibling, here called `Incur.test.platform.ts`. A collision must be reported rather than overwriting a preexisting foreign file. The source below is one exact preserving repair for the fix owner; helper names may be freshened without changing this behavior. This ruling implements no fix.

### Exact before and after for the residual wrappers

The input shown is after the separately selected VIP-1 function-kind migration. The platform migration must retain that function kind and every surrounding statement. It does not depend on rerunning `--fix-vip-only`.

Before, stdout spy:

```vibe
effect function spyOnStdout(writes: Array<string>) {
  return try sync((writes) =>
    vi.spyOn(process.stdout, "write").mockImplementation(
      ((chunk: unknown) => {
        writes.push(String(chunk))
        return true
      }) as typeof process.stdout.write
    ), writes)
}
```

After, in `Incur.test.vibe`:

```vibe
import {
  stdoutSpyProgram,
  exitSpyProgram,
  restoreCompleteProgram
} from "./Incur.test.platform.js"

effect function spyOnStdout(writes: Array<string>) {
  return try stdoutSpyProgram(writes)
}
```

Before, exit spy (the surrounding test is unchanged):

```vibe
const exit = try sync((exits) =>
  vi.spyOn(process, "exit").mockImplementation(
    ((code: number) => {
      exits.push(code)
    }) as never
  ), exits)
```

After:

```vibe
const exit = try exitSpyProgram(exits)
```

Before, the two environment restore references:

```vibe
try sync((previous) => {
  if (previous === undefined) delete process.env.COMPLETE
  else process.env.COMPLETE = previous
}, previous)
```

After:

```vibe
try restoreCompleteProgram(previous)
```

The fresh sibling `Incur.test.platform.ts` contains:

```ts
import { vi } from "@effect/vitest"
import { sync } from "vibelang-runtime"

/** @throws {never} */
export function stdoutSpyProgram(writes: Array<string>) {
  return sync((writes) =>
    vi.spyOn(process.stdout, "write").mockImplementation(
      ((chunk: unknown) => {
        writes.push(String(chunk))
        return true
      }) as typeof process.stdout.write
    ), writes)
}

/** @throws {never} */
export function exitSpyProgram(exits: Array<number>) {
  return sync((exits) =>
    vi.spyOn(process, "exit").mockImplementation(
      ((code: number) => {
        exits.push(code)
      }) as never
    ), exits)
}

/** @throws {never} */
export function restoreCompleteProgram(previous: string | undefined) {
  return sync((previous) => {
    if (previous === undefined) delete process.env.COMPLETE
    else process.env.COMPLETE = previous
  }, previous)
}
```

Each factory builds the same cold runtime `sync` program where the original wrapper was built. Its arguments are evaluated at that same point, and each platform operation runs only when the same Effect runs. The `vi.spyOn` receiver, actual host object, array identity, returned spy and `previous === undefined` deletion behavior are retained. The new module imports the same `vi` binding. Both changed owned source and newly created companion must pass the existing public-declaration identity check.

The already extractable environment read and assignments may share this stable absent companion too, without moving a host read to module initialization or changing the order of assignment and restore. Existing foreign files remain protected. A varying offset-derived filename is not a stable migration result.

Under Will's 2026-11-03 retire-needs-fix rule, a partial extraction that leaves these four existing-code sites as errors does not satisfy the release gate. Until the repair is available in `--fix --fix-migration-only`, EK4402 at these sites must remain a warning. The platform prohibition is not rescinded.

## Reproduction receipts

The original source is Smithers main `3f8204b3b386`, copied read-only from a maintainer's repository without `.jj` or `.git`. A second private copy contains the migration of that same main used for the reported post-upgrade sites. Its lockfile pins Effect 4.1.1; untouched main pins Effect 4.0.5. Neither live tree was changed. All installs, compilations and migration replays ran on a remote build machine.

The shipped control uses the compiler in main's frozen installation, **VibeLang 0.0.8 (TypeScript 7.1.0-dev)**. The `c3292f2c8df3` tarball in the migration environment is a different 0.0.11 artifact, not a Vibe commit and not the shipped 0.0.8 control.

The reported integration compiler is `8c36e2c0ea69`, built on `ac147e752734` plus the carried fixes. Its native executable SHA-256 is `aa596fc71ad2ca3986ba890d80f54bcf1d4b188682a45fc0035ae3c9b8c2c4f0`. The independent current-vibe build is pinned to `1f975216e7aa924a02f02837b64e16bb563670215`.

Every check selects `packages/smithers/agent/fs/tsconfig.test.json`:

| Source and compiler | Invocation after `-p <config>` | Exit | EK9206 at Command | EK4402 at Incur |
| --- | --- | ---: | ---: | ---: |
| Untouched main, shipped 0.0.8 | `--noEmit --pretty false` | 0 | 0 | 0 |
| Private migrated main, integration | `--noEmit --pretty false` | 2 | 5 | 4 |
| Same, integration | `--fix --fix-migration-only --noEmit --pretty false` | 2 | 5 | 4 |
| Same, integration | `--fix --noEmit --pretty false` | 2 | 5 | 4 |
| Same, integration after both passes | `--noEmit --pretty false` | 2 | 5 | 4 |
| Same, independently built vibe | `--noEmit --pretty false` | 2 | 5 | 4 |

The migrated program has other diagnostics: 77 errors before the passes and 60 afterward, including the nine sites above. This ruling does not label that program green. The evidence is the unchanged nine target diagnostics, the shipped zero-error control, and the reduced checker-boundary tests.

Canonical private receipts are `smithers-ek9206-ek4402-replay/results/original-check.log`, `migrated-before.log`, `migrated-migration.log`, `migrated-ordinary.log`, `migrated-after.log`, `current-build.log` and `current-check.log`, beside that replay's `run.log`. They are retained outside the repository and contain no credentials.

## Checker-history boundary

The history search was narrowed to the checker files, then the complete compiler source at each adjacent parent/child pair was built independently on a remote build machine. These are actual revision snapshots, not a current compiler with an individual file transplanted. The reduced harness uses Effect 4.1.1, `@types/node` 26.4.1 and the local 0.0.11 runtime tarball; the parent and child see the same dependencies and source. All four compiler builds exit 0.

| Rule | Last accepting parent | First rejecting child in the integration lineage | Reduced result |
| --- | --- | --- | --- |
| EK9206 at a nonrecursive `is` argument | `1a6c5cdb8b40` | `49ab2e790073` — “retain lazy effect lambda signatures (RC-10)” | Generic assertion over `try exit(lex("bad")) is Exit.Failure`: exit 0 / no diagnostics becomes exit 2 / exactly one EK9206 |
| EK4402 inside the platform wrapper | `1fadf24bda3a` | `00814e7d89bc` — “check host capabilities throughout VibeLang files” | `sync((writes) => process.stdout.write(writes.join("")), writes)`: exit 0 / no diagnostics becomes exit 2 / exactly one EK4402 |

On the current vibe lineage used for the snapshot, the same changes are `57cc532779b1` (parent `de2258aca15f`) and `ebeeab3cf668` (parent `08f333f27756`), respectively. The integration-lineage commits above identify the introductions seen by toolchain `8c36e2c0ea69`.

The EK9206 guard itself predates the regression: `93f1b17369d9` introduced the by-name self-call reentry diagnostic, then numbered EK2102, to stop an actual source self-call from overflowing the compiler's stack. `e0671f9473e6` renumbered it to EK9206. Neither renumbering nor that original legitimate guard makes this generated predicate a recursive source function. The new rejecting boundary for the reported acyclic argument shape is the lazy-inference change above.

The platform change explicitly removes the traversal exemptions for hatches and wrapped callbacks. That is why the previously accepted `process.stdout` reference is newly visited; the rule is intended, while its missing preserving repair is a release-staging defect.

Private parent/child receipts are in `smithers-ek9206-ek4402-history/results/focused-build-*.log` and `focused-*-is-inferred-call.log` / `focused-*-host-new.log`, with the revision map in `revisions.tsv` and all diagnostics in `focused.log`. The smaller five-line witness printed above is separately verified against the actual integration binary in `smithers-ek9206-ek4402-minimal/minimal.log`: only EK9206 is an error; EK4834 is advisory.

A broader history run was stopped after its first two successful builds to avoid rebuilding every dependency at different source paths. The focused four-build replay above supersedes it. No compiler or codemod tests were added to the repository because this lane changes only this ruling document. The live migration trees remain untouched.
