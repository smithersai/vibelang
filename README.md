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

## Language Contract

Smithers keeps TypeScript syntax and ecosystem compatibility while making
failures, capabilities, compile-time inputs, and durable work visible to the
compiler. The target language provides:

- typed expected failures with `Result<A, E>` and postfix `!` propagation;
- compiler-inferred capability requirements satisfied by explicit Layers;
- deterministic `comptime(...)` evaluation with tracked inputs;
- compiler-lowered durable Flows made from retryable, idempotent Actions; and
- a TypeScript-only compilation model with checked JavaScript interop.

The documentation is the product specification, not an implementation status
report. [Specification Status](https://docs.smithers.sh/specification/) explains
which rules are locked, directional, or open. The [decision
ledger](https://github.com/smithersai/smithers/blob/main/docs/DECISIONS.md)
records the accepted decisions behind that contract.

## Learn More

- [Docs](https://docs.smithers.sh) — guides, reference, and examples
- [Telegram](https://telegram.smithers.sh) — questions and support
- [awesome-smithers](https://github.com/smithersai/awesome-smithers) — workflow packs, integrations, and community projects

## Contributing

Issues and pull requests are welcome at [smithersai/smithers](https://github.com/smithersai/smithers).

---

**Join our community** [Discord](#) | [YouTube](#) | [X.com](#)
