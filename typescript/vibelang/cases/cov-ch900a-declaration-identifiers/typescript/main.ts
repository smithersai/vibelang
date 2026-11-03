import { Effect, Schema } from "effect"
interface User { id: number }
class NotFound {}
const service = 2
const error: unknown = { note: "ordinary" }
const data: User[] = [{ id: 1 }]
const schema = Schema.String
const e = error as Error
const ok = schema satisfies Schema.Top
error instanceof NotFound
function users() { return data as User[] }
function caught() { try { return 2 } catch (error) { return error as number } }
export function main() { return Effect.gen(function* () {
  return [service, users()[0].id, ok === schema, e === error, error instanceof NotFound, caught()]
}) }
