# TC39 pipe operator: the pinned snapshot

VIP-23 makes VibeLang's `|>` exactly the TC39 Hack pipe operator, pinned to this snapshot (decided detail 52, 2026-10-29). VibeLang moves to a newer snapshot deliberately, by replacing these files in a commit that says what changed, never automatically.

| Field | Value |
| --- | --- |
| Repository | `https://github.com/tc39/proposal-pipeline-operator` |
| Commit | `5ac4dfd624e68b649e6f947885bf5ef67bac19f4` ("Merge pull request #301 from vendethiel/patch-1"), the head of the default branch on 2026-10-28 (UTC) |
| Commit date | 2023-11-30 |
| Fetched | 2026-10-29 |
| Stage | 2 |
| License | BSD-3-Clause, in [`LICENSE`](LICENSE) |

| File | Upstream file |
| --- | --- |
| [`explainer.md`](explainer.md) | `README.md`, the explainer |
| [`spec.html`](spec.html) | `spec.html`, the draft specification text |

The topic token is `%`, the explainer placeholder. The upstream `spec.html` stays unchanged. The effective grammar and operations use these reconciliations to preserve the accepted topic-bearing examples, sequential chains and ordinary TypeScript operators:

| Area | Effective behavior |
| --- | --- |
| Missing topic | The missing-topic early error checks `AssignmentExpression` with `ContainsOuterTopic`, not the wrapping `PipeBody`. `ContainsOuterTopic(PipeBody)` stays `false`, hiding a nested body from its outer topic check. |
| Grammar entry and chains | `PipeExpression` is an alternative of `ShortCircuitExpression`. A body whose whole unparenthesized expression is a `PipeExpression` is an early error, leaving unparenthesized chains left-associated. Parenthesized nesting remains valid, with separate topic scopes. |
| Input evaluation | Evaluation belongs to the declared `ShortCircuitExpression` input, which evaluates once and is read with `GetValue` before `EvaluateWithTopics`. The printed `ConditionalExpression` reference does not change precedence. |
| Topic read | `GetPrimaryTopicValue` reads `topicEnv.[[TopicValues]]`, the environment it just obtained; the printed `envRec` is out of scope. |
| Punctuators | Binary XOR `^` and XOR assignment `^=` retain their TypeScript meanings. The duplicated `%` in `OtherPunctuator` does not delete XOR; `%` remains modulo or the topic according to its syntactic position. |

The existing covering-production restrictions on unparenthesized conditional, yield, assignment and arrow bodies still apply. [Appendix A](../../src/900-appendices.md#pipeexpression) defines the effective productions; [Running Effects](../../src/002-running.md#the-pipe-operator) retains checked examples.
