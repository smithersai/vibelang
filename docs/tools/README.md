# Documentation checks

From the repository root, run `bun install` in `experiments` and `docs/tools`,
run `bun run build` in `packages/runtime`, and build the native compiler:

```sh
cd typescript/tsc
CGO_ENABLED=0 GOFLAGS=-trimpath go build -o ../built/local/tsc ./cmd/tsc
```

Then, from the repository root:

```sh
bun docs/tools/check-snippets.ts
```

The checker extracts `vibe` and `ts` fences under `docs/user`. The fence sets the language: a `vibe` block
compiles as a `.vibe` module, a `ts` block as a `.ts` module. It also checks
`ts effect` comparison blocks. Mark deliberate fragments with `// fragment`;
missing names in an unmarked comparison fail. It skips `ts` blocks
whose first line is `// TypeScript (.ts)` and that name no file. It creates one
temporary project per page, linking the local runtime and Vite plugin packages,
and runs `vibelang --noEmit` once per page; each block gets its own module. A
filename comment in either of the first two lines, such as `// launch-options.ts`
after `// TypeScript (.ts)` or `// main.vibe`, names that file and makes it
available to relative imports. Its extension must match the fence, or the
checker stops with an error. `.ts` companions keep TypeScript semantics and
must import their own dependencies. Blocks with repeated captions are
independent examples and keep numbered filenames, as do unnamed blocks, such as
`block-3.vibe`. Later blocks see earlier examples' imports and declarations; a
new name shadows the earlier one. Blocks that deliberately fail or opt out
supply no declarations to later blocks. Local imports with no fixture remain
fragments. By default no snippet executes; `--run` also checks declared output
(see below).

| Status | Meaning |
| --- | --- |
| `ok` | No unexpected errors; all declared expected codes occur |
| `fragment` | Only TS2304, TS2552, or TS2307 for a relative import; or an explicit opt-out |
| `compiler-gap` | A checked example has a documented compiler disagreement |
| `fail` | Another error, a missing expected diagnostic, or a stale gap marker |

Use a header comment before the code:

- `// expect-error: EK9201` declares an intentionally invalid example; separate
  several codes with spaces. Unexpected diagnostics still fail.
- `// types: node` opts that page project into Node ambient declarations; the
  default is `"types": []`, matching the starter. Document the declaration
  package and tsconfig prerequisite beside any example that needs it.
- `// fragment` opts out of classification for incomplete syntax or a prose
  sketch. The compiler still checks the block.
- `// compiler-gap: <reason>` keeps the intended language example while the
  compiler disagrees. Record the page, first code line, diagnostics, and rule
  in `docs/user/compiler-gaps.md`. A marker becomes stale when the block
  has no unexpected substantive error and every expected code occurs. Stale
  markers fail, so resolved gaps cannot silently accumulate.

`--compiler path` (or `VIBELANG_BINARY`) selects a compiler; the default is
`typescript/built/local/tsc`, then `vibelang` on PATH. `--filter text` selects
pages, and `--json path` writes diagnostics with Markdown line numbers.
Temporary files are removed on success and failure; `--keep` preserves the
temporary projects for debugging. Compiler crashes, missing runtime builds, and
project configuration errors exit 2. Snippet failures exit 1.

`bun docs/tools/fix-snippets.ts` uses the same extraction, page scope and temporary
projects to run `vibelang --fix --fix-migration-only`. It writes changed code
blocks back only when diagnostics still match and every declared output on the
page still runs with its expected stdout, both before and after the edit. A
refusal leaves the whole page unchanged. Prose, fences, output assertions and
plain-TypeScript hatch/module comments are preserved; new hatches and modules
receive those comments. `--check` reports proposed edits without writing, and
`--compiler`, `--root`, `--filter` and `--timeout` work as in the checker.
`--all-fixes` also enables the existing style and prelude cleanups; the default
scope contains decision-1 migration edits only, so S0 makes zero edits.

The checked legacy oracle lives at
`typescript/tsc/internal/vibelang/testdata/legacy_sites.txt`. Regenerate it with
`(cd typescript/tsc && go run ./cmd/vibelang-forms -legacy internal/vibelang/testdata/legacy_sites.txt)`;
`-legacy -` writes stdout instead. It checks the case corpus, examples, templates,
package test fixtures and docs projects prepared by `legacy-snippets.ts`, using
the native classifier rather than the mapper snapshot. Each sorted line records
a span, kind, old boundary/representation and selected signature; conservative
alternate-candidate sites and incomplete applicability checks are labelled.
`(cd typescript/tsc && go test -timeout 20m ./cmd/vibelang-forms -run TestLegacyOracle)`
regenerates and compares the entire file. Both commands require Bun, the pinned
docs dependencies and the built runtime, as the snippet checker does.

```sh
bun test docs/tools/check-snippets.test.ts docs/tools/first-run.test.ts docs/tools/hovers.test.ts
sh scripts/deploy-docs.sh --dry-run
```

## Running examples

```sh
bun docs/tools/check-snippets.ts --run
bun docs/tools/check-snippets.ts --run --filter getting-started/
```

