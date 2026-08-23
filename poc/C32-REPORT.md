# C32 — Go native pin

> **Historical record.** This report describes work completed before the 2026-08-23 specification reduction. Some features it covers — the expression-form grammar, `defer`/`errdefer`, `Optional<T>`, `.unwrap()`, and the portable/native targets — are no longer part of the language. See `docs/DECISIONS.md`.

## Outcome

The Go fork now implements the checked `smithers:native` intrinsic. All five cases in
`conformance/corpus/21-native-pin/` produce observations identical to the JS reference, including
authored diagnostic positions and the complete dependency path. The paired runner reports
`176/176 identical observations` and zero divergences.

The five rows still appear as Go `XPASS`, so the Go summary remains `171/176 match the reference,
5 xpass`. That is only the protected corpus metadata: I did not edit the five `go xfail` markers.
Their raw Go observations now exactly equal the passing JS observations.

## Intrinsic and symbol-identity evidence

The registered authored specifier is exactly `smithers:native`. It resolves during checking to a
dedicated compiler-owned declaration file, `__smithers_native.d.ts`; recognition follows the
resolved function declaration back to that file. It never tests the use-site spelling `native`,
and the compiler-module registry uses exact resolved-module identities rather than a `smithers:`
prefix.

The declaration module is deliberately separate from the shared runtime prelude. After checking,
the existing AST import rewrite targets the prelude, whose runtime export is the identity function
`native(pinned) { return pinned }`. This prevents the intrinsic symbol from leaking through another
virtual module while preserving runtime identity without source-string surgery.

`TestPinnedForkNativePin` proves all four required identity properties:

| Case | Evidence |
| --- | --- |
| renamed import | `import { native as pin } ...; pin(checksum)` emits `SMITHERS3001` |
| namespace read | `import * as compiler ...; compiler.native(checksum)` emits `SMITHERS3001` |
| local shadow | a local generic function named `native` compiles and runs; it emits no pin diagnostic |
| lookalike package | a separately resolved package exporting the same-shaped `native` receives no pin authority |

## Complete graph and dependency paths

The pin pass reuses the existing checker-resolved row graph from lowering and host rules:

- direct nominal `Context` requirements;
- checker-resolved function call edges across files;
- provider callback edges, subtracting capabilities supplied by the layer;
- host-global and foreign-value provenance rules;
- exact resolved module classification, including `node:` host modules and type-only imports.

It computes a fixed point and retains one full path per reachable requirement. A pin is rejected
only for `TypeScript`, `Module<...>`, or `Host<...>`. Uncheckable assertions fail closed with
`SMITHERS3005`; retired `/** @native */` markers warn with `SMITHERS3006` and do not pin.

The transitive conformance case emits exactly:

```text
native pin failed: TypeScript is required through a-pin-reaching-typescript-transitively-is-rejected.sm#checksum -> a-pin-reaching-typescript-transitively-is-rejected.sm#first -> a-pin-reaching-typescript-transitively-is-rejected.sm#second -> a-pin-reaching-typescript-transitively-is-rejected.sm#third -> a-pin-reaching-typescript-transitively-is-rejected.sm#boundary
```

The host-module case resolves `node:fs` through a checker-only declaration shim and therefore lets
the existing host/foreign rules own the result: `SMITHERS1510` remains at the foreign import use,
and the pin emits `SMITHERS3001` with `Module<"node:fs">` and the `checksum -> hostBacked` path.

## Capability-only acceptance

Ordinary capabilities are retained in the same path table, including their dependency paths, but
are not members of the blocking set. Thus the `Digest` requirement reachable from `checksum`
remains represented as a capability path while the pin is accepted. The corpus case compiles and
runs with output `48010`; the focused regression test independently proves the same behavior.

## Verification

- `go build ./...` — pass
- `go vet ./compiler ./cmd/smithersc-go` — pass
- `go test ./compiler ./cmd/smithersc-go -count=1` — pass (`compiler` 210.083s, CLI 8.598s)
- top-level Go tests — 106 (the previous 105 plus `TestPinnedForkNativePin`)
- Go conformance — 171 pass-equivalent rows plus 5 native-pin XPASS; 0 xfail, 0 unsupported,
  0 divergent, 0 unmeasured
- paired conformance — JS 176/176; Go raw observations identical 176/176; backend agreement
  176/176; 0 divergences
- forkpatch status at `c087644e82dc3d48cf87e4c5519eeaaea9daf35c` — applied,
  `divergentFromApplied: 0`

SOURCE SETTLED
