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

## Acceptance

Will's own approval is part of the criteria for accepting any VIP. An automatic check or an automatic approval only shows that a proposal is ready to be discussed, by Will and the community, and approved by Will. An agent review never accepts a VIP, and no VIP is accepted before Will reviews its decisions any more. Each VIP separates his verbatim words from the maintainers' decisions.

Will's ruling of 2026-11-11 on acceptance:

> "THe factory should require approval by myself as part of the criteria automatic approval just means it's ready to even be discussed and approved by myself and community"

Will's standing approval of 2026-11-09, superseded by the ruling above and kept as history: during pre-alpha, VIPs were accepted before he reviewed each of their decisions, and such a VIP's Status line said that Will had not reviewed the VIP's decisions. He said it would end with the alpha. VIPs 55 to 72 were accepted this way.

Will's ruling of 2026-11-11 limits the alpha to the core VIPs and reopens the built-in set, VIPs 55 to 72:

> "Ok so our release will include only the core VIP and then we put experimental flag behind the built in stuff we consider those VIP and the other VIP we added experimental still."

> "we need to dispatch [an] agent to get these experimental mark the VIP as not accepted and as open proposals please."

Each of VIPs 55 to 72 needs Will's own approval to be accepted again. The alpha's supported language is the 33 accepted VIPs numbered 1 to 41. VIPs 43 and 44 stay accepted by Will and are outside the alpha's supported set.

The specification as a whole is accepted when four independent reviewers each answer LGTM with a grade of A- or better on the same revision. Will's acceptance rule counts A-.

The specification passed this gate on 2026-10-29 UTC with grades A, A, A- and A-. All four reviewers graded the same snapshot, revision 2d7d13086e6dd64480b60de7dbb1cf2aeac520c7. Three later panels passed again with the same four grades.

After acceptance, the automated checks keep later specification changes self-consistent while it is built and fuzz tested; they never accept a VIP. A full panel reviews the specification again before each release.

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
| [55](0055-durable-tasks-workflows.md) | `task` and `workflow`, durable steps and the plan the compiler derives | open 2026-11-11, experimental |
| [56](0056-durable-waits.md) | Durable waits: timers, signals and human answers | open 2026-11-11, experimental |
| [57](0057-workers-remote.md) | `schema service` and worker imports | open 2026-11-11, no implementation |
| [58](0058-capabilities.md) | Capabilities: a permission kernel in the standard library | open 2026-11-11, no implementation |
| [59](0059-eval-declarations.md) | Eval declarations: a file kind and a function, no syntax | open 2026-11-11, no implementation |
| [60](0060-std-durable.md) | `Experimental.Durable`, the durable runtime | open 2026-11-11, experimental |
| [61](0061-std-triggers.md) | `Experimental.Trigger` and `Experimental.WorkQueue` | open 2026-11-11, no implementation |
| [62](0062-std-model.md) | `Experimental.Model`: language models and decision models with no SDK | open 2026-11-11, no implementation |
| [63](0063-std-agent.md) | `Experimental.Agent`: the agent loop, model-written scripts and coding-agent CLIs | open 2026-11-11, no implementation |
| [64](0064-std-tools.md) | `Experimental.Tools`: the standard tools | open 2026-11-11, no implementation |
| [65](0065-std-mcp.md) | `Experimental.McpClient`: MCP servers as toolkits | open 2026-11-11, no implementation |
| [66](0066-std-memory.md) | `Experimental.Memory`: durable facts, notes, history and recall | open 2026-11-11, experimental |
| [67](0067-std-sandbox.md) | `Experimental.Sandbox`: provisioned machines | open 2026-11-11, no implementation |
| [68](0068-std-secrets.md) | `Experimental.Secrets`: secrets a step uses without holding them | open 2026-11-11, no implementation |
| [69](0069-std-eval.md) | `Experimental.Eval` and `Experimental.Scorer` | open 2026-11-11, experimental |
| [70](0070-std-fuzz.md) | `Experimental.Fuzz`: fuzzing and deterministic fiber simulation | open 2026-11-11, experimental |
| [71](0071-std-test.md) | `Experimental.Test`: doubles, assertions and conformance | open 2026-11-11, experimental |
| [72](0072-std-observe.md) | `Experimental.Otlp`: logs, metrics and traces over OTLP | open 2026-11-11, no implementation |
| — | From the proposals page (`site/src/pages/proposals.mdx`), each to get its own VIP: [Durable execution](../../../site/src/pages/proposals.mdx#durable-execution), [Compile-time evaluation (`comptime`)](../../../site/src/pages/proposals.mdx#compile-time-evaluation), [Build-time host selection](../../../site/src/pages/proposals.mdx#build-time-host-selection), [Validators derived from types](../../../site/src/pages/proposals.mdx#validators-derived-from-types), [Typed asset imports](../../../site/src/pages/proposals.mdx#typed-asset-imports), [Custom loaders](../../../site/src/pages/proposals.mdx#custom-loaders), [Rust and Zig source imports](../../../site/src/pages/proposals.mdx#rust-and-zig-source-imports), [Coding-agent library](../../../site/src/pages/proposals.mdx#coding-agent-library), [Typed workers](../../../site/src/pages/proposals.mdx#typed-workers), [Shared structs](../../../site/src/pages/proposals.mdx#shared-structs), [Declarations in conditionals](../../../site/src/pages/proposals.mdx#declarations-in-conditionals), [Toolchain commands](../../../site/src/pages/proposals.mdx#toolchain-commands), [Bundler plugins](../../../site/src/pages/proposals.mdx#bundler-plugins), [Mandatory compiler options](../../../site/src/pages/proposals.mdx#mandatory-compiler-options), [TC39 adopt-early list](../../../site/src/pages/proposals.mdx#tc39-adopt-early-list) | open 2026-10-29 |

## The built-in set

VIPs 55 to 72 were accepted on 2026-11-09 under Will's standing approval of that date, which the 2026-11-11 acceptance ruling supersedes. On 2026-11-11 Will limited the alpha to the core VIPs, and all 18 became open proposals, listed under [Open](#open): none is part of the language. What is already built from them stays in the release as experimental only. Each VIP's Status line says whether an experimental implementation exists, names it, and says how to opt in.

The [built-in set index](reviews/2026-11-09-built-in-set-index.md) and [comparative review and adopted decisions](reviews/2026-11-09-built-in-set.md) accompany VIPs 55–72. Each records the maintainers' decisions separately from Will's words.
