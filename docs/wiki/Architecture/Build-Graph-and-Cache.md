---
title: Build Graph and Shared Object Store
tags: [architecture, build-graph, cache, object-store, security]
---

# 5,709-Target Build Graph and Shared Object Store

VibeLang uses `@smthrs/targets` and `@smthrs/cli` (`smthrs`) to turn the entire repository (Go compiler, 64 test shards, 4,027+ acceptance cases, 932+ fuzzers, 7 npm packages, docs checks, and site checks) into a single content-addressed build graph declared across `.smithers/WORKSPACE.ts` and `PACKAGE.ts`.

## Shared Smithers Cloud Object Store

`.smithers/WORKSPACE.ts` connects local and CI builds to the shared Smithers Cloud object store at `https://build.smithers.sh`:

```ts
cache: S.Cache({
  directory: ".flows",
  remote: S.RemoteCache.make({
    endpoint: "https://build.smithers.sh",
    read: S.Secret("SMITHERS_CACHE_READ_TOKEN"),
    write: S.Secret("SMITHERS_CACHE_WRITE_TOKEN")
  })
})
```

Every host tool binary (`go`, `gofmt`, `node`, `bun`, `jj`, `pnpm`, etc.) enters the cryptographic digest of every target that invokes it. Unchanged targets replay from `.flows/cache` or `https://build.smithers.sh` in milliseconds.

## Cache Trust Model (Zero Cache Poisoning)

```
  Untrusted Contributor / Fork PR               Trusted Maintainer / Main Sandbox
  ───────────────────────────────               ─────────────────────────────────
  Holds: SMITHERS_CACHE_READ_TOKEN              Holds: SMITHERS_CACHE_WRITE_TOKEN
         (or anonymous local-only)                     (main-only `cache-publish` env)
  Namespace: pr-<number>                        Namespace: trunk (bare key)
  GET /ac/<key>  -> 200 HIT / 404 MISS          GET /ac/<key>  -> 200 HIT / 404 MISS
  PUT /ac/<key>  -> 403 FORBIDDEN (server!)     PUT /ac/<key>  -> 201 PUBLISHED
```

Two layers protect the shared object store:

1. **Server-enforced authorization**: `https://build.smithers.sh` classifies every bearer token as `read` or `write` and rejects `PUT` and `DELETE` on read tokens with HTTP `403` before reading the request body.
2. **Environment isolation**: `SMITHERS_CACHE_WRITE_TOKEN` is stored exclusively inside the GitHub `cache-publish` deployment environment restricted strictly to branch `main`. Pull request workflows never receive write credentials and never use `pull_request_target`.

## Common Incremental Commands

- `smthrs info`: inspect workspace, 5,709 targets, and remote object store
- `smthrs ci //.smithers:factory-check`: verify `factory.json` and `home.json` match `.smithers/FACTORY.ts`
- `smthrs ci //:e2e`: build compiler, scaffold starter app, build, run, and test
- `smthrs ci //typescript/vibelang/...`: run affected compiler acceptance cases
- `smthrs ci //:docs-check`: verify generated docs, lint codes, release history, and leak guards

## Related Notes

- [[Smithers-Cloud-Setup]]
- [[Backpressure-and-Uphill]]
- [[Release-and-Security]]
- [[Overview]]
