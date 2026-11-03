# TC39 throw expressions: the pinned snapshot

VIP-41 adopts the grammar, precedence and parenthesis requirements of this snapshot exactly. Updates are deliberate commits, never automatic.

| Field | Value |
| --- | --- |
| Specification | `https://tc39.es/proposal-throw-expressions/` |
| Repository | `https://github.com/tc39/proposal-throw-expressions` |
| Commit | `78b887751db4e380870a0a6bfc47319c50aa1404` (`Update package.json`) |
| Commit date | 2024-01-19 |
| Fetched | 2026-11-02 |
| License | BSD 3-Clause, in [`LICENSE`](LICENSE) |

[`spec.emu`](spec.emu) is the unchanged upstream specification. [`explainer.md`](explainer.md) is the unchanged upstream `README.md`. The specification text governs if the explainer differs; for example, the specification includes `/=` in `ThrowExpressionInvalidPunctuator`. Its explicit list also governs the keyword operators `in` and `instanceof`, which the list omits despite the explainer’s broader prose about binary operators.

Where a throw is allowed at all is decided separately by VIP-4's 2026-10-31 no-throw ruling (`EK0401`). This snapshot does not authorize JavaScript exceptions in a plain VibeLang function, change Effect failure into a JavaScript exception, or grant a new parameter-initialization permission.
