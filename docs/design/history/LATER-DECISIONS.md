# Later decision references

The archived decision log ends at D520. These descriptions come from the later proposals that cite those decisions.

| Reference | Earlier rule as described by the proposal |
| --- | --- |
| D530, D556 | A manifest identified compiled exports whose failure contracts another VibeLang module could trust. See [VIP-36](../vips/0036-manifest-open.md). |
| D531 | The subject's static type selected a tag test or an `instanceof` test. See [VIP-7](../vips/0007-match.md). |
| D540 | `await` ran an Effect. See [VIP-5](../vips/0005-try-runs-effects.md). |
| D541 | An earlier function-form decision superseded by [VIP-1](../vips/0001-effect-and-async-functions.md). The proposal cites the number without describing it separately. |
| D550 | A function's kind was inferred from `await` in its body, and form rules made `throw` an Effect form. See [VIP-1](../vips/0001-effect-and-async-functions.md) and [VIP-4](../vips/0004-throw.md). |
| D551 | A function literal passed to an Effect parameter was converted. See [VIP-2](../vips/0002-effect-blocks-and-do.md). |
| D552 | The service member shorthand looked up the service before evaluating the arguments and ran the member's returned Effect by its declared type. See [VIP-10](../vips/0010-service-call-shorthand-denied.md). |
| D553 | The initializer's type distinguished Effect resource acquisition from a TypeScript disposable. See [VIP-8](../vips/0008-using-denied.md). |
| D557 | Tail resume was part of the handler design. See [VIP-35](../vips/0035-handlers-open.md). |
| D558 | An earlier correction aligned which branches run in an `or` pattern. See [VIP-7](../vips/0007-match.md). |

## VIP changes to archived decisions

| Archived decisions | Later ruling |
| --- | --- |
| D320–D323, D500: implicit Effect execution and function kinds | [VIP-1](../vips/0001-effect-and-async-functions.md) requires explicit `effect` functions, and [VIP-5](../vips/0005-try-runs-effects.md) uses `try` to run an Effect. |
| D148, D229–D232, D330, D396: boundary hatches | [VIP-4](../vips/0004-throw.md), [VIP-5](../vips/0005-try-runs-effects.md) and [VIP-6](../vips/0006-effect-globals.md) govern explicit calls and Effect wrappers. |
| D27: `wire` | [VIP-24](../vips/0024-wire-denied.md) denied `wire`. |
| D129, D221–D222: layer declarations and blocks | Use Effect's Layer constructors and [`provide` (VIP-12)](../vips/0012-provide.md). [VIP-11](../vips/0011-trailing-blocks-denied.md) denied trailing blocks, including those in D188 and D376. |
| D25, D342, D401, D481, D490: `using` regions | [VIP-8](../vips/0008-using-denied.md) denied special resource syntax. |
| D2, D16–D20, D50, D128, D132, D351: control handlers | [VIP-35](../vips/0035-handlers-open.md) denied control handlers on 2026-11-23. |
| D5, D22, D23, D249, D261, D389, D514: package trust | [VIP-4](../vips/0004-throw.md) defines callable throws contracts. [VIP-27](../vips/0027-declaration-output.md) governs declaration output. |
| D33, D219, D291, D372: automatic fixes | [The VIP index](../vips/README.md) records Will’s pre-release policy. [VIP-34](../vips/0034-compiler-and-tooling.md) governs tooling. |
| D135, D312, D387: automatic startup | [VIP-26](../vips/0026-top-level-and-main.md) requires an explicit runner. |
| D196, D377, D394: Effect await operations | [VIP-18](../vips/0018-concurrent.md) defines the concurrent `try` forms. |
