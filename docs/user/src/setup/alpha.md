# What is in the alpha

Vibe 0.0.14 (published on npm as `vibelang`) is the official alpha. It supports the 33 accepted VIPs numbered 1 to 41 (the core language). Implemented experimental features beyond the core, including accepted `task` and `workflow` declarations, `theorem` declarations, and the `Experimental` stdlib modules below, require `"vibe": { "experimental": ["builtins"] }` in `tsconfig.json` or `vibe.config.json`; without it the compiler reports `EK3013`.

`Experimental` holds two kinds of module: VIP-33's platform additions (`Experimental.FileSystem`, `Experimental.Encoding`, and peers) are core and need no opt-in, while open-proposal modules marked experimental below require it.

File a [bug report](https://github.com/smithersai/vibelang/issues/new?template=bug.yml) or propose a change with an [idea](https://github.com/smithersai/vibelang/issues/new?template=idea.yml); Will approves each VIP after discussion.

| VIP | Title | Alpha and main-branch status |
| --- | --- | --- |
| [1](https://vibelang.sh/vips/0001-effect-and-async-functions) | `effect` and `async` functions | Supported |
| [2](https://vibelang.sh/vips/0002-effect-blocks-and-do) | `effect { }` blocks, and `do { }` as TC39 defines it | Supported |
| [3](https://vibelang.sh/vips/0003-effect-type-shorthand) | `A!E!R` is an alias for `Effect<A, E, R>` | Supported |
| [4](https://vibelang.sh/vips/0004-throw) | `throw`, and calls that may throw | Supported |
| [5](https://vibelang.sh/vips/0005-try-runs-effects) | `try` runs an Effect; `await` is only for Promises | Supported |
| [6](https://vibelang.sh/vips/0006-effect-globals) | Effect's functions are globals | Supported |
| [7](https://vibelang.sh/vips/0007-match) | `match` is TC39 pattern matching, plus a compile-time exhaustiveness check | Supported |
| [8](https://vibelang.sh/vips/0008-using-denied) | special syntax for Effect resources (`using` and a `scoped` keyword) | Denied |
| [9](https://vibelang.sh/vips/0009-service-declarations) | `service` declarations | Supported |
| [10](https://vibelang.sh/vips/0010-service-call-shorthand-denied) | the `Users.find(id)` shorthand | Denied |
| [11](https://vibelang.sh/vips/0011-trailing-blocks-denied) | trailing blocks | Denied |
| [12](https://vibelang.sh/vips/0012-provide) | `provide` blocks | Supported |
| [13](https://vibelang.sh/vips/0013-error-declarations) | `error` declarations | Supported |
| [14](https://vibelang.sh/vips/0014-effect-modules-in-scope) | Effect's modules are in scope without an import | Supported |
| [15](https://vibelang.sh/vips/0015-schema-declarations) | `schema` declarations | Supported |
| [16](https://vibelang.sh/vips/0016-data-declarations) | `data` declarations (tagged unions) | Supported |
| [17](https://vibelang.sh/vips/0017-fork) | `fork` and `join` | Supported |
| [18](https://vibelang.sh/vips/0018-concurrent) | running Effects concurrently: `try.all`, `try.race`, `try.any`, `try.allSettled` | Supported |
| [19](https://vibelang.sh/vips/0019-for-concurrent) | `for concurrent` | Supported |
| [20](https://vibelang.sh/vips/0020-for-try) | iterating a Stream with `for try` | Supported |
| [21](https://vibelang.sh/vips/0021-producers) | producers: `effect function*` returns a Stream | Supported |
| [22](https://vibelang.sh/vips/0022-interruption-blocks) | interruption blocks: `uninterruptible`, `restore`, `interruptible` | Supported |
| [23](https://vibelang.sh/vips/0023-pipe) | the pipe operator `\|>` | Supported |
| [24](https://vibelang.sh/vips/0024-wire-denied) | `wire`, automatic layer composition | Denied |
| [25](https://vibelang.sh/vips/0025-inline-modules-denied) | inline `module` declarations as a TypeScript escape | Superseded by VIP-40 |
| [26](https://vibelang.sh/vips/0026-top-level-and-main) | top-level `await`, and no magic `main` | Supported |
| [27](https://vibelang.sh/vips/0027-declaration-output) | declaration output and `@throws` | Supported |
| [28](https://vibelang.sh/vips/0028-generic-data) | generic `data` unions | Supported |
| [29](https://vibelang.sh/vips/0029-schema-errors) | serializable errors: `schema error` | Supported |
| [30](https://vibelang.sh/vips/0030-config-files) | config files: `vibe.config.json`, `tsconfig.json`, `jsconfig.json` | Supported |
| [31](https://vibelang.sh/vips/0031-runtime-guarantees) | runtime guarantees | Supported |
| [32](https://vibelang.sh/vips/0032-effect-version) | one pinned Effect version during alpha | Supported |
| [33](https://vibelang.sh/vips/0033-platform-stdlib) | the platform standard library | Supported |
| [34](https://vibelang.sh/vips/0034-compiler-and-tooling) | compiler and tooling requirements | Supported |
| [35](https://vibelang.sh/vips/0035-handlers-open) | effect handlers (`control`, `handle`, `resume`, `abandon`) | Denied |
| [36](https://vibelang.sh/vips/0036-manifest-open) | the declaration manifest (`vibelang.manifest.json`) | Denied |
| [37](https://vibelang.sh/vips/0037-effectify-the-universe-open) | Effectify the universe | RFP (future consideration) |
| [38](https://vibelang.sh/vips/0038-effect-lint-built-in) | Effect's type-aware lint is built into VibeLang | Supported |
| [39](https://vibelang.sh/vips/0039-vibex) | `.vibex`, VibeLang with JSX | Supported |
| [40](https://vibelang.sh/vips/0040-module-declarations) | `module` declarations, TypeScript inside a `.vibe` file | Supported |
| [41](https://vibelang.sh/vips/0041-throw-expressions) | TC39 throw expressions | Supported |
| [42](https://vibelang.sh/vips/0042-vibelang-in-ts-files-open) | Vibe in `.ts` files (`// @vibe`) | Accepted (2026-11-23); compiler implements `// @vibe` (`vibelang-typescript` shim is a source-checkout preview) |
| [43](https://vibelang.sh/vips/0043-theorems) | `theorem` and `spec`, proofs in TypeScript's own syntax | Accepted; `theorem` declarations, proof audit (`EK4317`/`EK4318`), and `vibe.proofDir` implemented (opt-in) |
| [44](https://vibelang.sh/vips/0044-durable-values) | Durable values | Accepted, not in the alpha; its schema mapping is supported as part of VIP-15 |
| [53](https://vibelang.sh/vips/0053-rename-smithersscript-open) | Naming the language **Vibe** (Go/Golang model) | Accepted (2026-11-26); **Vibe** naming and `vibe` / `vibe-format` CLI commands shipped in 0.0.14 |
| [54](https://vibelang.sh/vips/0054-consistent-platform-code-open) | One consistent model for platform-specific code | RFP (request for proposal) |
| [55](https://vibelang.sh/vips/0055-durable-tasks-workflows) | `task` and `workflow`, durable steps and the plan the compiler derives | Accepted (2026-11-23); implemented (`task`, `workflow`, opt-in) |
| [56](https://vibelang.sh/vips/0056-durable-waits) | Durable waits: timers, signals and human answers | Implemented in 0.0.14 (opt-in): durable waits, workflow deadlines and recorded race outcomes |
| [57](https://vibelang.sh/vips/0057-workers-remote) | `schema service` and worker imports: threads and other machines behind one typed boundary | Implemented in 0.0.14 (opt-in): schema services, worker imports, RPC and bundler worker entries |
| [58](https://vibelang.sh/vips/0058-capabilities) | Capabilities: a permission kernel in the standard library (+ task plan metadata) | Implemented in 0.0.14 (opt-in): runtime capabilities, task and workflow plan metadata, and capability ceilings |
| [59](https://vibelang.sh/vips/0059-eval-declarations) | Eval declarations: a file kind and a function, no syntax | Implemented in 0.0.14 (opt-in): `vibe eval` discovers `*.eval.vibe` files, and bundlers reject eval entries |
| [60](https://vibelang.sh/vips/0060-std-durable) | `Experimental.Durable`, the durable runtime: journal, replay, run state, step cache and time travel | Accepted (2026-11-23) — **library only (no compiler changes)**; implemented |
| [61](https://vibelang.sh/vips/0061-std-triggers) | `Experimental.Trigger` and `Experimental.WorkQueue`: cron triggers and durable queues | Accepted (2026-11-23) — **library only (no compiler changes)**; implemented |
| [62](https://vibelang.sh/vips/0062-std-model) | `Experimental.Model`: language models and decision models with no SDK | Accepted (2026-11-23) — **library only (no compiler changes)**; implemented |
| [63](https://vibelang.sh/vips/0063-std-agent) | `Experimental.Agent`: the agent loop, model-written scripts and coding-agent CLIs | Accepted (2026-11-23) — **library only (no compiler changes)**; implemented (`Agent.run` & `Agent.stream`) |
| [64](https://vibelang.sh/vips/0064-std-tools) | `Experimental.Tools`: the standard tools for files, search, HTTP, the web, the shell and language servers | Accepted (2026-11-23) — **library only (no compiler changes)**; implemented |
| [65](https://vibelang.sh/vips/0065-std-mcp) | `Experimental.McpClient`: MCP servers as toolkits, on Effect's client and server | Accepted (2026-11-23) — **library only (no compiler changes)**; implemented |
| [66](https://vibelang.sh/vips/0066-std-memory) | `Experimental.Memory`: durable facts, notes, history and recall across runs | Accepted (2026-11-23) — **library only (no compiler changes)**; implemented |
| [67](https://vibelang.sh/vips/0067-std-sandbox) | `Experimental.Sandbox`: provisioned machines behind the ordinary platform services | Accepted (2026-11-23) — **library only (no compiler changes)**; implemented |
| [68](https://vibelang.sh/vips/0068-std-secrets) | `Experimental.Secrets`: secrets a step uses without holding them | Accepted (2026-11-23) — **library only (no compiler changes)**; implemented |
| [69](https://vibelang.sh/vips/0069-std-eval) | `Experimental.Eval` and `Experimental.Scorer`: suites, scorers, judges, baselines and gates | Accepted (2026-11-23) — **library only (no compiler changes)**; implemented |
| [70](https://vibelang.sh/vips/0070-std-fuzz) | `Experimental.Fuzz`: fuzzing and deterministic fiber simulation | Accepted (2026-11-23) — **library only (no compiler changes)**; implemented |
| [71](https://vibelang.sh/vips/0071-std-test) | `Experimental.Test`: doubles, assertions and conformance for agentic programs | Accepted (2026-11-23) — **library only (no compiler changes)**; implemented |
| [72](https://vibelang.sh/vips/0072-std-observe) | `Experimental.Otlp`: logs, metrics and traces over OTLP, scrubbed and bounded | Accepted (2026-11-23) — **library only (no compiler changes)**; implemented |
| [73](https://vibelang.sh/vips/0073-std-patterns) | `Experimental.Patterns` and `PACKAGE.vibe`: the reference engine's patterns and build graph, written in Vibe | Accepted (2026-11-23) — **library only (no compiler changes)**; implemented |
| [74](https://vibelang.sh/vips/0074-schema-data) | Serializable tagged unions: `schema data` | Implemented on `main`: lowers `schema data Name { … }` to `Schema.TaggedUnion` + type alias |
| [75](https://vibelang.sh/vips/0075-tagged-catch) | Concise tagged `catch` (`e catch { when … }`) | Implemented on `main`: effectful `when` / `default` arms with residual error narrowing |
