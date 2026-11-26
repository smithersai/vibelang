# site-deploy

Durable Smithers flow that replaces `site-autodeploy-v4.sh` and its retry/state files (`#476`).

## Usage

Run on the durable host from the repository root:

```sh
.smithers/node_modules/.bin/smthrs flow start site-deploy --data '{"state":".cache/site-deploy","dryRun":true}'
```

For production deploys, pass a `0600` credentials file with `CLOUDFLARE_API_TOKEN` on line 1 and `CLOUDFLARE_ACCOUNT_ID` on line 2 (read only by the `deploy` step and passed only to `scripts/deploy-docs.sh`):

```sh
.smithers/node_modules/.bin/smthrs flow start site-deploy \
  --data '{"state":"/home/lane/vibe/site-deploy","credentials":"/home/lane/.config/vibelang-site-deploy.credentials"}'
```

## Steps

1. `check` — resolves `main@github` and `npm view vibelang version`, compares against `<state>/deployed.json`.
2. `checkout` — updates or creates an isolated `jj` workspace at `<state>/ws` so schedule refreshes never mutate the deployed tree.
3. `regenerate` — runs `bun run docs:generate` inside `.smithers` of the isolated workspace.
4. `deploy` — loads credentials (when not `dryRun`) and runs `scripts/deploy-docs.sh` (or `--dry-run`). Any failure aborts before `record`, so the next scheduled run retries automatically.
5. `record` — atomically writes `<state>/deployed.json` on non-dry-run success.
