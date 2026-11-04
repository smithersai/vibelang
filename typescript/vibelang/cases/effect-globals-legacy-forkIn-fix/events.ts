import { Effect, Scope } from "effect"
export const events: string[] = ["loaded:" + typeof (Symbol as any).customMatcher]
/** @throws {never} */
export function markScope(scope: Scope.Closeable) { events.push("scope"); return scope }
/** @throws {never} */
export function markProgram<A,E,R>(program: Effect.Effect<A,E,R>) { events.push("program"); return program }
