# The spec-review flow: run the specification's acceptance gate

The specification is accepted when four reviewers, Codex Astra, Codex Sol, Claude Fable and Claude Opus, each answer LGTM with a grade of A- or better on the same revision (`docs/design/vips/README.md`, Acceptance). The spec-review flow runs that gate on one revision and records each reviewer's verdict and grade. Individual VIP acceptance still requires Will’s approval.

```text
snapshot ──▶ ┌ astra ┐
             │ sol   │ ──▶ record
             │ fable │
             └ opus  ┘
```

The four reviews are a `Panel` from `@smthrs/patterns`: each reviewer answers alone, and the moderator, the record step, receives all four opinions.

| Step | What it does | Writes |
| --- | --- | --- |
| snapshot | Resolves the revision to one commit and exports `docs/design/src` and `docs/design/vips` as that commit has them. The working copy is never read | `snapshot.json`, `spec/` |
| review, once per reviewer | Gives the reviewer `prompt.md` in the exported specification's directory and reads its verdict, grade and graded revision from the answer | `reviewers/<name>/prompt.md`, `answer.md`, `opinion.json` |
| record | Applies the acceptance rule to the four opinions | `panel.json`, `panel.md`, and the record file |

## Run it

```sh
SPEC_REVIEW_AGENT_ASTRA="<command>" SPEC_REVIEW_AGENT_SOL="<command>" \
SPEC_REVIEW_AGENT_FABLE="<command>" SPEC_REVIEW_AGENT_OPUS="<command>" \
  bun .smithers/flows/spec-review/run.ts --run <dir> --revision <rev> \
    --record docs/design/vips/reviews/panels
```

`--revision` is any jj revision that names one commit. `--repo` names the jj repository and defaults to the current directory. The command exits 0 when the panel passed, 1 when it did not, and 2 when a step failed.

Each reviewer is a command that reads its prompt on standard input and prints its answer, such as a coding agent's non-interactive mode. It runs in the exported specification's directory. A reviewer whose variable is unset does not review, so the panel cannot pass.

## What passes

The record step passes the panel only when each of the four reviewers:

- answered `VERDICT: LGTM`;
- graded A+, A or A-;
- named the panel's commit in its `REVISION:` line, so all four graded the same revision.

A reviewer that failed, or whose answer does not carry exactly one `VERDICT:`, `GRADE:` and `REVISION:` line, has the verdict `none`. The command prints why each reviewer does not count, as `problems`. The record says only "did not answer" for a reviewer whose command failed, because a command's output can name hosts and paths.

## The record

`--record <dir>` writes `<dir>/<first 12 digits of the commit>.md`: each reviewer's verdict and grade, whether it counts, and the SHA-256 of its answer, with the commit, the SHA-256 of the exported specification and of the prompt. Panels of this repository's specification are recorded in `docs/design/vips/reviews/panels/`, and the acceptance statement in `docs/design/vips/README.md` links to the record of the panel it cites. The answers stay in the run directory; the record's digests identify them.

## Resume and replay

The run directory holds one revision. Running the flow again with the same run directory resumes it: a reviewer whose answer is saved for the same prompt is not asked again, and a reviewer with the verdict `none` is. A run directory with all four answers therefore replays the panel and rewrites its record without calling a model. A changed `prompt.md`, or a changed export, asks every reviewer again.

## Tests

`test/steps.test.mjs` runs the whole flow against jj repositories it creates, with reviewers supplied through the flow's `Reviewers` service, and runs the command line with a reviewer command that reads standard input.
