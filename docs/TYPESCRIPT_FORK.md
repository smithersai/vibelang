# Pinned TypeScript fork architecture

Status: **Locked** for the minimal-diff pinned-fork strategy; **Direction** for
the exact repository, release, and update mechanics.

VibeLang is built as one production compiler based on a pinned TypeScript fork.
The CLI, language server, formatter, bundler integration, and programmatic API
share that semantic core. Users do not select between competing VibeLang
backends.

The compiler implementation is Go, under upstream's `tsc/` module. The former
TypeScript 5.9 compiler-API implementation and its dependency are removed;
JavaScript/TypeScript runtime code and thin native-protocol clients are not
alternative compilers. The exact source pin is recorded in
`typescript-fork.json`; installed packages carry a digest-checked native
executable and do not require a Go toolchain or source checkout at run time.

## Native request transport

The synchronous SDK sends request JSON through a completed read-only file
descriptor inherited as the native process's stdin. The Go decoder and wire
protocol are unchanged. This avoids a reproduced macOS Node 22.12 synchronous
pipe stall after asynchronous subprocess execution; it does not raise the
supported Node version or add a JavaScript compiler fallback.

Request staging needs a writable host temporary directory. Each request gets an
exclusive private directory and a mode-`0600` file. On non-Windows hosts both
pathnames are removed before spawning, while the open descriptor remains
readable. Windows retains them until the child exits. Normal success, refusal,
timeout and spawn exceptions close the descriptor and remove any retained
pathnames. Abrupt host death during staging, or on Windows while the child runs,
can leave private temporary files; there is no automatic stale-file collector.
This is local transport storage, not a durable journal or compiler cache.

Metadata commands have closed stdin and do not stage a request. Compiler
deadlines, output limits, executable identity checks and strict response
validation still apply; a failed request is never silently retried. The host
transport digest covers this code as before.

## Why a fork is required

VibeLang needs integration points that a source transform cannot provide
soundly:

- `.vibe` parsing and recovery, including the one adopted grammar addition;
- checker-owned failure and requirement rows across module boundaries;
- postfix `!` as Result propagation rather than non-null assertion;
- must-use Result and Promise-consumption analysis;
- resolved-identity recognition for compiler-owned modules;
- type-valued comptime results and generated module symbols;
- emission of ordinary effectful functions in their checked calling convention,
  and static derivation of a durable Flow's complete Plan from checked source;
- declaration metadata, source maps, language-service queries, and diagnostics;
  and
- atomic whole-project emission after all generated artifacts validate.

A per-file transform cannot own those semantics. It may deliver already defined
lowering into a bundler, but the forked compiler remains authoritative.

## Minimal-diff rule

Fork changes MUST be narrow, reviewable, and assigned to one of these seams:

| Seam | VibeLang responsibility |
| --- | --- |
| source kind and parser | recognize `.vibe`, reject retired syntax, and parse declarations in conditionals |
| binder and checker | nominal Result/Error behavior, failure rows, requirement rows, must-use rules, and intrinsic identity |
| flow analysis | Result propagation, Promise consumption, capability paths, and durable codec representability |
| comptime | deterministic evaluation, type production, tracked inputs, and generated modules |
| durable emission | derive typed Plan nodes, computations, dependencies, control alternatives, codecs and identities from checked source, without invoking the Flow body |
| emitter | lower VibeLang semantics, preserve module behavior, and emit declarations and source maps |
| language service | expose the same symbols, rows, diagnostics, navigation, and edits as the compiler |

VibeLang MUST NOT copy large TypeScript subsystems into parallel packages or
maintain a second parser/checker as the product path. An upstreamable generic
hook is preferred when it can preserve the same semantics without weakening
the contract.

## Source pin and provenance

Every VibeLang compiler release pins one immutable upstream TypeScript revision.
The requested ledger strategy is a squashed Git subtree. The current offline
implementation at `vendor/typescript` is instead an explicit source capsule:
a complete-object Git bundle and a file-based proxy containing the exact Go
dependencies. `scripts/vendor-typescript.mjs verify` checks its complete payload
inventory, hashes and bundle revision; this is not presented as an actual subtree.
The source distribution includes:

- the exact upstream revision;
- upstream license material;
- an ordered VibeLang patch manifest;
- cryptographic digests of every patch and expected pre/post image;
- the exact Go dependency graph; and
- reproducible instructions for materializing the review tree.

Normal compiler builds MUST NOT fetch unpinned source implicitly. A network
fallback is explicit, verifies the revision and content, and produces the same
review tree as the offline source material.

## Patch discipline

Fork patches are an ordered series rather than undocumented edits to a vendored
tree. Tooling MUST:

1. verify the exact upstream revision and pristine pre-image;
2. verify patch identities and order;
3. refuse a dirty, partially applied, or divergent checkout;
4. apply or unapply transactionally;
5. verify the complete post-image; and
6. reproduce byte-identical results from independent clean materializations.

A source digest proves content identity, not publisher identity. Release
signatures and provenance attestations are separate requirements.

## Compiler preparation and cache ownership

Preparations sharing an output cache use a cancellable OS-held file lock. Process
termination releases ownership; the existence or age of `prepare.lock` does not
mean a builder is alive. The file stays in place after release so existing waiters
and new openers continue to coordinate on the same file. Do not delete a cache
or its lock file while it is in use.

The current `v2` cache layout is separate from the former directory-lock layout.
Upgrading does not delete or take over an older process's cache or stale lock.
It may require a cold build of the same pinned compiler. Releasing an already
released lock is harmless, and cancelling a waiter cannot release its owner.
Native lock support uses the standard library's OS bindings; unsupported hosts
fail explicitly instead of falling back to an unverifiable stale-lock timeout.

