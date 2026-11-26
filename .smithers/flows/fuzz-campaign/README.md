# fuzz-campaign

Durable Smithers flow built on `ScanFixVerify` (`@smthrs/patterns`) and `CommandSandbox` (`@smthrs/sandbox`) (`#471`).

## Usage

Run on the durable host from the repository root:

```sh
.smithers/node_modules/.bin/smthrs flow start fuzz-campaign --data '{
  "run": "/tmp/fuzz-run-1",
  "repo": "/Users/williamcory/vibelang",
  "findings": "/tmp/fuzz-findings",
  "machine": [],
  "duration": "5m",
  "targets": ["FuzzCompile"]
}'
```

## Stages

1. `prepare` — acquires a `CommandSandbox` session (`machine: []` locally, or `["ssh", "user@host"]` once `S.Remotes` ships in `@smthrs/*`) and prepares the checkout.
2. `campaign` (`ScanFixVerify`) —
   - `scan`: runs `campaign.sh` once inside the sandbox, pulls every crasher and target log back via `session.readFile`, and fails with log excerpts if the campaign broke before fuzzing.
   - `fix`: files one finding per failure key in `findings/index.json` + `<id>.md`, or records a duplicate in `findings/duplicates.json`.
   - `verify`: confirms every crasher has an on-disk finding or duplicate record before terminating with `resolved: true`.
