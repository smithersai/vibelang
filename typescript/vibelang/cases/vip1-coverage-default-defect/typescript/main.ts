import { Effect, Exit } from "effect"
function f(): Effect.Effect<number> { try { const { a } = undefined as any; return Effect.succeed(a as number) } catch (e) { return Effect.die(e) } }
export function main(): Effect.Effect<string> {
  let program: Effect.Effect<number>
  try { program = f() } catch { return Effect.succeed("Throw") }
  return Effect.map(Effect.exit(program), ex => {
    if (Exit.isSuccess(ex)) return "Success"
    const reason = ex.cause.reasons[0]
    return reason._tag === "Die" && reason.defect instanceof TypeError ? "Die:TypeError" : "wrong"
  })
}
