# Migrate eval fixtures

`eval.ts` copies a fixture to a fresh jj repository and runs the migrate flow on it.

| Fixture | Source | Changes from the source |
| --- | --- | --- |
| `canonical/` | `@smthrs/canonical` 1.0.0-rc.16 (MIT): `src/` byte-identical to the npm tarball; 9 of its 16 test files from the Smithers repository's `packages/smithers/flows/canonical/test/` at that release | The manifest keeps the package's name, version, exports and Effect pins and drops its VibeLang, lint, build and coverage tooling; `vitest.config.ts` has no VibeLang plugin, which setup adds; the 7 test files left out read docs, examples or the package directory, or bundle with esbuild |

The fixture pins Effect 4.0.5, older than the runtime's pin, so upgrade-effect has work to do; its suite passes on 4.0.5 and 4.1.0 (329 tests, about 3 s). `scripts/effect-pin.mjs` exempts its manifest.

`@smthrs/keys` was the first candidate. Its dependency `@smthrs/crypto` 1.0.0-rc.16 imports `effect/Crypto`, which Effect 4.1.0 removed, so no run can upgrade it.
