# Security policy

VibeLang is alpha software. The guarantees below are the ones the compiler and
runtime are designed to hold today; please report anything that breaks one of
them.

## Reporting a vulnerability

Report privately through GitHub's vulnerability reporting for this repository:

https://github.com/smithersai/vibelang/security/advisories/new

Do not open a public issue for a security problem. You will get an
acknowledgement within 5 business days and a status update at least every 14
days until the report is resolved. Coordinated disclosure is the default; we
will agree a publication date with you once a fix is available.

## Supported versions

Only the latest published `vibelang` release receives fixes. Pre-release
versions are supported until the next pre-release.

## What is in scope

The compiler and toolchain are designed to **fail closed**. A report is in
scope when authored `.vibe` code can make the compiler accept something the
specification says it must refuse, or make the runtime behave differently from
what the compiler checked. Concretely:

- **Typed failures and must-use Results.** A way to discard a `Result`, forge a
  `Result` value, or make a fallible call look infallible without a diagnostic.
- **Capability requirements.** A way to reach an ambient host facility
  (`process`, filesystem, network, clock, random, `eval`) from authored code
  without a `Context` capability being charged, or to erase a requirement row
  through a declaration, alias, or callback.
- **Foreign boundary trust.** A way to make an unannotated TypeScript or
  JavaScript call skip the `panic` channel, or to satisfy the `@module` /
  `@throws {never}` trust marker with untrusted code.
- **Comptime and asset loaders.** A comptime evaluation or loader that reads
  outside the declared project root, depends on ambient state, or produces
  different output for the same inputs.
- **Durable execution.** A journal replay that produces a different result than
  the original run without a divergence report, an execution that resumes under
  a changed Flow source identity, a forged or replayed signed deployment
  envelope being accepted, or a worker accepting an unauthenticated request.
- **Agent sandbox.** Generated code in the coding-agent sandbox reaching
  authority that is not in the passed-function table.
- **Supply chain.** A published package or the vendored TypeScript fork capsule
  whose contents do not match their recorded digests.

## What is out of scope

- `vibe run` executes the program with the host authority of your process. It is
  documented as **not a security sandbox**; reports that rely on that are not
  vulnerabilities.
- Denial of service through pathological inputs to the compiler, unless it
  crosses a documented resource ceiling silently.
- Vulnerabilities in dependencies that VibeLang does not ship or vendor. Report
  those upstream.

## Signing keys and trust roots

Deployment envelopes are signed with Ed25519 keys held by the deploying
operator. VibeLang does not operate a central key service; key custody,
rotation, and revocation are the operator's responsibility and are documented in
the durable execution specification. Report any way to bypass signature
verification as described above.
