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

`TMPDIR` may name a symlink to a temporary directory. The checker resolves that directory before creating example projects, so compiler diagnostics still belong to their Markdown blocks and later pages are checked.


Snippet projects link individual packages from both dependency trees, including every child of a shared scope such as `@effect`. Earlier packages retain priority, and extending an existing scoped link leaves its shared installation unchanged.

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
`packages/compiler/native/vibelang` (or `vibelang.exe` on Windows), then
`typescript/built/local/tsc`. Without either build, checks fail on the missing
checkout compiler; run `sh scripts/build-vibelang.sh` first. These tools never
fall back to `vibelang` on `PATH`, including hover generation, snippet fixes
and `--run` execution. An explicit compiler option can select an installed
release. `--filter text` selects pages, and `--json path` writes diagnostics with Markdown line numbers.
Both snippet commands exit `2` if the root contains no Markdown pages or the filter matches none, before dependency setup or writing receipts. A selected prose page with no code is allowed.
Temporary files are removed on success and failure; `--keep` preserves the
temporary projects for debugging. Compiler crashes, missing runtime builds, and
project configuration errors exit 2. Snippet failures exit 1.

The pending-marker output regression uses executable logging fixtures with `export effect function main()` and `try Console.log(...)`. Its native property checks 32 generated Unicode and quoted messages against exact output and a changed final line. The three-stage CLI regression reports phase timings, exit status and output byte counts within a two-minute deadline.

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
`--timeout milliseconds`), compile errors, and output mismatches fail the check. On POSIX,
each compiler or execution command owns a process group. Its deadline remains
active until both output streams close and kills that group, including children
that keep a pipe open after their parent exits. The result retains partial
output, the parent's exit status and `timedOut: true`; a zero parent exit
does not turn that timeout into a pass. Windows kills the immediate process.
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

`scripts/deploy-docs.sh` checks hover generation by default with the selected npm release compiler. Vocs uses its own code highlighting; the hover cache remains available to tools. `VIBELANG_DOCS_HOVERS=0` skips hover generation.

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
specification pages with those measured facts. The `F10a` wake-up-chain probe
uses a logical stack budget of `64` evaluations instead of exhausting the host
stack, so JIT-dependent overflow recovery cannot hang documentation generation. Vocs checks internal links. docs/tools/check-site.ts also checks every built local page and heading target, and refuses missing or external images.

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
and CLI output with npm latest and the TypeScript version, and platform
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
The docs/tools test suite runs the same coverage check. Appendix B coverage also checks imported lint rows against `lint-codes.json` and the compiler's `VibeImportedLintCodes` registry, preserving whole codes beyond ordinal `99`.

Regenerate the normative shipped throw contracts with `node docs/tools/throws-inventory.mjs --write`; check them with `node docs/tools/throws-inventory.mjs --check` or `node --test docs/tools/throws-inventory.test.mjs`. Install `docs/tools` first. This reads the compiler's bundled TypeScript lib files and the pinned Effect package's published declarations and `dist` sources. Computed properties use their source spellings, such as `[Symbol.iterator]`, in declaration keys and callback paths; TypeScript's process-local symbol IDs never enter the artifact.

The throws generator keeps unmodeled native methods and unresolved source protocols at `unknown`. Source proofs do not infer safe argument types from erased JavaScript parameters; add a native proof only with argument-validation evidence and a regression.

Detail 202 treats the iterator protocol of `Array.from(it)`, `new Map(it)` and `new Set(it)` as implicit. The source reader follows numeric `dual` arities through imports and aliases: fewer arguments build a function without executing the body, while a full invocation keeps the body's throw contract. Returned callable contracts retain each invocation stage; a full call that itself returns a function is not mistaken for a data-last factory. Dynamic arity predicates remain conservative. The settled `Effect.catchTag` factory keeps its detail-202 `never` contract.

