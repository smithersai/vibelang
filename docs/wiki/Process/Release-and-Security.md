---
title: Automated Releases, Docs Deploy, and Trust Boundaries
tags: [process, release, docs, security, trust]
---

# Automated Releases, Docs Deploy, and Trust Boundaries

VibeLang uses a two-branch stacked trunk model (`vibe` and `main`) wired so that every green landing from Smithers Cloud onto GitHub `main` triggers releases and documentation publishing automatically without sacrificing security.

## Merge to Release Pipeline

```
  Smithers Cloud (changes: "land", mirror: "push")
              │
              ▼  Maintainer lands green commit on `main`
  GitHub `main` push event (.github/workflows/release.yml)
              │
              ├── Version in identity.go != npm latest?
              │     ├── Build 6 native platform binaries (macOS, Linux, Windows arm64/x64)
              │     ├── Assemble 12 npm tarballs + VS Code VSIX (packed-hygiene verified)
              │     ├── Rehearse install against local registry (npm, Bun, pnpm, isolated)
              │     ├── Publish to npm with GitHub OIDC Sigstore provenance
              │     ├── Wait for npm CDN propagation (--prefer-online)
              │     ├── Deploy https://vibelang.sh (Cloudflare)
              │     ├── Verify live npm packages and live site
              │     ├── Record docs/tools/release-publication-snapshot.json
              │     └── Create GitHub Release v<version> & close Release issue
              │
              └── Docs/site/wiki changed without version bump?
                    └── Automatically redeploy https://vibelang.sh and verify live pages
```

## Untrusted Execution vs. Trusted Sandboxes

We actively encourage external contributors and non-maintainers to run tests, compiler cases, Uphill Lighthouse audits, and local workflows freely. Trust boundaries ensure honest experimentation is effortless while preventing cache poisoning or gate bypass:

| Boundary | Non-Maintainer / External PR | Maintainer / Controlled Sandbox (`main`) |
| --- | --- | --- |
| Code execution | Local machine or isolated untrusted PR job (`secrets: false`) | Controlled Smithers Cloud sandbox or `main`-only CI |
| Shared cache (`build.smithers.sh`) | Read-only hits (`SMITHERS_CACHE_READ_TOKEN`, HTTP `403` on PUT) + `pr-<n>` namespace | Read + trunk publish (`SMITHERS_CACHE_WRITE_TOKEN` in `main`-only `cache-publish` env) |
| Protected paths | Flagged by `pr-triage` and `factory.json` `protectedPaths` | Maintainer-reviewed only |
| Person-only acts | Refused (`403 person_only` on MCP and API) | Human maintainer in person (`roninjin10`) |

## Related Notes

- [[Build-Graph-and-Cache]]
- [[Smithers-Cloud-Setup]]
- [[Backpressure-and-Uphill]]
- [[Agent-Workflow-Guide]]
- [[Mythical-History]]