Declare stdout with an `output` fence immediately after a checked code fence
(blank lines are allowed), or one `// Output: text` comment per output line
inside the block. An empty `// Output:` asserts no stdout. Don't use both forms
for one block. Other output fence labels (`out`, `text`) don't opt in.

```vibe
// run: Console.log(greet("Ada"))
function greet(name: string) { return `Hello, ${name}!` }
// Output: Hello, Ada!
```

The optional header comment `// run: <expression>` runs that expression inside
a generated VibeLang entry function, with the block's declarations and imports
in scope. Without it, Node runs the emitted block as the entry module:
export `function main()` or include an explicit top-level runner. Markers never
make a function run in the published example itself.

The `check:snippets` package script and the pre-deploy snippet check both use
`--run`. Both also test the locally scaffolded starter, including Vitest without
a prior build, and compare its stdout to the `out` fences in the getting-started,
installation, and new-project guides. It also checks the compiler version shown
in the existing-project guide. The snippet checker doesn't execute shell commands.

With `--run`, the checker emits marked blocks and their dependencies with the
selected compiler, then runs each entry separately with Node and the linked
local runtime. It compares stdout exactly, normalizing CRLF to LF and removing
one final newline from each side; spaces, ordering, and extra lines matter.
Nonzero exits, execution timeouts (10 seconds by default; set with
`--timeout milliseconds`), compile errors, and output mismatches fail the check.
Examples that import `@effect/vitest`, including through earlier blocks, run
inside Vitest after compilation, and every registered `it.effect` test must pass.
An empty output marker checks their assertions without adding printed output;
a `// run:` header runs as an additional live-clock Effect test with stdout enabled.

Marked fragments, expected-error blocks, and compiler gaps fail instead of
silently skipping execution; unmarked blocks keep their compile-only checks.
Reports include execution status and captured stdout/stderr for marked blocks.
Use `Console.log` for stable output. Logs with timestamps, randomness, network
access, and interactive programs need deterministic fixtures before opting in.
`--keep` retains emitted files and compiler logs for debugging.

## The Cloudflare Workers page

`sh docs/tools/check-worker-page.sh` builds the project of
`platform/cloudflare-workers.md` from its code blocks, with this checkout's
compiler, runtime and `vibelang-unplugin` and with esbuild 0.28.2 and wrangler
4.152.0 from npm, serves it with `wrangler dev`, and compares each `curl`
answer with the comment after it. It needs network access and runs nothing
against a Cloudflare account; `KEEP=1` keeps the project.

## Compiler hovers

scripts/deploy-docs.sh checks hover generation by default with the 0.0.2 release compiler. Vocs uses its own code highlighting; the hover cache remains available to tools. `VIBELANG_DOCS_HOVERS=0` skips hover generation.

`hovers.ts` asks the VibeLang language server for the hovers and diagnostics of
the same blocks and caches them for a renderer:

```sh
bun docs/tools/hovers.ts
```

It builds the snippet checker's projects, with the same
`--compiler`, `--root`, and `--filter` options, and opens them in one
`vibelang --lsp --stdio` session, four pages at a time. It writes one JSON file
per page under `.cache/docs-hovers` (`--cache` selects another directory). Each
block's entry is a Twoslash result: the block's `code` as the fence holds it,
and `nodes` in the shape of `twoslash-protocol`:

| Node | Fields |
| --- | --- |
| `hover` | `start`, `length`, `line`, `character`, `target`, `text` (the quick info), `docs` |
| `error` | the same position fields, `code` such as `EK9201` or `TS2307`, `level` (`error` or `warning`), `text` |

Positions count UTF-16 code units from 0 within the block. `docs` keeps
VibeLang's notes, such as "Runs here and returns `number`.", and the first
paragraph of the declaration's JSDoc. Links to `file:///` URIs keep only their
text, and paths into the temporary project or `node_modules` become relative.
The tool refuses to write a page whose entry still contains anything that
`prepare-site.ts` refuses to publish (`leaks.ts`).

A page's entry is reused while its blocks, the compiler binary, the lockfiles,
the runtime's declarations, and these tools are unchanged; otherwise the
whole page is refreshed, because later blocks import earlier ones. Pages
that no longer exist lose their entries unless `--filter` is set. A hover
request that the server answers with an error is a language server defect:
the page's entry keeps it under `failures`, and every run prints one example of
each, so defects stay visible.
Concurrent hover requests can render a contextually typed property's owner
generically or instantiated, such as `Key<T>` or `Key<string>`, so a cold run
can differ from the last one in a few nodes. Upstream tsgo does the same.

The single docs site is the Vocs site in site/. Its prebuild hook runs
the kernel law suite through docs/tools/kernel-facts.ts, then syncs user and
specification pages with those measured facts. Vocs checks internal links. docs/tools/check-site.ts also checks every built local page and heading target, and refuses missing or external images.

