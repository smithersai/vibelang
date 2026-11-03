import { Effect } from "effect"
export async function adopted(flag: boolean) {
  const subject = await Promise.resolve(flag)
  if (subject === true) return Promise.resolve(3)
  return "other"
}
export async function nested() { return (() => { return 7 })() }
export function main(): Effect.Effect<readonly unknown[]> {
  return Effect.promise(async () => [await adopted(true), await adopted(false), await nested()])
}
