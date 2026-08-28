# Pinned TypeScript fork architecture

Status: **Locked** for the minimal-diff pinned-fork strategy; **Direction** for
the exact repository, release, and update mechanics.

Smithers is built as one production compiler based on a pinned TypeScript fork.
The CLI, language server, formatter, bundler integration, and programmatic API
share that semantic core. Users do not select between competing Smithers
backends.

## Why a fork is required

Smithers needs integration points that a source transform cannot provide
soundly:

- `.sm` parsing and recovery, including the one adopted grammar addition;
- checker-owned failure and requirement rows across module boundaries;
- postfix `!` as Result propagation rather than non-null assertion;
- must-use Result and Promise-consumption analysis;
- resolved-identity recognition for compiler-owned modules;
- type-valued comptime results and generated module symbols;
- emission of a non-empty-effect-row function in the resumable calling
  convention, and derivation of a Flow's Effect Manifest from checked source;
- declaration metadata, source maps, language-service queries, and diagnostics;
  and
- atomic whole-project emission after all generated artifacts validate.

A per-file transform cannot own those semantics. It may deliver already defined
lowering into a bundler, but the forked compiler remains authoritative.

## Minimal-diff rule

Fork changes MUST be narrow, reviewable, and assigned to one of these seams:

| Seam | Smithers responsibility |
| --- | --- |
| source kind and parser | recognize `.sm`, reject retired syntax, and parse declarations in conditionals |
| binder and checker | nominal Result/Error behavior, failure rows, requirement rows, must-use rules, and intrinsic identity |
| flow analysis | Result propagation, Promise consumption, capability paths, and durable codec representability |
| comptime | deterministic evaluation, type production, tracked inputs, and generated modules |
| durable emission | emit the Flow body in the resumable calling convention and derive its Effect Manifest, without invoking the body |
| emitter | lower Smithers semantics, preserve module behavior, and emit declarations and source maps |
| language service | expose the same symbols, rows, diagnostics, navigation, and edits as the compiler |

Smithers MUST NOT copy large TypeScript subsystems into parallel packages or
maintain a second parser/checker as the product path. An upstreamable generic
hook is preferred when it can preserve the same semantics without weakening
the contract.

## Source pin and provenance

Every Smithers compiler release pins one immutable upstream TypeScript revision.
The repository vendors that revision at `vendor/typescript` as a squashed Git
subtree. The source distribution includes:

- the exact upstream revision;
- upstream license material;
- an ordered Smithers patch manifest;
- cryptographic digests of every patch and expected pre/post image;
- the selected Go or JavaScript dependency graph, as applicable; and
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

## One compiler pipeline

The target pipeline is:

```text
project resolution
  -> parse and bind
  -> TypeScript and Smithers checking
  -> asset/loading graph
  -> comptime evaluation and generated types/modules
  -> failure, requirement, and Promise-consumption analysis
  -> durable Flow body emission and Effect Manifest derivation
  -> Smithers semantic lowering
  -> generated-project validation
  -> declaration, JavaScript, source-map, and Effect Manifest emission
  -> atomic artifact commit
```

The durable stage emits code rather than a plan. A Flow body is compiled in the
resumable calling convention and must reach every artifact that can resume an
execution of it; the Effect Manifest published beside it is sets and tables —
reachable Action identities, requirement row, external-input contracts, failure
row, site table — and carries no control-flow edges, branch structure, or
execution counts. See
[Durable Execution](/specification/durable-execution) §Effect Manifest.

Later phases may request earlier information through explicit compiler APIs,
but they MUST NOT reparse source text heuristically or execute authored modules
to rediscover semantic facts.

The compiler keeps authored source positions through every lowering. Generated
text without an authored origin remains unmapped. Diagnostics and editor
navigation use checker symbol identity, not name-based approximations.

## `.sm` source identity

`.sm` is a first-class compiler source kind. Its module resolution, project
references, incremental invalidation, declaration emit, watch behavior, and
language-service participation follow TypeScript's project model with the
explicit Smithers differences in the specification.

Imported `.ts`, `.tsx`, and JavaScript-family files retain their native language
semantics. The Smithers checker attaches boundary facts when values cross from
those modules; it does not reinterpret their bodies as `.sm`.

## Toolchain integration

The same compiler package powers:

- `smithers check`, `compile`, `run`, `test`, `inspect`, `plan`, and `build`;
- the Smithers language server;
- the deterministic formatter and parser recovery used by editors;
- the unplugin bundler integration; and
- the programmatic project and build APIs.

Tooling may use different execution modes, but it cannot define a second
language. Formatting preserves semantics. Editor recovery cannot make a program
buildable. Transform-only bundler mode cannot approximate whole-program facts.

## Upstream health gate

For both the pristine pin and the fully applied Smithers patch series, the
update process runs:

- the complete selected upstream unit and integration suites;
- parser, checker, emitter, declaration, source-map, and language-service tests;
- the Smithers conformance corpus;
- clean and incremental project builds;
- patch apply/unapply and reproducibility checks; and
- package, license, and artifact inventory checks.

Any upstream regression introduced by the patch series blocks the pin update.
Passing upstream tests does not by itself establish Smithers conformance; the
two suites protect different contracts.

## Updating the pin

A pin update is a reviewed compiler migration, not a dependency-bot version
bump. It requires:

1. materializing and verifying the new pristine upstream revision;
2. replaying or rewriting every fork seam against that revision;
3. recording new pre/post images and patch digests;
4. reviewing upstream syntax, checker, emitter, module-resolution, and API
   changes for Smithers semantic impact;
5. running both upstream and Smithers health gates;
6. regenerating source provenance and license inventories; and
7. documenting any observable source, diagnostic, declaration, or artifact
   migration.

When upstream adopts a Smithers patch's generic capability, the Smithers patch
shrinks or disappears. Compatibility shims have an explicit removal condition.

## Release contract

Compiler releases include signed artifacts, source provenance, an SBOM, the
exact TypeScript pin, the Smithers patch manifest, and reproducible verification
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
