# VIP-32: Effect version compatibility (amended to `^4.1.0`)

**Status:** accepted by Will, 2026-10-29; amended 2026-11-27 for Effect `^4.1.0` range support.

## Decision

- During early alpha, VibeLang pinned exactly one Effect version (`4.1.1`) while core constructs routed through the experimental continuation kernel prototype and its `FiberImpl` internals.
- **Amended 2026-11-27: Effect `^4.1.0` semver range (tested baseline `4.1.6`).** Following the denial of VIP-35 (effect handlers, 2026-11-23), core VibeLang runtime constructs (`$catch`, `$catchExpression`, `$catchCause`, `uninterruptible`, `restore`, `$settle`/`$fast`) have been decoupled from private `FiberImpl` internals (`_stack`, `_interruptedCause`) and delegate to public Effect 4 APIs (`Effect.catch`, `Effect.catchCause`, `Effect.uninterruptibleMask`, `Effect.gen`, `Exit.isExit`).
  - Published `vibelang`, `vibelang-runtime`, and `vibelang-ts-mapper` packages declare `"effect": "^4.1.0"` (and optional platform peers `"^4.1.0"`) in `peerDependencies`.
  - The repository's tested Effect dev baseline is `4.1.6` (required by `@effect/ui` whose peer is `^4.1.4`).
  - Both the compiler (`EK3201`) and runtime load guard accept any stable `effect` and `@effect/platform-*` version `>=4.1.0 <5.0.0` (for example `4.1.0`, `4.1.1`, `4.1.4`, `4.1.6`, `4.2.0`), while continuing to reject `3.x`, `4.0.x`, `5.x`, and prereleases (such as `4.1.1-next.1` or `4.1.6-next.1`).
  - Because patch and minor versions within `^4.1.0` are accepted, user projects no longer need `@effect/platform-node-shared` overrides or resolutions to force an exact transitive patch match.
  - `@effect/ui`, `@effect/ui-kit`, `@effect/ui-devtools`, and `@effect/ui-opentui` version independently from Effect core and are exempt from the repository Effect core lock.
- **Migrations upgrade Effect first, on its own.** The migrate flow first upgrades the target repo to a supported Effect `^4.1.0` release (the tested baseline `4.1.6`), fixes what breaks, and lands that commit with green tests. Only then does it convert files to `.vibe`. Each breakage then shows its real cause: the Effect upgrade or the VibeLang conversion. This was recorded under Will's standing approval of recommendations.

### Earlier alpha history

- **2026-10-29:** During alpha, VibeLang pinned exactly one Effect version. The pin moved to each new Effect release to control variables while in alpha (not the long-term plan).
- **2026-10-30:** An unsupported Effect version is a project-level compile error (`EK3201`) in the CLI and editor, checked against the resolved `effect/package.json` (decided detail 70).
- **2026-11-03:** `4.1` became the earliest supported Effect version (Will: "Effect 4.1 has been released please update accordingly and make 4.1 the earliest version we support now"). The repository baseline moved from `4.1.1` to `4.1.6` on 2026-11-27 when the exact pin widened to `^4.1.0`.

## Evidence

The tooling audit (2026-10-28): all four migrations broke because adopting VibeLang forced an Effect upgrade at the same moment. Subsequent ecosystem adoption (including `@effect/ui`, which requires `effect@^4.1.4`, and transitive `@effect/platform-node-shared` patch updates) showed that exact patch pinning blocked compatible Effect 4.1.x upgrades once core runtime constructs no longer depended on `FiberImpl` internals.

## Will's words

> "To start we pin to a single version but we do this not because it's the long term plan but just to control variables while in alpha"
