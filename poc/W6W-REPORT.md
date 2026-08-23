# W6-W implementation report

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

## Decision

**FINISH.** The interrupted pool-bundle and `remote-http-poc` work now lands as
a coherent, fail-closed POC. No requested subsystem was left half-enabled.

The deliberate narrow bounds are explicit rather than accidental:

- emitted bundles accept only exact in-process compiler-issued implementation
  contracts whose checked source closure was retained by the compiler seam;
- bundle-executed implementations have no capability authority, so a nonempty
  requirement row fails the build;
- the HTTP transport is loopback-only local trust, and the worker host executes
  its already digest-pinned bundle with the Bun host process's ambient OS
  authority; use `DenoBundleWorker` when zero-permission process confinement is
  the property under test;
- the host's duplicate-exit table is bounded and process-local. A host restart
  forgets it; the coordinator SQLite store and fencing token remain the only
  durable exactly-once/adoption authority.

## Bundle format and determinism

Pool bundle format 1 is one UTF-8 ESM JavaScript file. It contains:

1. canonical JSON metadata for pool id, target, sandbox, sorted Action ids, and
   each Action's version, contract digest, implementation-contract digest,
   checked-export digest, entry module/export, and nominal Error mapping;
2. a fixed capability-free runtime subset in a deterministic CommonJS-shaped
   module table;
3. exactly the Plan-selected providers' complete retained checked source
   closures, lowered by the normal project compiler and ordered by Action id
   and logical module path; and
4. an exported Action table plus `__smithersInvokeAction(invocation)`, which resolves
   the requested `actionId` and returns the durable success/failure/defect
   discriminant.

The module loader rejects external imports and closure escapes. Runtime modules
and compiled Action modules receive bundle-local Error constructors, so runtime
Error conveniences do not mutate host `Error.prototype`; the bundled panic
runtime likewise does not mutate host `Reflect`. Capability entry points are
fail-closed stubs.

Determinism comes from canonical metadata, fixed runtime order, sorted Action
selection, sorted retained sources/module paths, comment-free ES2022/CommonJS
transpilation, no source maps, and a final newline-stable concatenation. The
bundle digest is lowercase SHA-256 over the exact emitted UTF-8 bytes. Tests
rebuild identical compiler inputs independently and assert byte equality,
digest equality, tree shaking of an unused provider, and recomputation by the
public validator.

Admission recomputes the digest. `DenoBundleWorker` checks the supplied bundle
envelope and signed manifest pin at construction and rechecks the exact source
immediately before every Deno composition. The worker host hashes the raw file
bytes, rejects invalid UTF-8, compares the digest with its independently
verified signed manifest, and only then imports the module.

## What the deployment signature covers

Before this slice, the pool artifact digest covered selected implementation and
policy identities, while the Ed25519 envelope signed the Plan and manifest. It
did **not** pin executable worker JavaScript; a checked-export digest was source
evidence and live host callbacks remained outside the signed artifact.

Now `Deployment.build({ pools: [{ bundle: true }] })` places the exact bundle
SHA-256 in `WorkerPoolManifest.bundleDigest`. That digest participates in the
pool `artifactDigest`, routes pin that artifact digest, the manifest digest
covers the pool, and Ed25519 signs the canonical Plan/manifest envelope.
Therefore the signature transitively covers the exact bundle bytes admitted by
the digest check. Replacing bundle bytes, replacing the manifest pin, or
recomputing every unkeyed digest without the signing key fails closed.

This is byte identity, not provenance attestation. It does not prove who built
the bundle, that the compiler/build host was uncompromised, or that an unpinned
runtime/container/VM executed it. Optional signed Deno placement identity is a
separate runtime pin.

## Remote transport protocol and trust boundary

`RemoteHttpWorker` implements `DurableWorker` for the exact
`remote-http-poc` sandbox. It accepts only `http://127.0.0.1:<port>`, disables
redirects, and is registered through
`trustWorkerTransport(REMOTE_HTTP_SANDBOX, remoteHttpWorkerFactory(...))`.
Missing, forged, duplicated, extraneous, or differently spelled transport
tokens are rejected by the authenticated coordinator before any factory or
network call, preserving no-silent-downgrade routing.

Protocol 1 uses two POST endpoints:

