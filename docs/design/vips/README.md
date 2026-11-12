# VibeLang improvement proposals

Will, VibeLang's owner, decides each VibeLang language decision as a VIP, one at a time. Nothing is part of the language until an accepted VIP or one of its public amendments states it; old VibeLang is only a reference. The most fundamental decisions come first, and the most controversial come next. Each accepted VIP is recorded here with Will's words. Where an accepted VIP or its public amendment disagrees with the specification, the VIP wins until the specification is rewritten to match it. Authorized clarifications are recorded in public amendments to the relevant VIP and its affected chapter, including the applicable pinned references and explicit reconciliation notes. VIPs never contradict each other: a later VIP that changes an earlier one also updates it.

VibeLang ships no quick fixes or codemods of its own before its first release; they are tech debt, and they may come back after release. TypeScript's own code fixes stay. This rule replaces the earlier rule that every retirement ship a codemod and pass a retirement gate. Will, on the language's principles: “since vibelang hasn't been released yet if we have implemented --fix already thats tech debt. Maybe we do that after we release but it shouldn't be in the principles and it shouldn't be in the language yet.” Asked whether that applies to VibeLang now: “If we added --fix ourselves yes it shoudln't be there maybe we add it later but it's tech debt. If --fix was already in ts obviously it should still be there for ts though”.

| VIP | Title | Status |
| --- | --- | --- |
| [1](0001-effect-and-async-functions.md) | `effect` and `async` functions | accepted 2026-10-28 |
| [2](0002-effect-blocks-and-do.md) | `effect { }` blocks, and `do { }` as TC39 defines it | accepted 2026-10-28 |
| [3](0003-effect-type-shorthand.md) | `A!E!R` is an alias for `Effect<A, E, R>` | accepted 2026-10-28 |
| [4](0004-throw.md) | `throw`, and calls that may throw | accepted 2026-10-28 |
| [5](0005-try-runs-effects.md) | `try` runs an Effect; `await` is only for Promises | accepted 2026-10-28 |
| [6](0006-effect-globals.md) | Effect's functions are globals | accepted 2026-10-28 |
| [7](0007-match.md) | `match` is TC39 pattern matching, plus a compile-time exhaustiveness check | accepted 2026-10-28 |
| [9](0009-service-declarations.md) | `service` declarations | accepted 2026-10-28 |
| [12](0012-provide.md) | `provide` blocks | accepted 2026-10-28 |
| [13](0013-error-declarations.md) | `error` declarations | accepted 2026-10-28 |
| [14](0014-effect-modules-in-scope.md) | Effect's modules are in scope without an import | accepted 2026-10-28 |
| [15](0015-schema-declarations.md) | `schema` declarations | accepted 2026-10-28 |
| [16](0016-data-declarations.md) | `data` declarations (tagged unions) | accepted 2026-10-28 |
| [17](0017-fork.md) | `fork` and `join` | accepted 2026-10-28 |
| [18](0018-concurrent.md) | Running Effects concurrently: `try.all`, `try.race`, `try.any`, `try.allSettled` | accepted 2026-10-28 |
| [19](0019-for-concurrent.md) | `for concurrent` | accepted 2026-10-28 |
| [20](0020-for-try.md) | Iterating a Stream with `for try` | accepted 2026-10-28 |
| [21](0021-producers.md) | Producers: `effect function*` returns a Stream | accepted 2026-10-28 |
| [22](0022-interruption-blocks.md) | Interruption blocks | accepted 2026-10-28 |
| [23](0023-pipe.md) | The pipe operator `\|>` | accepted 2026-10-28 |
| [26](0026-top-level-and-main.md) | Top-level `await`, and no magic `main` | accepted 2026-10-29 |
| [27](0027-declaration-output.md) | Declaration output and `@throws` | accepted 2026-10-29 |
| [28](0028-generic-data.md) | Generic `data` unions | accepted 2026-10-29 |
| [29](0029-schema-errors.md) | Serializable errors: `schema error` | accepted 2026-10-29 |
| [30](0030-config-files.md) | Config files: `vibe.config.json`, `tsconfig.json`, `jsconfig.json` | accepted 2026-10-29 |
| [31](0031-runtime-guarantees.md) | Runtime guarantees | accepted 2026-10-29 |
| [32](0032-effect-version.md) | One pinned Effect version during alpha | accepted 2026-10-29 |
| [33](0033-platform-stdlib.md) | The platform standard library | accepted 2026-10-29 |
| [34](0034-compiler-and-tooling.md) | Compiler and tooling requirements | accepted 2026-10-29 |
| [38](0038-effect-lint-built-in.md) | Effect's type-aware lint is built into VibeLang | accepted 2026-10-29 |
| [39](0039-vibex.md) | `.vibex`: VibeLang with JSX | accepted 2026-10-31 |
| [40](0040-module-declarations.md) | `module` declarations: TypeScript inside a `.vibe` file | accepted 2026-11-03 |
| [41](0041-throw-expressions.md) | TC39 throw expressions | accepted 2026-11-02 |
| [43](0043-theorems.md) | `theorem` and `spec`, proofs in TypeScript's own syntax | accepted 2026-11-07 |
| [44](0044-durable-values.md) | Durable values | accepted 2026-11-06 |

