# TC39 do expressions: the pinned snapshot

VIP-2 makes VibeLang's `do { … }` exactly the TC39 do-expressions proposal, pinned to this snapshot (decided detail 52, 2026-10-29). VibeLang moves to a newer snapshot deliberately, by replacing these files in a commit that says what changed, never automatically.

| Field | Value |
| --- | --- |
| Repository | `https://github.com/tc39/proposal-do-expressions` |
| Commit | `3ef6d463b8163cbf222846b40d17178cca36e9e1` ("fix bug with isLast"), the head of the default branch on 2026-10-28 (UTC) |
| Commit date | 2021-03-03 |
| Fetched | 2026-10-29 |
| Stage | 1 |
| License | MIT, in [`LICENSE`](LICENSE) |

| File | Upstream file |
| --- | --- |
| [`explainer.md`](explainer.md) | `README.md`, the explainer |
| [`spec.emu`](spec.emu) | `spec.emu`, the draft specification text |

VibeLang adds nothing to the proposal. Its one rule beyond it is the shared expression lowering for a `do` inside a larger expression, in [Running Effects](../../src/002-running.md#do-expressions).
