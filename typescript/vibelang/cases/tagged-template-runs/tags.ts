import { Effect, Context } from "effect"
export const events: string[] = []
export const tag = (parts: TemplateStringsArray, ...values: unknown[]): Effect.Effect<string> =>
  Effect.sync(() => { const text = parts.join("|") + values.join(","); events.push(text); return text })
/** @throws {never} */
export const plain = (parts: TemplateStringsArray, ...values: unknown[]): string => {
  const text = parts.join("|") + values.join(","); events.push(text); return text
}
export class SqlClient extends Context.Service<SqlClient, typeof tag>()("test/SqlClient") {}