Built-in argument validation quantifies over each selected declaration's complete typed domain (detail 205), not its call-site values. String padding uses `ToLength` and has own `never`; `repeat` keeps `RangeError` even at safe literal calls (detail 206).

Selected overloads remain distinct: `String.normalize`'s closed union of valid normalization forms is `never`, while its open `string` overload is `RangeError` (detail 205).

Regenerate the normative imported lint inventory and both spec tables with `node docs/tools/lint-codes.mjs --write`; check staleness with `node docs/tools/lint-codes.mjs --check` or `node --test docs/tools/lint-codes.test.mjs`. The assignment registry reserves removed names; new names append in sorted order.


## Published install metadata

Site builds resolve the install version with `npm view vibelang version`, then
read that version's compiler, runtime and platform manifests from npm. A failed
registry query stops the build. Main's compiler manifest can name an unpublished
candidate. The site hides newer release-note sections until publication; the
repository retains them.

`VIBELANG_RELEASE_VERSION` overrides the version for release rehearsals. When it
matches the compiler candidate, local manifests supply its platforms and Effect
pin, and `VIBELANG_RELEASE_TARBALLS` supplies its binaries. The pre-upload and
post-deploy checks still require that version to be npm latest. An explicit
`--dry-run` builds the rehearsal without the live pre-upload check; an upload always checks npm latest. Normal builds
use the published runtime's Effect pin. Generated MDX and Markdown share the
same build snapshot. Edit the home page in `site/src/index.mdx`.

`scripts/deploy-docs.sh` checks every built install command and platform package
against a fresh registry snapshot before upload. Historical install commands
keep their versions, and each version must exist in npm’s version history.
Platform names in installation commands and tables are checked; a note about
a rehearsal package is not an installation claim. Run the check independently:

```sh
node docs/tools/published-site.mjs --check site/dist/public
bun test docs/tools/published-site.test.ts
```

The test uses `testdata/npm-0.0.10.json`; it never contacts npm.

## Evidence for changed specification rules

The independently selectable `//:spec-rule-evidence` target checks one entry's
complete diff. Platform selects it when wiring the gate; it is not a dependency
of the pre-gate targets. Pass the entry's immutable base and head commit IDs:

```sh
RULE_EVIDENCE_BASE=<base-commit> RULE_EVIDENCE_HEAD=<entry-commit> \
  .smithers/node_modules/.bin/smthrs test //:spec-rule-evidence --jobs 8
bun docs/tools/rule-evidence.ts --base <base-commit> --head <entry-commit> --json evidence.json
bun test --timeout 120000 docs/tools/rule-evidence.test.ts
```

The checker reads snapshots through `jj`, including deletions, and reports each
changed normative sentence in `docs/design/src/` and `docs/design/vips/`.
A sentence with inline code, an `EK` or `TS` diagnostic code, `must`,
`is an error`, `compiles` or `means` is normative. Code fences themselves
are examples, not prose rules. Generated pages, headings, unchanged sentences
moved or copied between chapters and VIPs, whitespace, emphasis, link destinations, citation-only
replacements, Effect version citations in otherwise unchanged prose and a
closed list of common prose typos are exempt. Deleted sentences need no new
evidence: they add no obligation. A note that an existing
diagnostic range keeps its specific triggers is also prose. Inline code
never receives typo correction. This lexical check cannot decide arbitrary
semantic equivalence or whether an assertion proves a rule; `rule-judge`
reviews those questions.

Each new or changed rule needs a new or changed executable compiler case in that
entry, a nearby pair of complete `vibe` and `ts effect` fences, or an explicit
pending test for an unimplemented rule (Will, 2026-11-03). A changed
case must contain a diagnostic or form named by the sentence; member names
such as `Users.Shape` also match `Local.Shape`, and grammar productions such
as `CatchExpression` match `catch`. Existing case comments that cite a VIP
also attribute the witness to that VIP; a chapter diagnostic shared with the
changed VIP uses the same attribution. A follow-up sentence with only a prose
label can use the preceding rule in the same section, within 40 lines. For prose with no code anchor, put an
explicit reference above the changed witness:

```text
// rule-evidence: docs/design/src/001-functions.md#effect-functions
```

The reference names the chapter and its heading slug (or just the file for a
rule before any heading). Comments alone, deleted cases and generated case
outputs do not count. Diagnostic `// expect:` changes are executable evidence.
A changed case manifest that updates its Effect dependency to the version named
by the pin rule exercises the supported-version branch.

An unchanged rule can inherit an existing test's evidence when its citation is
repointed. For a compiler case, quote the exact sentence after the chapter
reference, then update only that quote when rewording the spec:

```text
// rule-evidence: docs/design/src/001-functions.md#meaning | The `try` form must run.
```

The old citation must name a sentence replaced in the same chapter section;
the new citation must name the replacement. The case's executable source and
`// expect:` checks must remain identical and nonempty. In `docs/tools/*.test.ts`
or `docs/tools/*.test.mjs`, an existing `toContain` or `includes` quote assertion
can instead be repointed: it must run in a top-level `test` or `it` callback
imported from `bun:test` or `node:test`, name the chapter path, and keep the
rest of its source unchanged. Skipped tests, pending tests and fixture strings
do not qualify. These witnesses
are reported separately as `inherited`, rather than as new cases or pending
obligations. If either sentence names diagnostic codes, their sets must match.
A shared diagnostic code or keyword alone never exempts a changed trigger or
meaning. Repointing a citation asserts that the rule is unchanged; `rule-judge`
still reviews that assertion. New or changed behavior needs executable evidence
or an exact pending witness.

A twin pair stays in the rule's heading section, within 40 lines. Neither
block may be a fragment, pending, a compiler gap or an expected failure.
Both compile as separate strict modules using the snippet checker's dependency
isolation and the checkout compiler. Both must export a nonempty API and emit
byte-identical `main.d.ts`; two empty `export {}` modules prove nothing.
Alternatively, both blocks may put `// rule-evidence-exit: program` above an
exported Effect value named `program`. The checker compiles both modules,
runs `Effect.exit` on each value in one process and compares the actual Exit
objects with Node's `isDeepStrictEqual`. Both must export an Effect; a timeout,
failure to load or unequal Exit fails the comparison.
A missing twin, a compile failure or a declaration mismatch names the sentence
and the missing evidence. Diagnostic rules can use a failing compiler case.
A pending witness is a new top-level `test.todo` (or `it.todo`) call in a
`docs/tools/*.test.ts` or `*.test.mjs` file, with `test`/`it` imported from
`bun:test` or `node:test`. Its literal title names the exact chapter, heading
slug, short name, rule state and full rule sentence:

```ts
import { test } from "bun:test"
test.todo("rule-evidence: docs/design/src/001-functions.md#rules | explicit run | present | `try` must run.")
```

Use `removed` instead of `present` for a removed rule. The chapter, heading,
state and canonical sentence must all match; a chapter or heading alone
cannot cover another rule. A renamed or unchanged pending test, a comment,
a fixture string, a skipped suite or an uncalled function does not count.
Pending tests are reported separately from executable cases and compiled
twins, so passing this obligation check does not claim implementation coverage.

The checker exits `0` for an evidenced, explicitly pending or exempt entry,
`1` for missing evidence and `2` for a setup or revision error. The target requires full immutable commit IDs; both enter its cache key.
It is exclusive so ordinary wildcard CI can run without an entry diff.

## Specification coverage census

Run `bun docs/tools/coverage-census.ts`, or the Smithers target
`//:spec-coverage-census`, to inventory the rules in an immutable
`main@github` snapshot. Use `--revision <revision>` to pin another snapshot
and `--out <directory>` to change the output directory (default:
`~/vibe/review-spec/coverage`). The script writes `CENSUS.md`,
`CENSUS.csv`, `PERCENT` and `REVISION`. CSV starts with
`rule,test,missing` and includes chapter, line, sentence, confidence, evidence
kind and reason. A rule's ID is its source path and the first 16 hexadecimal
digits of the SHA-256 of its normalized sentence; line wrapping and insertions
above it preserve the ID.

