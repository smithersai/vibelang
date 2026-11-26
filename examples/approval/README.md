# Durable approval workflow

One `Release` workflow parks on durable staging and production approval waits
(`Experimental.Human.confirm`), then runs the `Deploy` task once both are
approved. `reviewRelease` spawns a run with `Experimental.Durable.spawn`,
reads each open approval from `Experimental.Durable.waiting`, and resumes the
workflow with `Experimental.Human.answer`.

From this directory, with `vibelang` on `PATH`:

```sh
bun install
bun run build
bun run start
```

Features: experimental `task` and `workflow` declarations (`vibe.experimental: ["builtins"]`),
VIP-56 durable human approval waits (`Experimental.Human.confirm` and
`Experimental.Human.answer`), and `Experimental.Durable.memory` / `waiting` / `spawn`.

The example runs two durable releases: `v1` approves both staging and
production and runs `Deploy`, while `v2` approves staging and declines
production.
