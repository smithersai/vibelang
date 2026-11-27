---
title: VIPs and Specification Grading
tags: [process, vips, specification, spec-review]
---

# VIPs and Specification Grading

VibeLang's semantics are governed by formal **VibeLang Improvement Proposals (VIPs)** under `docs/design/vips/` (`VIP-0001` through `VIP-0075`) and rendered into the normative specification in `docs/design/src/`.

## Proposal Lifecycle

1. **Proposal**: A language change opens as a numbered VIP describing exact syntax, static type rules, Effect 4 lowering, diagnostic codes (`EK*`), and edge cases.
2. **Adversarial Four-Reviewer Grading (`spec-review`)**: Four independent reviewers (`fable`, `opus`, `sol`, `astra`) grade the specification revision (`A-` or higher with `LGTM` required for acceptance). Findings are tracked by origin in the Factory Reviews tab.
3. **Executable Oracles**: Every accepted VIP rule gets compiler acceptance cases under `typescript/vibelang/cases/`, Go quote/registry tests (`smthrs ci //:spec-tests`), and differential Go fuzz targets under `typescript/tsc/internal/vibelangfuzz/`.
4. **Retired Syntax Guardrails**: Denied or retired spellings (`layer Name`, `service class`, `with Provider`, `control class`, `wire`, trailing blocks) carry dedicated diagnostic codes (`EK2121`, `EK0909`, `EK3501`, `EK1101`) so neither humans nor agents regress into obsolete syntax.

## Major Proposal Groups

- **Core Effects (`VIP-0001` to `VIP-0016`)**: `effect` functions, `effect { }` and `do { }`, `A!E!R`, `throw`, `try`, Effect globals, `match`, `service`, `provide`, `error`, `schema`, `data`.
- **Concurrency and Streams (`VIP-0017` to `VIP-0023`)**: `fork`/`join`, `try.all`/`try.race`/`try.any`/`try.allSettled`, `for concurrent`, `for try`, `effect function*` producers, `uninterruptible`/`restore`, Hack pipe `|>`.
- **Tooling and Interop (`VIP-0026` to `VIP-0041`)**: explicit `main`, `.d.vibe.ts` sidecars, generic `data`, `schema error`, `vibe.config.json`, Effect 4 pin, platform stdlib, built-in Effect lint, `.vibex` JSX, `module` blocks for foreign throwing code.
- **Durable Workflows (`VIP-0044`, `VIP-0055` to `VIP-0073`)**: durable values, `task` and `workflow`, durable waits, remote workers, capabilities, eval declarations, and standard library modules for agents, tools, MCP, memory, sandboxes, secrets, fuzzing, and observability.
- **Ergonomics & Effect UI Interop (`VIP-0074`, `VIP-0075`)**: `schema data` serializable tagged unions (`Schema.TaggedUnion`) and concise tagged `catch { when ... }` with automatic residual error rethrow.

## Related Notes

- [[Mythical-History]]
- [[Compiler-Pipeline]]
- [[Overview]]