The [built-in set index](reviews/2026-11-09-built-in-set-index.md) and [comparative review and adopted decisions](reviews/2026-11-09-built-in-set.md) accompany optimistically accepted VIPs 55–72. Each records the maintainers' decisions separately from Will's words.

## Acceptance

Will personally approves each VIP. An agent review never accepts a VIP.

During pre-alpha, Will gave standing approval, on 2026-11-09, for VIPs to be accepted before he reviews each of their decisions; he said it ends with the alpha. Such a VIP's Status line records that acceptance and says that Will has not reviewed the VIP's decisions. Each VIP separates his verbatim words from the maintainers' decisions. After alpha, each VIP again needs Will's own words of approval.

The specification as a whole is accepted when four independent reviewers each answer LGTM with a grade of A- or better on the same revision. Will's acceptance rule counts A-.

The specification passed this gate on 2026-10-29 UTC with grades A, A, A- and A-. All four reviewers graded the same snapshot, revision 2d7d13086e6dd64480b60de7dbb1cf2aeac520c7. Three later panels passed again with the same four grades.

After acceptance, later specification changes need only the automated checks to keep it self-consistent while it is built optimistically and fuzz tested. A full panel reviews the specification again before each release.

## Denied

| VIP | Title | Status |
| --- | --- | --- |
| [8](0008-using-denied.md) | Special syntax for Effect resources (`using`, a `scoped` keyword) | denied 2026-10-28 |
| [10](0010-service-call-shorthand-denied.md) | The `Users.find(id)` shorthand | denied 2026-10-28 |
| [11](0011-trailing-blocks-denied.md) | Trailing blocks | denied 2026-10-28 |
| [24](0024-wire-denied.md) | `wire`, automatic layer composition | denied 2026-10-28 |

## Superseded

| VIP | Title | Status |
| --- | --- | --- |
| [25](0025-inline-modules-denied.md) | Inline `module` declarations as a TypeScript escape | superseded by accepted [VIP-40](0040-module-declarations.md), 2026-11-03; denial is historical |

## Open

Listed for a future decision; not part of the language.

