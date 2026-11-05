// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:24:20](../../../typescript/vibelang/cases/ek1001-top-level.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK0101` | `effect f() { }` or `async f() { }` outside a class or object literal Replay [example: main.vibe:3:8](../../../typescript/vibelang/cases/cov-ch900a-ek0101.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK0202` | a `break` or `continue` whose target is outside the block of an `effect { … }` expression Replay [example: main.vibe:4:72](../../../typescript/vibelang/cases/cov2-002a-block-outward-jump.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK0301` | `!` beside a union, an intersection, a conditional type, or a function or constructor type in a slot, without parentheses: `A \| B!E`, `() => A!E \| B`, `A!() => B` (write `A!(() => B)`) Replay [example: main.vibe:3:10](../../../typescript/vibelang/cases/cov-ch900a-ek0301.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK0509` | a `catch` handler that is not a plain or `effect` arrow or function expression: `a catch b`, `a catch effect { }`, `a catch async (e) => b`, `a catch function* (e) { }`; a parameter list followed directly by a block, as in `try x catch (e) { }`, gets `EK0509` without adding `EK0505` for the same malformed handler Replay [example: main.vibe:9:64](../../../typescript/vibelang/cases/catch-value-source-diagnostics.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK0510` | an unparenthesized `try`, `try.all`, `try.race`, `try.any`, `try.allSettled`, `fork`, `fork.in(s)`, `fork.scoped`, `fork.detached` or `join` expression on the left of `**`, as ECMAScript rejects `await a ** b`; parenthesize it: `(try a) ** b` Replay [example: main.vibe:7:42](../../../typescript/vibelang/cases/execution-power.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK0701` | a missing `;` after a `match` arm, the last one included Replay [example: main.vibe:5:26](../../../typescript/vibelang/cases/data-declarations-match-separator.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK0703` | lint warning: an extractor whose argument count can never match its pattern's list, `when NotFound():` Replay [example: main.vibe:9:57](../../../typescript/vibelang/cases/match-extractor-arity/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK0704` | an extractor `when C(…)`, `C()` included, on an ordinary class without its own `Symbol.customMatcher` (an inherited one does not count); write `when C:` or `when C and { x: let x }:` (VIP-7, amended) Replay [example: main.vibe:4:60](../../../typescript/vibelang/cases/cov-ch900a-ek0704.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK0904` | an `extends` or `implements` clause on a service: `service S extends Base { }` Replay [example: main.vibe:8:25](../../../typescript/vibelang/cases/ek0904-service-heritage.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK0905` | `export default service S { }`; write `export { S as default }` Replay [example: commented.vibe:1:34](../../../typescript/vibelang/cases/service-default-export.fail/commented.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK0908` | two `service` members with no separator between them, such as `a: number b: string` on one line; write `;` or a line break between them (quick fix: insert `;`) Replay [example: main.vibe:4:74](../../../typescript/vibelang/cases/cov2-900b-cite-service-member-separator.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK1010` | a forbidden punctuator follows a throw expression; parenthesize the operand or the whole throw; `--fix` groups the whole throw before a legacy comma separator | 41 | [Failures](003-failures.md#throw-expressions) |
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK1101` | a trailing block: a `{` on the same line after a name, a property access or a call, `f(x) { … }` or `f { … }`, outside a heritage clause and a `provide` block's providers, where no TypeScript or VibeLang production admits the `{` (so `effect { … }`, `match (x) { … }`, `namespace A.B { … }` and declaration heads such as `service S { … }` are not trailing blocks); quick fix: pass the block as the call's last argument, `f(x, effect { … })` where it ran as a program, `f(x, effect () => { … })` where it ran as an Effect function, `f(x, () => { … })` otherwise Replay [example: main.vibe:9:45](../../../typescript/vibelang/cases/trailing-block-denied.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK1305` | `export default error E` or `export default schema error E`; write `export { E as default }` Replay [example: bodyless.vibe:1:16](../../../typescript/vibelang/cases/error-default-export.fail/bodyless.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK1306` | two `error` or `schema error` body members with no separator between them; write `;` or a line break between them (quick fix: insert `;`) Replay [example: main.vibe:4:21](../../../typescript/vibelang/cases/missing-body-separator.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK1501` | `export default schema S …`; write `export { S as default }` Replay [example: main.vibe:2:16](../../../typescript/vibelang/cases/cov-ch900a-ek1501.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK1603` | `export default data D { … }`; write `export { D as default }` Replay [example: main.vibe:2:16](../../../typescript/vibelang/cases/cov-ch900a-ek1603.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK1605` | two variants of a `data` declaration, or two fields of a variant, with no separator between them; write `;` or a line break between them (quick fix: insert `;`) Replay [example: main.vibe:2:18](../../../typescript/vibelang/cases/data-member-separators.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK1703` | a `fork`, `fork.in(s)`, `fork.scoped` or `fork.detached` operand that fails the operand test of `try` Replay [example: main.vibe:2:45](../../../typescript/vibelang/cases/cov-ch900a-ek1703.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | For an unparenthesized conditional at either end of a pipe, `x \|> f(%) ? a : b`: the pinned proposal's conditional-body error and a pipe as a conditional's test; write `(x \|> f(%)) ? a : b` to test the result or `x \|> (f(%) ? a : b)` to pipe into the conditional Replay [example: main.vibe:8:27](../../../typescript/vibelang/cases/cov-ch002b-running-pipe-missing-topic-absent.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK4008` | `export =` or `import x = require()` in a module body Replay [example: main.vibe:4:3](../../../typescript/vibelang/cases/cov2-900b-cite-ek4008-module-cjs.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK4402` | interim warning inside formerly accepted boundary callbacks; error otherwise: a value import of a Node builtin, with or without `node:` (`node:fs`, `fs`), a string-literal `import(…)` of one, or a statically named value that [reaches the platform](005-services.md#reaches-the-platform): a global declared by `lib.dom`, `lib.webworker`, `lib.scripthost` or `@types/node` and not by `lib.es*` or `lib.decorators*`, minus the allowlist, or a banned member of an allowlisted global, in a `.vibe` file Replay [example: main.vibe:4:74](../../../typescript/vibelang/cases/cov-ch002b-running-import-forbidden-builtin.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | Category variants: `error`, `warning`.
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK4609` | lint warning: `await` on a `Fiber` in an `async` function; to obtain its result in that context, use `await runPromise(Fiber.join(fiber))` Replay [example: main.vibe:2:70](../../../typescript/vibelang/cases/await-handle-async-warnings/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK4610` | lint warning: `await` on a `Deferred` in an `async` function; to obtain its result in that context, use `await runPromise(Deferred.await(deferred))` Replay [example: main.vibe:3:79](../../../typescript/vibelang/cases/await-handle-async-warnings/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK4830` | lint warning: A class written with `Data.TaggedError("Name")` Replay [example: main.vibe:9:7](../../../typescript/vibelang/cases/ek2004-dead-catch.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK4834` | lint warning: `Effect.succeed(v)` or `Effect.fail(e)` as the direct operand of bare `try` in effect code Replay [example: main.vibe:13:5](../../../typescript/vibelang/cases/ek2004-dead-catch.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK4839` | lint warning: An Effect `Match` chain with a supported finisher, or a direct `Option.match(value, handlers)` call Replay [example: main.vibe:8:10](../../../typescript/vibelang/cases/tsforms-match/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK1011` | compiler dependency error: an Effect construct cannot resolve the installed Effect type; install the pinned peer before compiling.
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | Example: `effect function f() { return 1 }` with no resolvable Effect package | 6, 32, 34 | [Tooling](007-tooling.md#the-effect-version) |
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK2112` | warning: a legacy catch clause tests its failure's type; the preserving migration removes the annotation and tests the value with `match` or `is`.
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | Example: `catch (e: NotFound) { recover(e) }` in legacy effect code Replay [example: main.vibe:15:15](../../../typescript/vibelang/cases/catch-retired/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK2113` | warning: a legacy Cause-typed catch clause; migrate to matching `exit(program)` with `Exit.Success` and `Exit.Failure`.
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | Example: `catch (cause: Cause.Cause<E>) { recover(cause) }` in legacy effect code Replay [example: main.vibe:13:19](../../../typescript/vibelang/cases/primitives.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK2120` | warning: the legacy `service class` or `control class` declaration spelling; its preserving migration removes `class`.
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | Example: `service class Users { get(): string }` Replay [example: main.vibe:5:1](../../../typescript/vibelang/cases/decl-old-declarations/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | | `EK2121` | warning: a legacy layer declaration; migrate to an equivalent `Layer.effect` or `Layer.succeed` call, retaining construction timing and requirements.
// rule-evidence: docs/design/src/900-appendices.md#appendix-b-diagnostics | Example: `layer UsersLive: Users { get() { return "Ada" } }` Replay [example: main.vibe:8:8](../../../typescript/vibelang/cases/decl-layer-order.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK1308` | warning: an abstract error root is a legacy declaration form.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Example: `abstract error Root`; use the preserving fix to retain its Effect TypeScript class.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | 13, 29 | Run `vibelang --fix`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK9204` | warning: an old Effect `try`/`catch` statement has no expected errors, or the head of a `catch` expression cannot fail, reported at its `catch` keyword Replay [example: main.vibe:25:28](../../../typescript/vibelang/cases/catch-expression.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK1001` | error: legacy compiler compatibility — a module-level expression runs a legacy implicit program.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:2:1](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK1001).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK1003` | error: legacy compiler compatibility — `await using` is rejected by the legacy non-async fallback.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Ordinary async code permits Promise-based iteration/disposal; effect code uses `EK0102`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:1](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK1003).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK1015` | error: legacy compiler compatibility — the legacy checker rejects `yield*` in code it classified as an implicit program.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Use `try` in effect code; ordinary JavaScript generators retain `yield*`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:17](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK1015).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK1017` | error: legacy compiler compatibility — `provide` is used as an expression.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Use a `provide` statement and return from its block.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:37](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK1017).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK2114` | error: legacy compiler compatibility — a catch expression appears inside a legacy hatch body.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Hatches are retired; native `.ts` code uses JavaScript try statements.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:42](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK2114).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK2127` | error: legacy compiler compatibility — a data type's value is accessed through a nonexistent variant name.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:3:23](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK2127).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK3206` | error: legacy compiler compatibility — legacy platform imports name two different platforms in one file.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:2:8](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK3206).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4201` | error: legacy compiler compatibility — a legacy control operation runs under a combinator on another fiber.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:9:24](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4201).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4401` | error: legacy compiler compatibility — a foreign call has no legacy trusted exception contract.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Follow tracked `@throws` contracts and wrap throwing calls with `Effect.try`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:3:10](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4401).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4410` | error: legacy compiler compatibility — a legacy syntax intrinsic such as a hatch or prelude `fork`/`join` is stored or renamed.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Hatches are retired; native `fork` and `join` use the accepted syntax and reservation rules.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:26](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4410).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4501` | error: legacy compiler compatibility — a legacy data-type extension method is accessed without a direct call.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:2:26](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4501).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4502` | error: legacy compiler compatibility — a legacy automatically run call's success value is used as though it had a `pipe` method.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:64](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4502).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4602` | error: legacy compiler compatibility — the legacy checker rejects awaiting a Promise.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Promises may be awaited in async code; use `tryPromise` and `try` in effect code.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:2:53](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4602).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4603` | error: legacy compiler compatibility — the legacy checker rejects awaiting a non-`Fiber` value.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:57](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4603).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4703` | error: legacy compiler compatibility — the legacy lowering cannot supply an `is` binding's lexical home.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:2:22](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4703).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4805` | warning: legacy compiler compatibility — a class extends a native global `Error`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Use `error` for a tagged failure; the imported native-error rule has its `EK38…` identity.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:14](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4805).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4806` | warning: legacy compiler compatibility — a failure-mapping callback returns `unknown` or `any`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:77](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4806).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4812` | warning: legacy compiler compatibility — `new Promise` appears in code the legacy checker treats as effect code.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Ordinary JavaScript may construct Promises; run a Promise in effect code through `tryPromise`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:23](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4812).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4813` | error: legacy compiler compatibility — a resolved Effect API uses a renamed or removed Effect 3 spelling.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:31](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4813).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4816` | off by default (warning when enabled): legacy compiler compatibility — a layer is provided at a site checked by the legacy strict-provision rule.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:38; error](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4816).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4818` | off by default (warning when enabled): legacy compiler compatibility — `JSON.parse` or `JSON.stringify` is used without a schema.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:10; warning; also EK0401](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4818).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4821` | off by default (warning when enabled): legacy compiler compatibility — a `Schema.Struct` has a literal `_tag` field.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Optional legacy repair to `Schema.TaggedStruct`; default off.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:23; error](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4821).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4822` | off by default (warning when enabled): legacy compiler compatibility — a condition is not a boolean.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:7; error; also TS2304](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4822).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4823` | off by default (warning when enabled): legacy compiler compatibility — an arrow block contains only a returned expression.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:48; error](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4823).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4824` | off by default (warning when enabled): legacy compiler compatibility — a pipe has no functions.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:21; error](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4824).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4825` | off by default (warning when enabled): legacy compiler compatibility — a pipe continues another pipe.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:1:22; error; also EK4840](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/registry-EK4825).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK1002` | error: legacy compiler compatibility — a generator-based API receives a legacy producer.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Native `function*` retains JavaScript generator semantics; an Effect producer is explicitly `effect function*`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK1005` | error: legacy compiler compatibility — a root runner is called inside code already running on a fiber.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Run the Effect with `try` in effect code; explicit runner APIs keep their Effect behavior.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:44:3](../../../typescript/vibelang/cases/ek1005-runners.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK1012` | warning: legacy compiler compatibility — a legacy automatically run call that never succeeds is stored.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Calls return values normally; an Effect is run explicitly with `try`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:19:19; error; also EK4834](../../../typescript/vibelang/cases/never-stored.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK1013` | error: legacy compiler compatibility — a comma remains a class-body separator in an inherited error or control declaration; root error payload fields, data variants, services and schema fields accept the shared separators.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:12:43](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/appendix-ek1013-complete-project).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK2006` | error: legacy compiler compatibility — a legacy effect `finally` block contains an outward `return`, `break` or `continue`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay EK2006 [example: main.vibe:12:5](../../../typescript/vibelang/cases/ek2006-finally-jump.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK2105` | error: legacy compiler compatibility — a typed legacy `catch` clause names a union member without a literal `_tag`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:2:65; also EK2112](../../../typescript/vibelang/cases/decl-catch-untagged.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK2106` | error: legacy compiler compatibility — a legacy `catch` clause follows one that catches every failure.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:11:15; also EK2112](../../../typescript/vibelang/cases/decl-catch-order.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK2107` | error: legacy compiler compatibility — a legacy `handle` clause names a value that is not a control declaration.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:37:12](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/appendix-ek2107-complete-project).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK2108` | error: legacy compiler compatibility — a legacy `handle` statement omits a control operation clause.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:15:12](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/appendix-ek2107-complete-project).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK2110` | error: legacy compiler compatibility — a non-tail legacy `resume` reads a result whose type omits a possible handler result.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:114:25](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/appendix-ek2110-complete-project).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK2119` | error: legacy compiler compatibility — a legacy handler clause returns a value outside a waiting `resume`'s answer type.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:142:12](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/appendix-ek2110-complete-project).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK3101` | error: legacy compiler compatibility — a legacy provider reads a service at call time where its contract admits no requirements.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK3202` | error: legacy compiler compatibility — legacy automatic wiring finds two providers for one service.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK3203` | error: legacy compiler compatibility — legacy automatic wiring finds a provider cycle.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK3204` | error: legacy compiler compatibility — a legacy `wire` argument's type does not expose its outputs.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK3205` | warning: legacy compiler compatibility — a legacy automatically started `main` needs an unprovided service.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | An ordinary `main` has no automatic host invocation; run and provide its Effect explicitly.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: home.vibe:6:24](../../../typescript/vibelang/cases/ek3205-layers.fail/home.vibe).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK3207` | error: legacy compiler compatibility — a provider is not a `Layer`, `Context`, non-empty layer tuple or `Key = value` binding.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4202` | error: legacy compiler compatibility — a TypeScript callable's legacy requirements contain a control operation.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:10:14](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/appendix-ek4202-complete-project).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4301` | error: legacy compiler compatibility — a legacy implicit Effect callback is passed where a synchronous callback is expected.
// rule-evidence: docs/design/src/900-appendices.md | The old `EK4405` is retired and will never be reassigned: hatches are retired, and VIP-6 permits lexical wrapper captures.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4406` | warning: legacy compiler compatibility — a legacy trusted or throws declaration tag cannot survive the old emit transition.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Current declaration output carries `@throws`; this warning describes the old transition only.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: lib.vibe:51:45; also EK4401](../../../typescript/vibelang/cases/ek4401-fix.fail/lib.vibe).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4604` | error: legacy compiler compatibility — a legacy non-async hatch body contains `await`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4616` | error: legacy compiler compatibility — the retired `try(…)` hatch form is used.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Wrap native code with `Effect.try` or `tryPromise`, then run its Effect with `try`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:9:13](../../../typescript/vibelang/cases/ek4616-try-hatch.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4704` | error: legacy compiler compatibility — the current lowering does not support a pattern form.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4801` | error: legacy compiler compatibility — an Effect value is discarded as a statement.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4803` | warning: legacy compiler compatibility — multiple versions of an Effect package are loaded.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4804` | warning: legacy compiler compatibility — an Effect failure is a global `Error` without a distinguishing tag.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4807` | warning: legacy compiler compatibility — `Layer.mergeAll` combines layers whose services depend on one another.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Compose dependencies explicitly; do not apply the historical `wire` repair.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4808` | warning: legacy compiler compatibility — a `provide` block contains only another `provide` block.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4809` | warning: legacy compiler compatibility — every service member requires the same service.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4810` | warning: legacy compiler compatibility — an assertion removes part of an Effect's error or requirement channel.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4811` | off by default (warning when enabled): legacy compiler compatibility — `any` or `unknown` enters an Effect channel.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4814` | warning: legacy compiler compatibility — a `Schema` class overrides its constructor.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4815` | warning: legacy compiler compatibility — an Effect value is thrown as an Effect failure.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4817` | off by default (warning when enabled): legacy compiler compatibility — `instanceof` tests a `Schema` class rather than schema membership.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Use `Schema.is`; the optional legacy port defaults off.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4840` | warning: legacy compiler compatibility — an Option pipeline can be converted to legacy extension-method syntax.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4601` | error: legacy compiler compatibility — `await` before a call returning an Effect in plain code.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Example: `function run() { return await Effect.succeed(1) }`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Native async functions retain JavaScript `await`; effect code rejects it with `EK0102`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4409` | warning: legacy compiler compatibility — a legacy Effect function returns a call of a value typed `any`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Ordinary return types retain TypeScript's treatment of `any`; use `try` to obtain an Effect's success value.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4838` | error: legacy compiler compatibility — legacy ownership analysis sees a `Fiber` leave its fork region.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4819` | error: legacy compiler compatibility — an editor requests the historical missing-star repair for `yield effect`.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Example: `function* g() { yield Effect.succeed(1) }`; [editor example: yield-star](../../../typescript/tsc/internal/vibelang/diagnostic_appendix_hosts_test.go).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK4820` | error: legacy compiler compatibility — an editor requests the historical return repair for `yield*` of an Effect that never succeeds.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Example: `function* g() { yield* Effect.fail("x") }`; [editor example: yield-return](../../../typescript/tsc/internal/vibelang/diagnostic_appendix_hosts_test.go).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK9209` | error: a legacy layer setup statement follows a member.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | The canonical EK2005 is reserved for a for-try head.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:21:60](../../../typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzCompile/appendix-ek9210-complete-project).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK9211` | error: a legacy runner or automatic wiring site lacks a required provider.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | EK3201 belongs only to the Effect version pin.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | Replay [example: main.vibe:28:21](../../../typescript/vibelang/cases/ek3201-runner-services.fail/main.vibe).
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | | interim `EK9214` | error: a service key is called with arguments in the legacy service lowering.
// rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | EK3007 belongs only to configuration keys and values.
// Executable diagnostic examples use the published row as the expected identity.
// A runner failure or an incomplete fixture cannot count as a successful probe.
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, existsSync, cpSync } from "node:fs"
import { join, resolve, basename, dirname, sep } from "node:path"
import { fileURLToPath } from "node:url"
import {nativeProjectHost,installFixturePeers} from "./diagnostic-native-projects.mjs"
import {archiveExamples} from "./diagnostic-archive-examples.mjs"
import { appendixCodes, appendixCategory, appendixCategories, loadIdentity, repository } from "./diagnostic-identity.mjs"

export function printedDiagnostics(text) {
  return [...text.matchAll(/(?:^|\n)([^\n]*?)\((\d+),(\d+)\): (error|warning|suggestion) ((?:EK|TS)\d+):([^\n]*)/g)]
    .map(m=>({file:m[1],line:+m[2],column:+m[3],category:m[4],code:m[5],message:m[6].trim()}))
}
export function checkExample(example, appendix, result) {
  if (!appendix.has(example.code)) return [{kind:"example-missing-row",code:example.code,name:example.name}]
  if (result.error || result.signal || result.status === null)
    throw new Error(example.name+": compiler execution failed: "+(result.error?.message??result.signal))
  const output=(result.stdout??"")+"\n"+(result.stderr??"")
  const allDiagnostics=printedDiagnostics(output)
  const diagnostics=example.at?allDiagnostics.filter(d=>basename(d.file)===example.at.file && d.line===example.at.line && d.column===example.at.column):allDiagnostics
  if (result.status && !allDiagnostics.length) throw new Error(example.name+": compiler failed without located source diagnostics")
  if(example.categoryVariant&&!appendixCategories(appendix.get(example.code)).includes(example.categoryVariant))throw Error(example.code+": undeclared context category")
  const expected=example.control?[]:[{code:example.code,category:example.categoryVariant??example.exampleCategory??appendixCategory(appendix.get(example.code))}]
  for(const code of example.also??[]) {
    if(!code.startsWith("TS") && !appendix.has(code)) return [{kind:"example-missing-row",code,name:example.name}]
    expected.push({code,category:code.startsWith("TS")?"error":appendixCategory(appendix.get(code))})
  }
  const actual=[...new Map(diagnostics.map(d=>[d.code+":"+d.category,{code:d.code,category:d.category}])).values()]
  const same=JSON.stringify(actual.sort((a,b)=>a.code.localeCompare(b.code)))===JSON.stringify(expected.sort((a,b)=>a.code.localeCompare(b.code)))
  if (same && example.messageIncludes && !diagnostics.some(d=>d.code===example.code&&d.message.includes(example.messageIncludes)))
    return [{kind:"example-meaning-mismatch",code:example.code,name:example.name,expected:example.messageIncludes,actual:output}]
  return same?[]:[{kind:"example-code-mismatch",code:example.code,name:example.name,expected,actual}]
}
export async function probeExamples(examples, appendix, compiler, root=repository) {
  const base=mkdtempSync(join(root,".cache/diagnostic-examples-"))
  const receipts=[],createdLinks=[]
  const link=(target,path)=>{if(!existsSync(path)){symlinkSync(target,path);createdLinks.push(path)}}
  // The implicit prelude resolves Effect from the runtime package's real path.
  // Link that peer too on an isolated worker; never substitute another package.
  const modules=resolve(process.env.EFFECT_NODE_MODULES??join(root,"experiments/node_modules"))
  mkdirSync(join(root,"packages/runtime/node_modules"),{recursive:true})
  link(join(modules,"effect"),join(root,"packages/runtime/node_modules/effect"))
  readFileSync(join(modules,"effect/package.json"))
  readFileSync(join(root,"packages/runtime/node_modules/effect/package.json"))
  // Keep the complete native case layout, with each replayed project copied:
  // stubs and optional peers match the normal harness, and compiler sidecars
  // cannot mutate its source cases.
  const native=examples.some(e=>e.project)?nativeProjectHost(root,join(base,"native")):undefined
  try {
    const runExample=async ([i,example])=> {
      let dir
      try {dir=example.project?native.prepare(example.project):join(base,String(i))}
      catch(error) {
        const finding={kind:"example-host-failure",code:example.code,name:example.name,reason:error.message}
        receipts[i]={...finding,findings:[finding]};console.error("diagnostic-example:host-failure "+JSON.stringify(finding));return
      }
      if(!example.project) {
        mkdirSync(dir);mkdirSync(join(dir,"node_modules"))
        writeFileSync(join(dir,"package.json"),'{"type":"module","name":"diagnostic-example"}')
        for(const [name,contents] of Object.entries(example.files??{"main.vibe":example.source})) {
          const path=resolve(dir,name);if(!path.startsWith(dir+sep)) throw Error("unsafe diagnostic example path")
          mkdirSync(dirname(path),{recursive:true});writeFileSync(path,contents)
        }
        if(!example.configName) writeFileSync(join(dir,"tsconfig.json"),JSON.stringify({compilerOptions:{target:"ESNext",module:"NodeNext",moduleResolution:"NodeNext",strict:true,noEmit:true,skipLibCheck:true,types:[]},files:["main.vibe"]}))
        if(example.effectPeer!==false && !existsSync(join(dir,"node_modules/effect"))) symlinkSync(join(modules,"effect"),join(dir,"node_modules/effect"))
        if(!existsSync(join(dir,"node_modules/vibelang-runtime"))) {
          if(example.effectPeer===false) {
            const isolated=join(dir,"runtime-without-effect");mkdirSync(isolated)
            const runtime=resolve(process.env.VIBELANG_RUNTIME??join(root,"packages/runtime"))
            cpSync(join(runtime,"package.json"),join(isolated,"package.json"))
            cpSync(join(runtime,"dist"),join(isolated,"dist"),{recursive:true})
            symlinkSync(isolated,join(dir,"node_modules/vibelang-runtime"))
          } else symlinkSync(resolve(process.env.VIBELANG_RUNTIME??join(root,"packages/runtime")),join(dir,"node_modules/vibelang-runtime"))
        }
        installFixturePeers(dir,modules,resolve(process.env.VIBELANG_RUNTIME??join(root,"packages/runtime")))
      }
      const configText=readFileSync(join(dir,example.configName??"tsconfig.json"),"utf8")
      const buildInfo=/"(?:composite|incremental)"\s*:\s*true/.test(configText)?["--tsBuildInfoFile",join(base,String(i)+".tsbuildinfo")]:[]
      const started=Date.now()
      console.error("diagnostic-example:start "+example.code+" "+example.name)
      const result=await new Promise(done=>execFile(compiler,["--singleThreaded","--pretty","false","--noEmit","--emitDeclarationOnly","false",...buildInfo,"-p",join(dir,example.configName??"tsconfig.json")],{cwd:dir,encoding:"utf8",timeout:60000,maxBuffer:2*1024*1024},(error,stdout,stderr)=>done({
        stdout,stderr,status:error?(typeof error.code==="number"?error.code:null):0,signal:error?.signal,
        ...(error&&typeof error.code!=="number"?{error}:{})
      })))
      const output=(result.stdout??"")+"\n"+(result.stderr??"")
      const errors=checkExample(example,appendix,result)
      if(errors.length) console.error("diagnostic-example:mismatch "+JSON.stringify(errors))
      const receipt={code:example.code,name:example.name,sourceSha256:createHash("sha256").update(example.source).digest("hex"),configSha256:createHash("sha256").update(configText).digest("hex"),...(example.project?{project:example.project}:{}),milliseconds:Date.now()-started,status:result.status,diagnostics:printedDiagnostics((result.stdout??"")+"\n"+(result.stderr??"")),findings:errors,...(errors.length?{failureOutput:output.slice(0,16000)}:{})}
      receipts[i]=receipt;console.error("diagnostic-example:done "+example.name+" "+(errors.length?"FAIL":"PASS")+" "+receipt.milliseconds+"ms")
    }
    // Keep a native project's witnesses sequential: its compiler may create
    // sidecars. Independent projects use at most four single-threaded compilers.
    const byProject=new Map()
    for(const indexed of examples.entries()) {
      const key=indexed[1].project?resolve(root,indexed[1].project):indexed[0]
      if(!byProject.has(key))byProject.set(key,[])
      byProject.get(key).push(indexed)
    }
    const groups=[...byProject.values()]
    let next=0
    const worker=async ()=>{
      while(next<groups.length)for(const indexed of groups[next++])await runExample(indexed)
    }
    // Drain every active compiler before removing the shared isolated host,
    // including when one execution fails without usable diagnostics.
    const workers=await Promise.allSettled(Array.from({length:Math.min(4,groups.length)},worker))
    const failure=workers.find(result=>result.status==="rejected")
    if(failure)throw failure.reason
  } finally {for(const path of createdLinks.reverse()) rmSync(path);rmSync(base,{recursive:true,force:true})}
  return {findings:receipts.flatMap(receipt=>receipt.findings),receipts}
}
export function resolveExamples(fixtures,appendix,root=repository) {
  const archives=archiveExamples(appendix,root),seen=new Set(),examples=[]
  let retiredInventory
  for(const fixture of fixtures) {
    if(fixture.retired) {
      retiredInventory??=loadIdentity(root)
      if(appendix.has(fixture.code)||retiredInventory.registered.has(fixture.code))throw Error(fixture.code+": retired fixture still has a row or registration")
      continue
    }
    if(fixture.host) {
      if(!appendix.has(fixture.code))throw Error(fixture.code+": host fixture has no Appendix row")
      const test=readFileSync(join(root,fixture.testPath),"utf8")
      if(!test.includes("func "+fixture.testName+"("))throw Error(fixture.code+": missing executable host test")
      if((fixture.host==="registration-only")!==!!fixture.emissionPending)throw Error(fixture.code+": registration-only host must declare pending emission")
      if(fixture.emissionPending) {
        if(!appendix.get(fixture.code).includes("Emission witness pending for `"+fixture.code+"`"))throw Error(fixture.code+": missing pending emission label")
        const source=readFileSync(join(root,"docs/tools/spec-diagnostic-compatibility-pending.test.mjs"),"utf8")
        const titles=[...source.matchAll(/^test\.todo\(("(?:[^"\\]|\\.)*")\)$/gm)].map(m=>JSON.parse(m[1]))
        if(!titles.some(t=>t.startsWith("rule-evidence: docs/design/src/900-appendices.md#transitional-compiler-diagnostics | "+fixture.code+" current emission remains unproved;")))throw Error(fixture.code+": missing pending emission test")
      }
      continue
    }
    if(!fixture.archive){examples.push(fixture);continue}
    const matches=archives.filter(e=>e.code===fixture.code)
    if(!matches.length)throw Error(fixture.code+": fixture has no located Appendix example")
    if(seen.has(fixture.code))throw Error(fixture.code+": duplicate archive fixture")
    seen.add(fixture.code);examples.push(...matches.map(e=>({...e,...(fixture.messageIncludes?{messageIncludes:fixture.messageIncludes}:{})})))
  }
  for(const example of archives)if(!seen.has(example.code))throw Error(example.code+": located Appendix example lacks an executable fixture")
  return examples
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  mkdirSync(join(repository,".cache"),{recursive:true})
  const fixtures=JSON.parse(readFileSync(join(repository,"typescript/vibelang/cases/appendix-diagnostic-identities/examples.json"),"utf8"))
  const appendix=appendixCodes(readFileSync(join(repository,"docs/design/src/900-appendices.md"),"utf8"))
  const result=await probeExamples(resolveExamples(fixtures,appendix),appendix,resolve(process.env.VIBELANG_COMPILER??join(repository,"packages/compiler/native/vibelang")))
  console.log(JSON.stringify(result,null,2));process.exitCode=result.findings.length?1:0
}
// rule-evidence: docs/design/src/900-appendices.md | The old `EK4403` is retired and will never be reassigned: VIP-33 reports host clock and randomness reads as `EK4402` by resolved host origin.
// rule-evidence: docs/design/src/900-appendices.md | The old `EK9210` is retired and will never be reassigned: the first-release continuation retirement reports `EK3501` before provider or operation-contract analysis; VIP-35 remains open.
