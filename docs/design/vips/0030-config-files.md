# VIP-30: config files: `vibe.config.json`, `tsconfig.json`, `jsconfig.json`

**Status:** accepted, 2026-10-29. Will asked for this VIP ("accepting tsconfig.json jsconfig.json and vibe.config.json with vibe config being a strict superset of a tsconfig"); the details are recorded under his standing approval of recommendations.

## Decision

```jsonc
// tsconfig.json or jsconfig.json
{ "compilerOptions": { "strict": true }, "vibe": { "effectGlobals": false } }

// vibe.config.json: a strict superset of tsconfig.json
{ "extends": "./tsconfig.base.json", "compilerOptions": { … }, "vibe": { … } }
```

- **Precedence.** In a directory, VibeLang reads the first that exists: `vibe.config.json`, then `tsconfig.json`, then `jsconfig.json`.
- **Superset.** Every tsconfig field is accepted in `vibe.config.json`, including `extends`, with the file-kind exception below. The added top-level section is `"vibe"`.
- **Amendment: source module classification.** `moduleDetection` keeps its ordinary meaning for `.ts` and `.js`. As a deliberate exception, every source `.vibe` file is an external module before binding and checking; none of its values enables shared script globals. Written imports and exports, required prelude imports and both prelude switches cannot change that classification. JavaScript output and declaration sidecars retain an effective module marker when needed. Ordinary TypeScript module emission and host rules, including incompatible-option diagnostics, still apply (VIP-26).
- **VibeLang's options live under a top-level `"vibe"` key.** Plain `tsc` rejects unknown `compilerOptions` (TS5023) but ignores unknown top-level keys, so the repo's own TypeScript tooling keeps working.
- The switches for VIP-6 (Effect function globals) and VIP-14 (Effect modules in scope) live there; their final names are settled during implementation.
- **Amended 2026-10-29: the option names.** The keys are `vibe.effectGlobals`, `vibe.effectModules` and `vibe.severities`. Errors can't be set to `"off"` (VIP-34). Sent to Will on Telegram 2026-10-29 11:28 under his standing rule 'assume I accept'; no objection by 12:00.
- **Amended 2026-10-29: the `severities` format.** `vibe.severities` maps a diagnostic's printed `EKxxxx` code to `"error"`, `"warning"`, `"suggestion"` or `"off"`. Only a warning's code may appear; an error's code or an unknown code is a config error. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 57).
- **Amended 2026-10-29: `extends` and the `vibe` section.** `extends` merges the `vibe` section key by key, as tsconfig merges `compilerOptions`: the child's keys win, missing keys come from the base, and `severities` merges entry by code. Decided by the agent on 2026-10-29 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 59).
- **Amended 2026-10-30: legacy configuration migration.** Both root `vibelang.diagnostics` and `compilerOptions.vibelang.diagnostics` are recognized in all three config files and their extended configs. Supported legacy settings (`"error"`, `"warning"` or `"off"`) keep applying until migrated. Missing legacy sections inherit; an explicit child legacy section replaces the whole inherited legacy section, including when empty or `null`. Modern severity entries still merge by code; an effective modern entry for the same diagnostic or its explicitly mapped port wins. Numeric code reuse does not map a legacy rule to a release error, and release-only codes are not accepted by the legacy validator. Each map reports warning `EK3009`; turning that warning off hides only the warning. `vibelang --fix` moves eligible maps to root `vibe.severities`, preserving JSONC comments, unrelated settings and modern entries. Maps containing obsolete or nonconfigurable codes remain until those entries are resolved. The complete rule and examples are in [Legacy severity maps](../src/007-tooling.md#legacy-severity-maps).

- **Amended 2026-10-30: recover invalid effective severity entries independently.** Merge `extends` entries by code before validating them. An invalid code or severity reports `EK3006` and is ignored as an override, while unrelated valid entries and options remain effective. An invalid child entry does not restore the displaced base entry for that code: lower-precedence Effect language-service configuration, where applicable, then the default applies. A non-object severity container remains `EK3007`; configuration errors keep their normal exit and emit consequences. See [Configuration](../src/007-tooling.md#config-files).
- **Amended 2026-11-02: declaration import spelling.** Root `vibelang.declarationImportStyle` is `".js"` (the default), `"extensionless"` or `".ts"`. It spells, in package declarations, a relative reference the source writes as `./x.vibe`: `./x.js`, `./x` and `./x.ts` respectively ([VIP-27](0027-declaration-output.md)). Source-adjacent sidecars and JavaScript output keep their own spelling, and every other written specifier stays as written. The key is the only path for the option: it lives in the legacy `vibelang` section, which a child config's own `vibelang` section replaces as a whole, and no `vibe` key or `compilerOptions` path spells it. Any other value is a configuration error. Recorded from decided detail 263 (C-prime, Will via proxy, 2026-10-31), which asks for this amendment.

## Prior art

ts-node's top-level `"ts-node"` key in tsconfig; `deno.json`; VS Code's `jsconfig.json`.

## Will's words

> "There should be a proposal towards end about accepting tsconfig.json jsconfig.json and vibe.config.json with vibe config being a strict superset of a tsconfig."

- **Amended 2026-11-01: interim severity codes.** Interim `EK92xx` codes are not configurable through `vibe.severities`, even when printed as warnings; an entry is `EK3006`. Historical legacy maps retain their existing behavior.

### Declaration-directory setting amendment (2026-11-01)

The top-level `vibe` object accepts `sidecarDir?: string` in every accepted config. An absent effective entry keeps compatibility declarations beside their sources. A relative value is based on the declaring config; a leading `${configDir}` uses the selected project's directory. A present child value, including an empty string naming the declaring directory, overrides inheritance. Wrong types use `EK3007`. The setting changes compatibility-sidecar location; native public `declarationDir` and `outDir` are independent. [VIP-27](0027-declaration-output.md) defines the mirrored layout and its matching `rootDirs`. This records decided details 268 and 271, without a new flag or disabling alias.

## Details

Decided details folded in verbatim on 2026-11-03 (mechanical pass). Each keeps its old number as history; where one conflicts with the text above, the fold's conflict pass resolves it.

### Detail 14

(VIP-30) The config keys are `vibe.effectGlobals`, `vibe.effectModules` and `vibe.severities`. Errors can't be set to `"off"` (VIP-34).

### Detail 57

(NW 20; VIP-30, VIP-34, decided detail 14) `vibe.severities` is `Record<EKxxxx, "error" | "warning" | "suggestion" | "off">`, keyed by the code the CLI and LSP print. The values are TypeScript's `DiagnosticCategory` names plus `"off"`. Only a warning's code may appear; an entry for an error's code, or an unknown code, is a config error.
    ```json
    { "vibe": { "severities": { "EK0508": "warning", "EK4609": "off" } } }
    ```
    Effect TS: none (compiler setting). Decided by the agent from principle 2 and VIP-34 (errors can't be disabled); 2026-10-29.

### Detail 59

(NW 27; VIP-30) `extends` merges the `vibe` section key by key, as tsconfig merges `compilerOptions`: the child's keys win, missing keys come from the base, and `severities` merges entry by code.
    ```json
    // base:  { "vibe": { "effectGlobals": false, "severities": { "EK0508": "off" } } }
    // child: { "extends": "./base.json", "vibe": { "effectModules": false } }
    // result: effectGlobals false, effectModules false, EK4701 off
    ```
    Effect TS: none. Decided by the agent from principle 2 (tsconfig `extends`); 2026-10-29.

### Detail 208

**Recover an invalid severity entry independently; keep the valid effective entries.** (live 007 ruling recorded by smithers-f2 at 2026-10-30 15:15Z; VIP-30, details 57/59/71/77.) An unknown diagnostic code, a VibeLang-owned error code, or an entry value outside `"error" | "warning" | "suggestion" | "off"` still reports the existing `EK3006` config error. Ignore that invalid effective entry as a severity override and continue applying every other valid entry and independent option; do not discard the whole `vibe.severities` map or `vibe` section. Preserve the imported-lint exception in detail 77 and the existing `EK3007` error for a non-object `severities` container. Recovery never makes configuration errors into warnings or changes their ordinary exit/emit consequences.
    Status: applied in dcb8ca2797b70e2240399945b6555d13337d6508 (spec-fix-d; complete compiler/docs replacement verified and queued, not a main receipt). Supersedes docs-only3f0771e47019 while retaining its publication and tests. New Go and native CLI before/after proofs cover invalid-child inheritance; no landing or whole-suite claim.
    ```vibe
    // vibe.severities: { "EK3801": "off", "EK4701": "off" }
    effect { succeed(1) } // valid EK3801 override applies; invalid EK4701 entry still gives config error EK3006
    ```
    First apply detail 59's base/child, entry-by-code precedence to determine the effective entries, then validate them independently. If a child explicitly supplies an invalid value for a code, it has displaced the base entry for that same code; ignoring the invalid effective override does not resurrect that overwritten base entry. The code then follows its existing lower precedence source (Effect language-service configuration, where applicable, then its default under detail 77). Unaffected inherited codes remain. This mirrors TypeScript's invalid child compiler option being unset while independent inherited options survive, rather than adding an invalid-value-specific inheritance exception.

    Effect TS: no runtime translation; TypeScript `5.9.3` parsing a child with invalid `strict: "bad"`, unknown `noSuchOption`, and valid `noEmit: true`, extending base `strict: true, target: "ES2022"`, reports TS5024/TS5023, retains `noEmit` and inherited `target`, and leaves `strict` undefined instead of restoring base `true`. Decided by the agent from principle 2 (TypeScript per-option configuration recovery), VIP-30/detail 59's already-approved TypeScript-style merge, and principle 4 (one effective-entry validation/precedence procedure), 2026-10-30, formalizing smithers-f2's recorded ruling. Existing severity validity, codes and warning-only exit rules remain as decided; no Will choice is involved. Document this in 007/VIP-30 and cover mixed valid/invalid maps, code/value errors, unrelated `vibe` options and an invalid child overriding the same base code. `root-config-recovery-reference.log` verifies the native TypeScript parse, diagnostics, retained options and the invalid-child boundary. It is a configuration-policy/reference check, not a VibeLang compiler-conformance claim; vibe-config owns source application and tests.

### Detail 306

**Compiler API construction preserves validated Vibe configuration.** (RC-API-1 `007:api-createProgram-drops-vibe-options`; accepted VIP-30/VIP-34, principles2/4.) Passing `parseConfigFile`'s returned `fileNames` and `options` to `createProgram` must preserve the effective program, including its already-validated internal `vibelang` options bag. JSON/CompilerOptions conversion must not discard the supported severity/module/global settings and restore defaults. Public config remains the existing top-level `vibe` object: no new key, flag, API method or language mode.

    ```vibe
    service Flags {
      static readonly default: Flags.Shape = { enabled: true };
      enabled: boolean
    }
    export type Value = typeof Flags.default;
    ```

    With `vibe.severities.EK4855 = "error"` and `compilerOptions.noEmitOnError = true`, a constructed API program retains the error and skips actual JavaScript/declaration emit, like its configured counterpart. Preserve each frontend's established presentation: honoring suggestions does not require CLI suggestion output.

    Effect TS: the ordinary TypeScript API counterpart passes the same parsed options to `ts.createProgram(config.fileNames, config.options)`, retaining their checking/emit meaning. The Node Vibe API's corresponding existing sequence is `const config = api.parseConfigFile(configPath); const program = api.createProgram(config.fileNames, config.options)`. Native `strictNullChecks`/`noEmitOnError` and Vibe's supported settings share this option-preservation rule.

    Use existing validation/representation and retain native option/path handling and project ownership. Do not bypass unknown-key/severity validation, permit disabling Vibe errors, discard foreign contracts or treat arbitrary unvalidated data as trusted settings. A visibly dropped field does not establish every possible semantic symptom: the reported globals-disabled `succeed` control remains nondiscriminating, not a second defect.

    Reviewer recovery131a has25 configured API and25 CLI controls on c26 agreeing, whereas25 synthetic-program checks lose15 nondefault overrides; fresh f8 reproduces those outcomes and actual emitted files. A separate `effectModules:false` case discriminates module selection; native strict-null controls remain correct. The raw-options Finalize filter also occurs in reconfiguration, but that path was not independently exercised. Test it and other callers before claiming all paths fixed. Initial Bun/private-fd and obsolete Node-flag setup failures are not compiler findings. These are attributed Node26 API/CLI receipts, not own execution or implementation.

    Chapter007/vibe-config and API/d-tooling owners retain failing-main regression and spec-quoted keyed/property coverage for parse/create/configured/reconfigure, category/suppression, real emit, globals/modules, invalid input, paths and native controls. Decided by the agent from principle2 (TypeScript API options retain their meaning), principle4 (one validated configuration meaning) and accepted VIP-30/VIP-34, 2026-11-02 under the 2026-10-29 delegation. Class A; no Will question, new diagnostic or public API change.

    Sources: `loop/scoped/rev-compiler/FINDINGS.md` recovery131a/`RC-API-1`; `api-matrix*.json`, `api-configured-matrix.json`, `api-options.json`, `api-emit.json`, real output files and native controls. Supplemental API1 is distinct from numbered RC1–40; reconciliation stays with the review owner.

    **306 reconfiguration evidence update, decide-live, 2026-11-02.** Recovery132a now independently exercises four snapshot reconfigurations on f8: requested error/off/suggestion settings revert to the default warning, while native `strictNullChecks` true/false correctly adds/removes `TS2322`. This supersedes the initial131a statement that reconfiguration had not yet been tested, for this specific path only. It corroborates the same validated-options rule and same RC-API-1, not a new decision or finding. Source: `recovery-1604/api-reconfigure.ts/json/log`. Other callers still need explicit coverage before claiming the implementation fixed all paths. These are attributed reviewer tests, not own API execution.

    **Fresh explicit-effects API impact (owner pass146a, 2026-11-02T19:23Z):** a matching successful `e4cbc61d9c43` build still reproduces15 wrong synthetic-program error/suggestion/off variants among25 service-warning cases; all25 configured-project API controls pass. The same options-loss defect now bypasses007's `EK4802` migration safeguard: at configured `error`, CLI exits1 and the configured API reports error with `emitSkipped=true`, while the synthetic API restores warning with `emitSkipped=false`. Suggestion/off controls likewise lose their effective severity; default/warning controls agree. This is the existing finalization/validated-options defect, not a new API schema, a new diagnostic, or an actual invocation of migration refusal by that probe. Preserve both effective configuration and actual process/emit outcomes under306/292. CLI/LSP lexical-entry and eager-service-value defects also remain independently reproduced under277. No successful collector exit establishes semantic equivalence. These are attributed fresh owner receipts, not tests or builds performed by this lane.
