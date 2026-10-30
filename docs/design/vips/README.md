# VibeLang improvement proposals

Will decides each VibeLang language decision as a VIP, one at a time. Nothing is part of the language until an accepted VIP or one of its public amendments states it; old VibeLang is only a reference. The most fundamental decisions come first, and the most controversial come next. Each accepted VIP is recorded here with Will's words. Where an accepted VIP or its public amendment disagrees with the specification, the VIP wins until the specification is rewritten to match it. Authorized clarifications are recorded in public amendments to the relevant VIP and its affected chapter, including the applicable pinned references and explicit reconciliation notes. VIPs never contradict each other: a later VIP that changes an earlier one also updates it.

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


## Denied

| VIP | Title | Status |
| --- | --- | --- |
| [8](0008-using-denied.md) | Special syntax for Effect resources (`using`, a `scoped` keyword) | denied 2026-10-28 |
| [10](0010-service-call-shorthand-denied.md) | The `Users.find(id)` shorthand | denied 2026-10-28 |
| [11](0011-trailing-blocks-denied.md) | Trailing blocks | denied 2026-10-28 |
| [24](0024-wire-denied.md) | `wire`, automatic layer composition | denied 2026-10-28 |
| [25](0025-inline-modules-denied.md) | Inline `module` declarations as a TypeScript escape | denied 2026-10-29 |

## Open

Listed for a future decision; not part of the language.

| VIP | Title | Status |
| --- | --- | --- |
| [35](0035-handlers-open.md) | Effect handlers (`control`, `handle`, `resume`, `abandon`) | open 2026-10-29 |
| [36](0036-manifest-open.md) | The declaration manifest | open 2026-10-29 |
| [37](0037-effectify-the-universe-open.md) | Effectify the universe | open 2026-10-29 |
| — | From the proposals page (`site/src/pages/proposals.mdx`), each to get its own VIP: [Durable execution](../../../site/src/pages/proposals.mdx#durable-execution), [Compile-time evaluation (`comptime`)](../../../site/src/pages/proposals.mdx#compile-time-evaluation), [Build-time host selection](../../../site/src/pages/proposals.mdx#build-time-host-selection), [Validators derived from types](../../../site/src/pages/proposals.mdx#validators-derived-from-types), [Typed asset imports](../../../site/src/pages/proposals.mdx#typed-asset-imports), [Custom loaders](../../../site/src/pages/proposals.mdx#custom-loaders), [Rust and Zig source imports](../../../site/src/pages/proposals.mdx#rust-and-zig-source-imports), [Coding-agent library](../../../site/src/pages/proposals.mdx#coding-agent-library), [Typed workers](../../../site/src/pages/proposals.mdx#typed-workers), [Shared structs](../../../site/src/pages/proposals.mdx#shared-structs), [Declarations in conditionals](../../../site/src/pages/proposals.mdx#declarations-in-conditionals), [Toolchain commands](../../../site/src/pages/proposals.mdx#toolchain-commands), [Bundler plugins](../../../site/src/pages/proposals.mdx#bundler-plugins), [Mandatory compiler options](../../../site/src/pages/proposals.mdx#mandatory-compiler-options), [JSX source files](../../../site/src/pages/proposals.mdx#jsx-source-files), [TC39 adopt-early list](../../../site/src/pages/proposals.mdx#tc39-adopt-early-list) | open 2026-10-29 |

