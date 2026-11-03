# VIP-32: one pinned Effect version during alpha

**Status:** accepted by Will, 2026-10-29.

## Decision

- During alpha, VibeLang pins exactly one Effect version. The pin moves to each new Effect release (Will's 10-26 ruling).
- The pin controls variables while in alpha. It is **not** the long-term plan; supported version ranges get their own VIP after alpha.
- **Migrations upgrade Effect first, on its own.** The migrate flow first upgrades the target repo to VibeLang's pinned Effect, fixes what breaks, and lands that commit with green tests. Only then does it convert files to `.vibe`. Each breakage then shows its real cause: the Effect upgrade or the VibeLang conversion. This was recorded under Will's standing approval of recommendations.

- **Amended 2026-10-29: the pin is effect 4.1.0, and 4.1 is the earliest supported version** (Will: "Effect 4.1 has been released please update accordingly and make 4.1 the earliest version we support now").

- **Amended 2026-10-29: repos that already use VibeLang.** The published `vibelang-runtime` enforces its exact Effect pin, so the Effect upgrade lands together with the VibeLang release pinned to the new Effect, not before it (found by smithers-3a on Smithers). Recorded under Will's standing approval of recommendations.
- **Amended 2026-10-30: an off-pin Effect is a compile error.** VibeLang declares `effect` as an exact `peerDependency`, and the compiler reads the resolved `effect/package.json`: a version other than the pin is `EK3201` ("the resolved effect is X; VibeLang Y pins Z: upgrade both together"), in the editor and in CI. Decided by the agent on 2026-10-30 under Will's rule "when I state a principle, the agent derives the concrete rule and acts; I can override later" (decided detail 70).

## Evidence

The tooling audit (2026-10-28): all four migrations broke because adopting VibeLang forced an Effect upgrade at the same moment.

## Will's words

> "To start we pin to a single version but we do this not because it's the long term plan but just to control variables while in alpha"
