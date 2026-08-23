<p align="center">
  <a href="https://smithers.sh">
    <img src="https://raw.githubusercontent.com/smithersai/smithers/main/.github/logo.svg" alt="Smithers" width="320">
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/smthrs"><img src="https://img.shields.io/npm/v/smthrs?logo=npm&label=npm&color=1F6FEB" alt="npm version"></a>
  <a href="https://github.com/smithersai/smithers/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/smithersai/smithers/ci.yml?branch=main&logo=github&label=CI" alt="CI status"></a>
  <a href="https://github.com/smithersai/awesome-smithers"><img src="https://img.shields.io/badge/awesome-smithers-8b949e?logo=awesomelists&logoColor=white" alt="awesome-smithers"></a>
</p>

---

Build reliable code with agents and for agents without leaving the TypeScript ecosystem.

## Installing

For the latest stable version:

```bash
npm install -D smthrs
```

For our nightly builds:

```bash
npm install -D smthrs@next
```

If you are not using JavaScript, you can install the CLI globally.

```bash
curl -fsSL https://install.smithers.sh | bash
```

## Get Started

Paste this into whatever agent you use — Claude Code, Codex, Cursor, anything:

```
Read https://docs.smithers.sh/llms.txt to learn how Smithers works.
Then set it up in this project: install `smthrs`, scaffold a workflow that
fits this codebase, run it, and walk me through what each part does.
```

## Implementation Status

This repository contains two Smithers compiler implementations. The checked
TypeScript instrument remains the default for `smithers check`, `compile`, and
`run`. Pass `--backend go` to exercise the opt-in implementation that runs in
the pinned Go TypeScript fork; it lowers Result and Optional lifting,
`.unwrap()` propagation, async `Promise<Result<...>>`, nominal error matching,
the Smithers control-flow grammar, and bounded implementations of both
`smithers:comptime` and `smithers:flows`.

> **Specification drift.** As of 2026-08-23 the specification was substantially
> reduced and the implementation has not caught up. The code still carries the
> expression-form control-flow grammar, `defer`/`errdefer`, labeled value
> breaks, `Optional<T>`, `.unwrap()` (now postfix `!`), the TypeScript non-null
> assertion, and the near-native/Wasm targets with their `TypeScript`
> requirement, feature classification, and portability pin — none of which the
> language still defines. See "The Implementation Currently Exceeds This
> Specification" in `docs/src/pages/specification/index.mdx` for the removal
> worklist. Where code and specification disagree, the specification wins.

The Go implementation also owns typed asset imports end to end — all five
built-in loaders (`json`, `json` with `mode: "const"`, `text`, `bytes`,
`markdown`, `mdx`), with the loader selected by the authored import attribute and
never by file extension, and with asset edges treated as compile-time only so
they add no runtime platform requirement.

`smithers format` and `smithers lsp` are implemented. The formatter drives the
TypeScript language-service formatter and changes whitespace only. The stdio
JSON-RPC language server provides diagnostics, failure/requirement-row hover,
definition lookup, and whole-document formatting. Both run on the TypeScript
instrument, not the Go compiler.

The conformance corpus is a contract, not a completeness claim. It is growing
while backend-parity work continues; use
[`conformance/COVERAGE.md`](https://github.com/smithersai/smithers/blob/main/conformance/COVERAGE.md)
as the live obligation and
case census instead of copying a scoreboard into documentation. That matrix
also records four kinds of uncovered work: open or directional rules, locked
features without a settled spelling, surfaces absent from both backends, and
properties the harness cannot yet observe.

Read a zero-divergence result for what it is. It means the two implementations
agree on the questions the corpus asks — not that they agree in general. An audit
that compared their full accepted surface (module specifiers, file extensions,
import attributes, diagnostic codes, flags, and trust escape hatches) rather than
running more cases found ten divergences no case could observe, because a corpus
grown alongside two implementations converges on their intersection. All ten are
fixed; `conformance/COVERAGE.md` also names the rules that exist in one
implementation and are probed by no case, which is where this class hides.

Important current boundaries:

- the TypeScript instrument is still the root CLI default;
- `.sm` is registered through the fork's content-mapper extension, not as a
  built-in TypeScript source kind;
- the reviewable fork patch series is not vendored into the distribution or
  signed;
- the LLVM and Wasm backends, the `TypeScript` requirement, feature
  classification, and the portability pin are all implementation of **withdrawn**
  specification obligations. TypeScript is now the only compilation target;
  those surfaces are pending removal, not supported features;
- compiler and loader sandboxes are process boundaries, not container or VM
  isolation; and
- the durable runtime has local restart/replay evidence but no multi-machine
  coordination.

See [the pinned-fork guide](docs/TYPESCRIPT_FORK.md), [the compatibility and
CLI boundary](docs/COMPATIBILITY_API.md), and [the decision
ledger](https://github.com/smithersai/smithers/blob/main/docs/DECISIONS.md)
for the reviewable details.

## Learn More

- [Docs](https://docs.smithers.sh) — guides, reference, and examples
- [Telegram](https://telegram.smithers.sh) — questions and support
- [awesome-smithers](https://github.com/smithersai/awesome-smithers) — workflow packs, integrations, and community projects

## Contributing

Issues and pull requests are welcome at [smithersai/smithers](https://github.com/smithersai/smithers).

---

**Join our community** [Discord](#) | [YouTube](#) | [X.com](#)