| VIP | Title | Status |
| --- | --- | --- |
| [35](0035-handlers-open.md) | Effect handlers (`control`, `handle`, `resume`, `abandon`) | open 2026-10-29 |
| [36](0036-manifest-open.md) | The declaration manifest | open 2026-10-29 |
| [37](0037-effectify-the-universe-open.md) | Effectify the universe | open 2026-10-29 |
| [42](0042-vibelang-in-ts-files-open.md) | VibeLang in `.ts` files | open 2026-11-05 |
| [53](0053-rename-smithersscript-open.md) | Renaming VibeLang | open 2026-11-07 |
| [54](0054-consistent-platform-code-open.md) | One consistent model for platform-specific code | open 2026-11-09 |
| — | From the proposals page (`site/src/pages/proposals.mdx`), each to get its own VIP: [Durable execution](../../../site/src/pages/proposals.mdx#durable-execution), [Compile-time evaluation (`comptime`)](../../../site/src/pages/proposals.mdx#compile-time-evaluation), [Build-time host selection](../../../site/src/pages/proposals.mdx#build-time-host-selection), [Validators derived from types](../../../site/src/pages/proposals.mdx#validators-derived-from-types), [Typed asset imports](../../../site/src/pages/proposals.mdx#typed-asset-imports), [Custom loaders](../../../site/src/pages/proposals.mdx#custom-loaders), [Rust and Zig source imports](../../../site/src/pages/proposals.mdx#rust-and-zig-source-imports), [Coding-agent library](../../../site/src/pages/proposals.mdx#coding-agent-library), [Typed workers](../../../site/src/pages/proposals.mdx#typed-workers), [Shared structs](../../../site/src/pages/proposals.mdx#shared-structs), [Declarations in conditionals](../../../site/src/pages/proposals.mdx#declarations-in-conditionals), [Toolchain commands](../../../site/src/pages/proposals.mdx#toolchain-commands), [Bundler plugins](../../../site/src/pages/proposals.mdx#bundler-plugins), [Mandatory compiler options](../../../site/src/pages/proposals.mdx#mandatory-compiler-options), [TC39 adopt-early list](../../../site/src/pages/proposals.mdx#tc39-adopt-early-list) | open 2026-10-29 |


## Optimistically accepted built-ins

These VIPs are accepted under the pre-alpha standing approval. Their decisions are the maintainers'; Will has not reviewed the individual choices.

| VIP | Title | Status |
| --- | --- | --- |
| [55](0055-durable-tasks-workflows.md) | `task` and `workflow`, durable steps and the plan the compiler derives | accepted optimistically 2026-11-09 |
| [56](0056-durable-waits.md) | Durable waits: timers, signals and human answers | accepted optimistically 2026-11-09 |
| [57](0057-workers-remote.md) | `schema service` and worker imports | accepted optimistically 2026-11-09 |
| [58](0058-capabilities.md) | Capabilities: a permission kernel in the standard library | accepted optimistically 2026-11-09 |
| [59](0059-eval-declarations.md) | Eval declarations: a file kind and a function, no syntax | accepted optimistically 2026-11-09 |
| [60](0060-std-durable.md) | `Experimental.Durable`, the durable runtime | accepted optimistically 2026-11-09 |
| [61](0061-std-triggers.md) | `Experimental.Trigger` and `Experimental.WorkQueue` | accepted optimistically 2026-11-09 |
| [62](0062-std-model.md) | `Experimental.Model`: language models and decision models with no SDK | accepted optimistically 2026-11-09 |
| [63](0063-std-agent.md) | `Experimental.Agent`: the agent loop, model-written scripts and coding-agent CLIs | accepted optimistically 2026-11-09 |
| [64](0064-std-tools.md) | `Experimental.Tools`: the standard tools | accepted optimistically 2026-11-09 |
| [65](0065-std-mcp.md) | `Experimental.McpClient`: MCP servers as toolkits | accepted optimistically 2026-11-09 |
| [66](0066-std-memory.md) | `Experimental.Memory`: durable facts, notes, history and recall | accepted optimistically 2026-11-09 |
| [67](0067-std-sandbox.md) | `Experimental.Sandbox`: provisioned machines | accepted optimistically 2026-11-09 |
| [68](0068-std-secrets.md) | `Experimental.Secrets`: secrets a step uses without holding them | accepted optimistically 2026-11-09 |
| [69](0069-std-eval.md) | `Experimental.Eval` and `Experimental.Scorer` | accepted optimistically 2026-11-09 |
| [70](0070-std-fuzz.md) | `Experimental.Fuzz`: fuzzing and deterministic fiber simulation | accepted optimistically 2026-11-09 |
| [71](0071-std-test.md) | `Experimental.Test`: doubles, assertions and conformance | accepted optimistically 2026-11-09 |
| [72](0072-std-observe.md) | `Experimental.Otlp`: logs, metrics and traces over OTLP | accepted optimistically 2026-11-09 |