The postbuild hook calls docs/tools/markdown.ts, extracted from the former
HTML renderer, to write each source page as Markdown into site/dist/public.
It preserves code, rewrites page links to their copies on https://vibelang.sh,
moves bare specification fragments to their owning chapter, and removes
targets for repository files that are not pages. index.md and spec/index.md
repeat the first pages. llms.txt starts with docs/user/llms-essentials.md,
then lists every page in one section per sidebar view. The docs/tools test suite
generates fresh Markdown in a temporary directory and runs the site's llms
tests, including the 2,000-byte essentials-prefix limit.

From the repository root, sh scripts/deploy-docs.sh --dry-run runs the release
starter and snippet checks (including declared output), hover generation,
token counts, the brand gate, npm ci, the kernel suite, Vocs build and link
checks, the built llms.txt tests, and prepare-site.ts against site/dist.
The latter refuses local paths, host names, LAN addresses, private repository
names and credential values. Without --dry-run, the command calls npm run
deploy in site/. Redirects deploy separately; see site/README.md.

## Token counts

```sh
bun docs/tools/token-counts.ts --write   # update the Token counts page
bun docs/tools/token-counts.ts --check   # exit 1 if the page drifts (bun run check:tokens, deploy-docs.sh)
bun docs/tools/token-counts.ts --files docs/user/src/setup.md   # count any files
```

`token-counts.ts` counts tokens with OpenAI's `o200k_base` encoding (js-tiktoken 1.0.21, pinned in `package.json`) over each file's exact text. It writes the marked section of `docs/user/src/vibelang-features/117-token-counts.md`: the skill (`packages/compiler/skills/vibelang/SKILL.md`), the skill with the cheat sheet and with the user guide, the specification, the decision log, every page and sidebar group in `inventory.md` order, and each cheat-sheet entry's `ts effect` blocks against its `vibe` blocks, without the checker's `// run:` and `// Output:` lines. A `vibe long` block counts on neither side. The page doesn't count itself. `bun test docs/tools/token-counts.test.ts` covers the pairing and the counting. Change any page, the skill or the decision log, then run `--write`.

## What smithers.sh serves for VibeLang

```sh
bun docs/tools/check-smithers-content.ts
```

Checks the files smithers.sh reads from VibeLang's `main`, and the vibelang.sh hero. It exits 1 on any problem.

- `.smithers/instructions/app.md`, the guest chat's whole knowledge base:
  - it stays under 24 KiB;
  - every link resolves to a docs page source or a repository file;
  - every VibeLang block passes `check-snippets.ts`;
  - the install block equals what `create-vibelang` prints.
- `.smithers/home.json`: decodes with smithers.sh's reader, copied in `home.ts` from `@smthrs/views` (sections with audiences, or a bare `blocks` array); has no block of a kind the reader skips; declares a block; and every markdown path exists.
- `.smithers/flows/convert/prompt.md`: matches `build-prompt.mjs`'s output.
- `docs/site/converter/hero.json`: equals golden case 01, with matching hashes.

It needs the same compiler and runtime build as `check-snippets.ts`. `bun test check-smithers-content.test.ts` covers the link, section and home rules.

## Converter content

`bun run --cwd docs/tools check:content` runs `check-smithers-content.ts`,
which also rejects held-out golden source in the prompt or worked examples,
after normalizing whitespace and comments between tokens. The converter prompt
uses `examples/` only; all 20 cases in `golden/`, including the hero, remain
held out.

Run the overlap regression tests with:

```sh
node --test .smithers/flows/convert/check-heldout.test.mjs
```

## Checking a deployed release

Every `npm run deploy` in `site/` (including `scripts/deploy-docs.sh`) runs
`node docs/tools/deployed-release.mjs` through npm's postdeploy hook. It fetches
the public homepage, setup Markdown, installation HTML and Markdown, llms.txt,
and release notes in both formats, bypassing caches. It compares release pins
and CLI output with the compiler manifest and TypeScript version, and platform
claims with npm's published `vibelang@latest` metadata. Historical release notes
keep their versions. Every mismatch or failed fetch is printed and exits nonzero.

Run it separately after a deployment, or pass a preview origin:

```sh
node docs/tools/deployed-release.mjs
node docs/tools/deployed-release.mjs https://preview.example
node --test docs/tools/deployed-release.test.mjs
```

The check reads the site and registry; it does not deploy anything.

## Diagnostic coverage

`bun docs/tools/check-diagnostic-docs.ts` checks that every compiler message
declared under `typescript/tsc/internal/vibelang/` has a code reference in
`docs/user/src/`. Add its meaning and remedy when adding a diagnostic.
EK4407 is temporarily exempt while module-name resolution is reworked.
The docs/tools test suite runs the same coverage check.

## Global throws snapshot

`node docs/tools/throws-inventory.mjs --write` regenerates
`docs/design/inventory/throws.json` from the compiler's shipped global
contracts and bundled TypeScript declarations. `--check` checks freshness;
`node --test docs/tools/throws-inventory.test.mjs` also checks overloads,
unknown contracts and upstream-input changes. The inventory's `coverage`
fields identify contracts that later slices still need to generate.