- `/smithers/worker/v1/handshake` advertises deployment, pool, target, sandbox,
  Plan digest, manifest digest, pool artifact digest, bundle digest, and sorted
  Action table. The coordinator re-handshakes for every invocation (coalescing
  concurrent calls only), so a process replacement on the same port cannot
  inherit an earlier host's bundle claim.
- `/smithers/worker/v1/invoke` carries exactly one full invocation envelope.
  Coordinator and host both run the shared manifest invocation gate before
  author code. Returned exits are canonicalized and checked against the signed
  route's success/error schemas; the coordinator independently repeats its
  exact WorkerExit validation before persistence.

Every request and response carries `x-smithers-worker-auth` with HMAC-SHA256
over a domain-separated role, timestamp, method, path, and body SHA-256 under a
32-64 byte per-deployment shared secret. Verification has a freshness window,
fixed-format parsing, and timing-safe MAC comparison.

The host binds each `(executionId,nodeId)` to the greatest accepted fencing
token and exact invocation digest. Lower tokens and conflicting envelopes are
rejected before dispatch. Identical concurrent requests join one promise;
later duplicates reuse one committed in-memory exit. If a higher token arrives
while an older attempt runs, the older result is converted to a stale-fence
defect. Regardless, only the coordinator store can durably commit a node or
cache value, and its existing owner/fence predicate rejects a stale remote exit
exactly as it rejects a stale local exit.

This authentication is a **LOCAL-TRUST seam, not production network auth**.
There is no TLS, no multi-machine transport, no principal identity, no secret
rotation/revocation, and no solved shared-secret distribution or custody.
Anyone holding the shared secret is fully trusted. An identical authenticated
message can be replayed inside the timestamp window; invocation idempotence
limits its effect. There is no container/VM or remote runtime attestation.

## Tests and crash boundaries

Required coverage landed:

- byte-identical bundle determinism and Action tree shaking;
- bundle/manifest digest mismatch rejection and Ed25519 tamper rejection;
- one zero-permission Deno bundle dispatching two distinct Actions;
- exact bundle typed-failure and timeout/defect behavior;
- missing, forged, and mismatched remote transport tokens rejected before
  network activity;
- authenticated handshake bundle mismatch rejected before invoke;
- real host request authentication, Action dispatch, stale/conflicting fence
  rejection, and duplicate committed-exit reuse;
- a stale remote success rejected by the coordinator store's ordinary fence;
  and
- a real CLI worker-host subprocess killed after dispatch, followed by a
  persisted retry at a higher fence against a replacement host, then a fresh
  coordinator/store connection adopting the completed run while no host is
  listening.

No new SQLite transaction or durable committed boundary was introduced, so the
existing `crash-matrix.test.ts` boundary list does not need another row. The
new worker-host in-memory commit is deliberately non-durable; its kill/retry
semantics are covered by the real subprocess test. All store read-then-write
transactions remain `BEGIN IMMEDIATE`, and every durable publication still
uses the pre-existing owner/fencing-token predicate.

Final verification on 2026-08-22:

- `cd poc && bun run check`: **pass**, zero TypeScript errors.
- `cd poc && bun test src/durable/`: **173 pass, 0 fail**, 1,203 assertions
  across 22 files in 52.07 seconds.

## Documentation deltas for the docs lane

`poc/src/durable/README.md` now documents bundle emission/admission, what the
signature covers, multi-Action Deno dispatch, the remote handshake/invoke
protocol, host fencing/idempotence, the real crash/retry test, and the honest
local-auth boundary. It explicitly states no TLS, no multi-machine support,
unsolved shared-secret custody, and that bundle digest pinning is not provenance
attestation.

The normative docs lane should carry forward these distinctions:

- specify executable artifact bytes/digest and runtime identity/provenance as
  separate identities;
- decide the production artifact-CAS/distribution format instead of treating
  this concatenated ESM POC format as normative;
- keep signed sandbox selection separate from host-issued transport trust;
- define production remote authentication, secret/key custody, rotation,
  replay protection, and multi-machine/TLS requirements independently of the
  local HMAC seam; and
- retain the rule that every remotely produced outcome is adopted run-locally
  through the coordinator's durable fencing transaction before exposure.

SOURCE SETTLED