The census reuses `rule-evidence.ts`'s normative sentence detector when that
module is present. Until gate-rule-evidence lands, `spec-normative.ts` carries
the same exported sentence and twin API extracted from `dd4ff590c915`; this
does not require that lane's commit as a parent. Accepted VIP selection shares
the spec linters' `vipRegistryFromSources` parser. Normative detection is
syntactic, and the counts describe discoverable source evidence rather than
execution results or a proof of semantic adequacy.

Exact normalized sentence quotes, `// rule-evidence: <stable-rule-id>`
citations (also stable IDs in pending marker text, skip messages or todo titles),
and comments naming a chapter or VIP plus a short rule name count
as evidence. For example, `// Chapter 1: effect function` links sentences or
sections containing `effect function`; a chapter alone links nothing. These
links are also counted separately as `tag-linked` so rewording a sentence
does not discard a surviving rule name.

The search reads compiler case inputs, Go tests under `typescript/tsc/internal`,
docs-tool tests, and package tests. Cases with a `pending` marker, Go tests
containing `t.Skip` or `t.Skipf`, and `test.todo` / `test.skip` declarations
are pending evidence. Passing evidence takes precedence over pending evidence;
a rule with neither is `none`. These are source classifications; the census
does not execute the linked suites. Go tests with conditional skips are
conservatively classified as pending. Shared diagnostics, literal forms and
uncompiled twin candidates remain low confidence and do not close gaps.
Expected output and corpus data are excluded.

Rows in `<output>/not-rules/*.csv` (a `rule` column with stable IDs) are
excluded from the census and denominator, with the matched exclusion count
reported separately. Use `--not-rules <directory>` to override that directory.
Duplicate exclusions count once; stale IDs do not increase the excluded count.
CSV adds `status` (`passing`, `pending`, `none`) and `test_status`.
`PERCENT` contains one line:
`passing A, pending B, no test C of N rules (excluded E)`.
Coverage includes passing and pending; the target for `no test` is zero.
Identical sentences repeated within one file count once; copies in different
files count separately.

Use `--compile-twins` to compile adjacent, complete `vibe` / `ts effect`
pairs with the shared gate checker. Both halves must compile and have identical,
nonempty declarations, or an explicit matching `rule-evidence-exit` witness
must produce identical Effect exits. Pending, fragmented and negative examples
do not count. Set `VIBELANG_BINARY` to a compiler built from the audited
revision and `RULE_EVIDENCE_TMPDIR` to a disk scratch directory. The cheap
default lists twin candidates without counting them.

`scripts/coverage-census-watch.sh` fetches and checks `main@github` every
15 minutes, rerunning the census when main changes (test-only changes can close
gaps too), and when collector code or exclusion CSVs change. It uses a singleton lock and stores its PID, last check, fetch/run
logs and history under `~/vibe/fix/alpha/coverage-census-scratch/watch`.
`CENSUS_OUT` and `CENSUS_STATE` override the destinations;
`CENSUS_ONCE=1` performs one check. Collection or matching failures preserve the prior published
inventory and retry on the next interval. `PERCENT` is published after both
inventory files. Each refresh executes the registered Smithers target with a pinned revision.
The target accepts `CENSUS_REVISION` and `CENSUS_OUT`; `CENSUS_SMTHRS`
overrides the watcher's CLI path. Stop the watcher using its recorded PID.

Run `bun test docs/tools/coverage-census.test.ts`, or
`//:spec-coverage-census-test`, for snapshot, evidence, CSV and stable-ID
regressions, including seeded mutation properties. No language tests are
generated by this tool.
