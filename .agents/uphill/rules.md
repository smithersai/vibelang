# Rules

Uphill writes these rules from each metric's `description`. Write code that meets them. `uphill` scores each metric against its target, and `uphill --compare HEAD --compact` lists what a change made worse.

## Footprint

Keep Go compiler packages modular, npm package sources lean, and the agent SKILL.md token budget tight.

- Keep each Go compiler package modular and cohesive; extract subsystems instead of growing monoliths. At most 2500.
- Keep individual Go compiler source files under 500 lines by splitting passes and helpers cleanly. At most 500.
- Keep each published npm package's source footprint lean and focused on its public contract. At most 40 kB.
- Keep `packages/compiler/skills/vibelang/SKILL.md` concise (target <= 18 kB) so agents spend fewer tokens per turn. At most 18 kB.
- Add compiler semantics acceptance cases under `typescript/vibelang/cases/` for every language rule.

## Style

Enforce gofmt, TigerStyle Go function lengths, and strict TypeScript typing across published packages.

- Format all Go code under `typescript/tsc/internal/vibelang*` with `gofmt`.
- Keep Go compiler functions at or under 70 lines (TigerStyle); decompose deep AST/typechecker branches into helpers. At most 70.
- Avoid explicit `any` in production TypeScript code under `packages/`; use typed schemas or `unknown`.
- Fix underlying TypeScript type mismatches instead of suppressing them with `@ts-ignore` or `@ts-expect-error`.

## Correctness

Enforce compiler/npm version lockstep, generated-file sync guards, and panic/TODO-free Go compiler code.

- Keep all `packages/*/package.json` versions aligned with `typescript/tsc/internal/vibelang/identity.go`.
- Keep generated artifacts, lint codes, release history, and case-collision/leak guards passing (`bun run docs:check` in `.smithers/`).
- Return structured diagnostics or errors instead of calling `panic()` in production Go compiler packages.
- Resolve or track TODO/FIXME items instead of leaving them in production Go compiler files.

## Testing

Track Go compiler unit/fuzz test depth and npm package test file coverage across the workspace.

- Maintain thorough Go unit tests across every `typescript/tsc/internal/vibelang*` package. At least 50.
- Expand Go fuzz targets in `typescript/tsc/internal/vibelangfuzz` as new syntax and lowering forms land. At least 250.
- Keep comprehensive unit and integration test suites in every published npm package under `packages/`. At least 10.

## Documentation

Measure exported Go symbol doc coverage and validate relative Markdown links across design and user docs.

- Document exported Go functions and types in `typescript/tsc/internal/vibelang*` with doc comments (target >= 80%). At least 80.
- Keep relative links in README.md, CONTRIBUTING.md, MAINTAINERS.md, AGENTS.md, and docs/ valid.

## Factory & Trust

Enforce Smithers Cloud factory projection parity, shared object store split-credential trust, and untrusted PR isolation.

- Keep .smithers/factory.json and .smithers/home.json projected cleanly from .smithers/FACTORY.ts.
- Enforce split read/write credentials on https://build.smithers.sh so untrusted runs can never poison trunk cache.
- Keep pull_request workflows isolated from SMITHERS_CACHE_WRITE_TOKEN and forbid pull_request_target.
- Declare explicit maintainers, protectedPaths trust roots, and two-way issue sync in .smithers/FACTORY.ts.
- Keep all Obsidian Wiki and Mythical History notes under docs/wiki/ valid with zero broken wikilinks.
