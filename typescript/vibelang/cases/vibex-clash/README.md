# VIP-39 clash corpus

The numbered files cover all 39 rows of VIP-39's Clashes table. Native JSX rows have identical `.tsx` controls. `TestVibexClashParity` compares diagnostics (code, start, length) and complete node-kind/range outlines, then compares the controls with the checked-in `stock-diagnostics.json` receipt from TypeScript 5.9.3. Go tests need no Node install; `compile-parity.mjs` verifies the receipt against the live pinned parser before its CLI controls. VibeLang rows declare their grammar result and required node kinds with `// expect:`.

This is a parser corpus, so it has no project `tsconfig.json`. Semantic checks such as missing pipe topics, JSX component resolution, outward `do` completion and Solid's framework transform belong to their compiler and bundler cases.

Run from `typescript/tsc`:

```sh
go test ./internal/parser -run TestVibexClashParity -count=1
go test ./internal/vibelangfuzz -run 'TestVibexClashParityQuoted|FuzzVibexClashParity' -count=1
```

`FuzzVibexClashParity` uses stable row keys and mutates comments and line endings around the native controls.

Known gaps are recorded explicitly, not skipped: row 17's `TS1139` is VIP-39's documented VIP-3 boundary gap; row 33's `EK0204` is the current `do` lowering limitation documented in chapter 2. Their tests check those diagnostics and do not claim semantic conformance. Row 36 permits parser recovery; the compiler must reject it with `EK1101`, checked separately by `compile-parity.mjs`.

The deduplicated `panel.json` retains 445 panel and merged source witnesses with provenance keys. `TestVibexPanelCorpus` checks deterministic parsing; numbered rows and the stock compiler controls supply the grammar oracles.

After building the compiler, run `node typescript/vibelang/cases/vibex-clash/compile-parity.mjs` for full `.tsx` diagnostic parity and the trailing-block rejection.

Regenerate the stock parser receipt with `node typescript/vibelang/cases/vibex-clash/stock-parity.mjs --write` after installing `docs/tools`; review every changed diagnostic. The regular `compile-parity.mjs` run checks it without writing.