This coordinates compiler preparation, not durable execution or a distributed
lease. It does not repair arbitrary source changes: interruption during patch
application can leave a mixed checkout, which must still fail the patch-image
checks and be re-materialized. Interrupted temporary build directories are not
automatically garbage-collected.

## One compiler pipeline

The target pipeline is:

```text
project resolution
  -> parse and bind
  -> TypeScript and VibeLang checking
  -> asset/loading graph
  -> comptime evaluation and generated types/modules
  -> failure, requirement, and Promise-consumption analysis
  -> static durable Plan and contract derivation from checked source
  -> VibeLang semantic lowering
  -> generated-project validation
  -> declaration, JavaScript, source-map, and durable Plan/artifact emission
  -> atomic artifact commit
```

The September 6 owner decision replaces ordinary-body replay with static Plans.
The current durable target publishes the complete bounded graph, including
alternatives, dependencies, typed value connections and declared work identities.
The Go compiler never invokes a Flow or module initializer to discover that graph.
Unsupported source must refuse rather than fall back to body replay or a sets-only
Effect Manifest. Action implementations remain executable worker code; the source
Flow function is not needed to drive or resume the Plan. See the Durable Execution
specification (`docs/src/pages/specification/durable-execution.mdx`).

The implemented native `vibe plan` command publishes keyed Plans by default,
and authenticated workers execute the supported graph profile. Historical body
APIs and existing `compile`/`run` delivery still need their explicit migration;
production host packaging, bounded appended rounds and history administration
are unfinished. Passing the compiler/worker gates does not imply those runtime
obligations are delivered.

<!--
Deliberately NOT a Markdown link. `docs/TYPESCRIPT_FORK.md` is one of only two
Markdown files `package.json`'s `files` list ships, and `scripts/verify-pack.mjs`
requires every local link in a packaged Markdown file to resolve to another
SHIPPED path. The specification pages are not shipped, so a link to one is
either an absolute path (refused as unsafe) or a dangling relative path (refused
as unshipped) — and `verify:pack` is not in `npm test`, so the break only
surfaces at release. It surfaced here as a red `npm run gate:premerge` while
MIGRATION-PLAN.md §5 R2 was being closed.
-->


Later phases may request earlier information through explicit compiler APIs,
but they MUST NOT reparse source text heuristically or execute authored modules
to rediscover semantic facts.

The compiler keeps authored source positions through every lowering. Generated
text without an authored origin remains unmapped. Diagnostics and editor
navigation use checker symbol identity, not name-based approximations.

## `.vibe` source identity

`.vibe` is a first-class compiler source kind. Its module resolution, project
references, incremental invalidation, declaration emit, watch behavior, and
language-service participation follow TypeScript's project model with the
explicit VibeLang differences in the specification.

Imported `.ts`, `.tsx`, and JavaScript-family files retain their native language
semantics. The VibeLang checker attaches boundary facts when values cross from
those modules; it does not reinterpret their bodies as `.vibe`.

## Toolchain integration

The same compiler package powers:

- `vibe check`, `compile`, `run`, `test`, `inspect`, `plan`, and `build`;
- the VibeLang language server;
- the deterministic formatter and parser recovery used by editors;
- the unplugin bundler integration; and
- the programmatic project and build APIs.

Tooling may use different execution modes, but it cannot define a second
language. Formatting preserves semantics. Editor recovery cannot make a program
buildable. Transform-only bundler mode cannot approximate whole-program facts.

## Upstream health gate

For both the pristine pin and the fully applied VibeLang patch series, the
update process runs:

- the complete selected upstream unit and integration suites;
- parser, checker, emitter, declaration, source-map, and language-service tests;
- the VibeLang conformance corpus;
- clean and incremental project builds;
- patch apply/unapply and reproducibility checks; and
- package, license, and artifact inventory checks.

Any upstream regression introduced by the patch series blocks the pin update.
Passing upstream tests does not by itself establish VibeLang conformance; the
two suites protect different contracts.

## Updating the pin

A pin update is a reviewed compiler migration, not a dependency-bot version
bump. It requires:

1. materializing and verifying the new pristine upstream revision;
2. replaying or rewriting every fork seam against that revision;
3. recording new pre/post images and patch digests;
4. reviewing upstream syntax, checker, emitter, module-resolution, and API
   changes for VibeLang semantic impact;
5. running both upstream and VibeLang health gates;
6. regenerating source provenance and license inventories; and
7. documenting any observable source, diagnostic, declaration, or artifact
   migration.

When upstream adopts a VibeLang patch's generic capability, the VibeLang patch
shrinks or disappears. Compatibility shims have an explicit removal condition.

## Release contract

Compiler releases include signed artifacts, source provenance, an SBOM, the
exact TypeScript pin, the VibeLang patch manifest, and reproducible verification
instructions. The distribution verifies its own compiler/runtime ABI match and
fails closed on mixed versions.

Compiler process isolation, loader sandboxing, durable worker attestation, and
deployment signing are separate security boundaries. A signed compiler does not
automatically make code it compiles or workers it launches trustworthy.

## Open decisions

1. Whether release artifacts include the complete vendored tree or a verified
   pruned representation of the same source.
2. Supported platforms and whether the compiler ships as native binaries, a
   JavaScript package, or both.
3. Upstream pin cadence and support window for older pins.
4. Patch-series tooling and manifest schema.
5. Reproducible-build environment, signing system, SBOM format, and attestation
   publication.
6. Which generic fork seams should be proposed upstream.
