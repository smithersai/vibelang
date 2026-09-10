# Contributing to VibeLang

Thanks for helping build the programming language for agents. This page tells
you how the repository is laid out, how to run the gates that protect it, and
how a language change is supposed to travel from idea to shipped behavior.

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 22 or newer | the CLI, the root test suite, the docs site |
| Bun | 1.2.x | the runtime test suite under `poc/`, and the durable executor |
| Go | see `go.mod` | the compiler bridge into the pinned TypeScript fork |
| Deno | 2.x (optional) | the coding-agent sandbox tests |
| Zig, Rust | optional | foreign-source loader tests |

```bash
git clone https://github.com/smithersai/vibelang
cd vibelang
npm ci
(cd poc && bun install --frozen-lockfile)
npm run build
node bin/vibe.js doctor
```

`vibe doctor` reports which toolchains it found and which product surfaces are
implemented.

## Repository map

| Path | What lives there |
| --- | --- |
| `src/` | the published package surface: the `vibe` CLI, subpath re-exports (`vibelang/context`, `vibelang/provider`, …), the Go backend client |
| `poc/src/` | the reference implementation in TypeScript: language frontend (`language/`), runtime (`runtime/`), platform capabilities (`platform/`), data and schema libraries, durable execution (`durable/`), agent library (`agent/`), comptime and asset loaders (`build/`) |
| `compiler/`, `cmd/` | the Go bridge that runs the same semantics inside the pinned TypeScript fork; `compiler/forkbridge/*.go.txt` are sources compiled into the fork, `compiler/forkpatch/` is the digest-gated patch series against upstream |
| `vendor/typescript/` | the vendored fork source capsule, pinned by `typescript-fork.json` |
| `conformance/` | the corpus: every `.vibe` program with an `.expected.json`; the differential runner; `COVERAGE.md`, the obligation ledger |
| `docs/` | the documentation site (Vocs) and the design documents; `docs/DECISIONS.md` is the decision ledger |
| `test/` | the root Node test suite: CLI, package exports, language server, gates |
| `scripts/` | gates and release tooling |
| `skills/vibelang/` | the agent skill that teaches a coding agent the language |

Generated output lives in `dist/` and `poc/dist/`; both are ignored by Git and
rebuilt by `npm run build`.

## Running the gates

Use the pre-merge entry point. It runs the suites serially once, then verifies
the installed package. Do not run another gate alongside it: concurrent builds
and suite load can invalidate the measurement.

```bash
npm run gate:premerge        # build, Node/conformance, Bun, Go, CLI differential, real tarball
npm --prefix docs run build  # production documentation build
```

`npm run release:verify` runs those two commands in order. For focused work,
`npm test` runs the complete suite chain without the installed-tarball checks;
`node scripts/poc-test-gate.mjs` runs just the Bun suite with its coverage census.

Two traps, both learned the hard way:

- An unfiltered `bun test` must run from `poc/`; running it at the repository
  root discovers unrelated Node tests. Prefer the Bun gate above for a complete
  runtime measurement, since it also rejects accidental skips and focused tests.
- `npm test` **does** run the poc runtime suite and both conformance backends.
  Running it before `gate:premerge` repeats the suites: pre-merge already invokes
  it through `prepack`. Keep focused or interrupted measurements distinct from a
  completed pre-merge run.

The Go gate materializes the pinned TypeScript fork from
`vendor/typescript/` and builds the bridge into
`$TMPDIR/vibelang-ts-fork-cache` (override with `VIBELANG_TYPESCRIPT_FORK_CACHE`).
The first build takes several minutes; later runs reuse it.

`node scripts/brand-gate.mjs` fails on any stray old brand spelling. It runs in
CI and is part of `npm run check`.

## How a language change lands

The specification is the product. Code follows it, never the other way round.

1. **Decide it in the ledger.** `docs/DECISIONS.md` records every accepted
   decision as **Locked**, **Direction**, or **Open**. A change to what the
   language *means* starts as a ledger entry. The ledger wins over the
   specification pages when they disagree, so it must never be staler than
   they are.
2. **Write the specification.** `docs/src/pages/specification/*.mdx` carries
   the normative text. Where the shipped compiler and the specification are
   known to disagree, mark it with an `(SA-n)` or `(IA-n)` marker as described
   in [Specification Status](docs/src/pages/specification/index.mdx); a marker
   records a gap, it never resolves one.
3. **Pin it in the corpus.** Every normative sentence should be observable by
   at least one `conformance/corpus/<area>/<case>.vibe` with an
   `.expected.json`. Update `conformance/COVERAGE.md` and the `xfail` register
   at the bottom of `conformance/README.md` **in the same change**. A case that
   passes on one backend and not the other carries an `xfail` marker naming the
   backend and the reason; when it starts passing, the runner reports `XPASS`
   and the marker is retired.
4. **Implement it twice.** The TypeScript reference under `poc/src/language`
   and the Go bridge under `compiler/` must produce the same observable
   behavior. The conformance runner compares them; a divergence is a failing
   gate, not a note.
5. **Prefer failing closed.** When an implementation cannot yet do what the
   specification requires, it refuses with a diagnostic. It never silently
   narrows a guarantee.

Diagnostic codes are `VIBEnnnn`. Reuse an existing code when the rule is the
same; add a new code only for a new rule, and add its corpus case.

## Commit and pull request conventions

Commit subjects follow the existing history: an emoji, a type, a scope, and an
imperative summary, for example
`✨ feat(language): enforce determinism-sensitive members` or
`✅ test(conformance): pin the fallible generator`. Keep the body factual and
say what was measured.

A pull request should:

- state which ledger entries and specification sections it touches;
- list the gates you ran and their results (a gate you did not run is noted, not
  implied);
- include corpus cases for new or changed behavior;
- keep documentation truthful: if a page describes behavior that does not ship
  yet, say so with a dated note rather than deleting the page.

## Working alongside agents

Several coding agents work in this repository, often at the same time. Keep
changes small and coherent, do not commit another lane's in-flight files, and
re-run `node scripts/brand-gate.mjs` before pushing.

## Code of conduct

This project follows the [code of conduct](CODE_OF_CONDUCT.md). Security
reports go through [SECURITY.md](SECURITY.md).
