# Changelog

All notable changes to VibeLang are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) once the language leaves alpha.

## [Unreleased]

### Fixed

- `vibe check -p` and `vibe compile -p` without an entry now expand the
  configuration's `.vibe` roots through the native `discoverProject`
  operation (JSONC and `extends` included) and hand them to the checked
  frontend. Before, project mode only forwarded the TypeScript files to the
  TypeScript compiler: a project whose `.vibe` file dropped a Result passed
  with exit 0 and no output, a weakened `tsconfig.json` passed the same way,
  and a project of nothing but `.vibe` files was refused with TS18003. The
  TypeScript roots of a mixed project are still type-checked, and their
  findings are folded into the same report.
- `vibe run` and `vibe test` now resolve the derived-schema runtime
  (`vibelang/schema-runtime`) from a checkout, a global install or a scratch
  directory: the temporary output directory links the package the way an
  installed consumer's `node_modules` does, instead of failing with
  `ERR_MODULE_NOT_FOUND` unless `vibelang` happened to be installed above
  the source.
- Bridge preparation now serializes patching of a shared TypeScript checkout
  across bridge caches with a lock keyed by the checkout, so two preparations
  given different caches (the conformance runner and its self-test each use
  a private one) no longer observe a half-patched checkout on a cold cache.

### Changed

- The package root now shares `vibelang/compiler`'s pinned native Go request
  API. The TypeScript 5.9 `Program`/checker facade, compatibility aliases and
  pass-through plugins are removed, as are its `tsserver`/`vtsserver` launchers.
  Use explicit native compiler requests and `vibe lsp`. High-level language
  and executable-body compiler migration remains in progress.
- **The project is VibeLang again.** The package, CLI, intrinsic specifiers,
  diagnostic codes, and source extension all carry the VibeLang identity. The
  previous brand name, Smithers, and its spellings are retired: <!-- brand-gate: allow -->
  package `smthrs` → `vibelang`; subpaths `smthrs/context` → `vibelang/context`; <!-- brand-gate: allow -->
  specifiers `smithers:flows` → `vibelang:flows` (likewise `comptime`, `exceptions`); <!-- brand-gate: allow -->
  diagnostic codes `SMITHERSnnnn` → `VIBEnnnn`; environment variables `SMITHERS_*` → `VIBELANG_*`; <!-- brand-gate: allow -->
  binaries `smithers` / `smithersc` / `smithers-tsserver` → `vibe` / `vibec` / `vtsserver`; <!-- brand-gate: allow -->
  source extension `.sm` → `.vibe` and `.smx` → `.vibex`. <!-- brand-gate: allow -->
  `scripts/rename-to-vibelang.mjs` performs the rename idempotently and
  `scripts/brand-gate.mjs` keeps it from regressing. The digest-gated fork patch
  series was re-recorded for the renamed sources. The documentation site
  deploys to https://vibelang.sh.
- The published headline is **"The programming language for agents."**
- `vibe init` now writes a project that `vibe check` accepts: a `tsconfig.json`
  with the six mandatory soundness options and a `main.vibe` that prints through
  the `Console` capability.
- The `test/conformance.test.mjs` Go corpus run now fails on a divergent or
  unexpectedly passing case instead of reporting only.

### Added

- `vibelang/schema`: `Schema`, `Codec`, `Json`, and `JsonSchema` are reachable
  from the package.
- Repository hygiene: a CI workflow, `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, this changelog, a brand gate, and a docs-snippet gate
  that compiles the code blocks the documentation labels as complete programs.
- A generated diagnostics reference listing every `VIBEnnnn` code the corpus
  observes.

### Alpha 0 (in progress)

The alpha-0 milestone is the executable-body durable path, demonstrated end to
end by `bun poc/examples/alpha0/demo.ts`:

- a `.vibe` Flow with an `Action`, a loop over a mutable accumulator, and a
  `Layer`-provided capability compiles to an executable body plus an **Effect
  Manifest** (reachable Actions, requirement row, external-input contracts,
  failure row, site table) without ever executing the body;
- the deployment is signed with Ed25519 and three classes of forgery are
  refused;
- the journal lives in SQLite on disk and a fresh executor resumes from it with
  zero repeated provider calls;
- a child process is killed mid-Flow and a second process resumes the same
  execution to the correct answer.

Language and toolchain work that landed on the way there, in ledger terms:

- typed failures as `Result<A, E>` with compiler lifting of `return` and
  `throw`, postfix `!` propagation in expression position with authored
  evaluation order, must-use Results and Promises;
- capability requirements inferred from `Capability.context()` and satisfied by
  `Layer`, with ambient host globals refused (`VIBE1601`) and the
  determinism-hostile members refused or charged (`Scheduler`, `Locale`);
- the resumable calling convention and the effect substrate the failure,
  requirement, and durable handlers share;
- comptime as an imported intrinsic with hermetic, content-addressed evaluation,
  typed asset imports, and schema derivation;
- mandatory and forbidden `tsconfig` options enforced on both backends;
- a Go bridge into the pinned TypeScript fork that agrees with the reference on
  the shared conformance corpus, with the corpus as the differential oracle.

## Earlier history

Before the changelog existed, history lives in the commit log and in the dated
records inside `docs/DECISIONS.md`, `conformance/COVERAGE.md`,
`poc/FINDINGS.md`, and `poc/PRODUCTION_READINESS.md`.
