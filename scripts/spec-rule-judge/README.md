# Specification rule judge

Platform can run `smthrs //:spec-rule-judge` after the deterministic spec
linters. The root `PACKAGE.ts` declares the target; it does not enter the
pre-gate automatically. `//:spec-rule-judge-test` tests the collector, quote
validation, retry cache and fail-open behavior without a model.

The judge examines the entry's `docs/design/` changes and diagnostic-source
changes. Implementation-only changes cost no model call. Luna lists added
normative claims, quotes their accepted authority, and identifies contradictory
retained text. Luna selects stable evidence handles; the script copies each exact source line
into the final JSON. It verifies every quoted sentence against the addition
and every evidence quote against the named source.

Create an ignored `.cache/spec-rule-judge/config.json` in the checkout:

```json
{
  "revision": "@-",
  "base": "vibe@github",
  "decisions": "/configured/review-spec",
  "cache": "/configured/persistent/rule-judge-cache",
  "codexHome": "/configured/codex-home"
}
```

Use absolute configured paths. `decisions` contains `core-decisions.md`,
`decided-details.md` and `loop/WILL-ANSWERS.md`. If a decision file is
already tracked, its base-revision copy wins. These operational files are not
copied into the repository. VIPs and retained chapters are also read at the
base revision: an entry cannot approve itself by adding a VIP amendment.
For a short stack, `base` is its landing base, not merely its last parent.

CLI options `--revision`, `--base`, `--decisions`, `--cache`, `--repo`
and `--input` override configuration. Direct invocations can also set
`SPEC_RULE_JUDGE_REVISION`, `SPEC_RULE_JUDGE_BASE`,
`SPEC_RULE_JUDGE_DECISIONS` and `SPEC_RULE_JUDGE_CACHE`.
The target is an uncached `Shell.Run`; Smithers must not replay an answer
without collecting the current entry and external authorities.

Each cache receipt is `<cache>/<sha256>.json`. The key includes the resolved
revision, diff hash and versioned model prompt/output schema. The receipt records
the full authority/context hash and verdict integrity hash. The first authority
snapshot stays pinned for this entry even if external decisions later change;
retries log that context change and return the same verdict. One entry produces
one Luna call, including
concurrent invocations. An unavailable verdict is cached too; retries cannot
flip it. A changed revision, diff or judge policy gets a new identity. A process killed
while holding a lock leaves it in place: a later call waits up to the model
budget plus ten seconds, then warns and allows the entry without calling Luna
again. An operator must inspect a stale lock before removing it.

Luna runs as `codex exec -m gpt-6-luna` with closed stdin (equivalent to
`</dev/null`), an ephemeral session and a read-only sandbox. It gets ranked
excerpts and a temporary request containing all supplied sources. No raw model
transcripts are persisted. The private request, searchable evidence index and model answer are removed
after judgment; cache receipts retain the necessary evidence quotes, so keep
the cache private. Process output is drained, never echoed. A timeout kills the
model process group.

Each rule includes a claim, an exact added-line sentence and its source location.
The JSON receipt includes `status` (`judged`, `skipped` or
`unavailable`), `rules` and `contradictions` inside `verdict`, model
usage, latency, cache identity, `wouldReject` and `enforced`.
Usage and latency describe the first call; a cache hit reuses those fields and
spends no new model tokens. A cached verdict reuses its pinned evidence snapshot.
For an uncached entry, missing inputs, authentication, quota, transport, malformed JSON and
unverifiable quotes warn on stderr and allow the entry. Missing inputs do not
make a model call. An invalid cached receipt also fails open.

Rejection is enabled by default after a qualifying real Smithers eval with
zero false rejections across 22 known-good entries. A grounded unsupported
rule or contradiction writes `enforced: true` and exits `1`; authorized
changes exit `0`. Missing inputs or unavailable judgments exit `0` with
`enforced: false` and a warning. Failure to persist the result also fails open.
Use `--advisory` or configuration `"enforce": false` for an explicit
advisory run; the cached classification remains identical.
An unavailable eval sample is inconclusive, never a passing sample.

## Fixed historical eval

From the repository root, after installing `.smithers/`:

```sh
SPEC_RULE_JUDGE_DECISIONS=/configured/frozen-review-spec \
SPEC_RULE_JUDGE_CACHE=/configured/eval-cache \
.smithers/node_modules/.bin/smthrs eval run spec-rule-judge \
  --root "$PWD/.smithers" --run-id rule-judge-review \
  --output /configured/eval-run.json
node scripts/spec-rule-judge/score.mjs /configured/eval-run.json
```

The eval is discovered at `.smithers/evals/spec-rule-judge.eval.ts`. It uses
the actual collector and Luna, and checks each historical entry diff against its
original `jj diff --git` fixture (specification and diagnostic-message sources). The base-revision VIPs require repository history. Freeze
external decisions for a run so every case sees the same authority snapshot.
The corpus has seven bad witnesses and 22 known-good changes (16 commit messages cite a VIP); OPUS-3 and
three option-name witnesses deliberately share one introducing diff. Report
both witness counts and distinct revisions, so duplicates cannot inflate recall.
Focused option witnesses require the identifier in the judge's claim/reason,
not merely somewhere in the quoted paragraph. The artifact also records the
whole entry decision separately, so per-claim misses cannot hide behind another
bad claim in the same diff. Known-good commit messages record their VIP/detail rationale; they are labels,
not model input or authority.

Precision is `TP / (TP + FP)` for predicted bad entries; recall is
`TP / (TP + FN)`. Also report good-set acceptance, completed samples and
inconclusive samples. Never infer precision from good-set acceptance alone or
report an unavailable eval as perfect. The score script calculates these
numbers from Smithers' persisted run artifact and refuses qualification when
any sample is inconclusive, any good sample is rejected, or fewer than 15 good
revisions were measured.


The committed `calibration.json` records the qualifying run's policy,
implementation, corpus and baseline digests. Check those against the checkout
when changing the judge. Platform owns the pre-gate integration: run this
uncached target after deterministic linters with the entry revision and landing
base configured. Propagate exit `1` only for a fresh, revision-matched frame
with `enforced: true` and `wouldReject: true`. Treat infrastructure errors
and missing/stale/mismatched output as fail-open with a logged warning.

## Reading the target result

Smithers captures process stdout in its target logs. The script also writes the
same JSON atomically to `.cache/spec-rule-judge/result.json`. Configuration
`output` or CLI `--output` selects a different path. Each frame includes
`observedAt`; the cached verdict itself stays pinned. A consumer must check
that the frame is fresh for its invocation and that its `revision` is the
requested entry. Missing, stale or mismatched output is fail-open. Use isolated
workspaces or distinct output paths for concurrent entries.
