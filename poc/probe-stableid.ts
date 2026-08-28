import { compileActionContract } from "./src/durable/schema.ts"

const SOURCE = `
import { Action } from "smithers:flows"
class Boom extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Work extends Action<
  (input: { message: string }) => Result<{ done: string }, Boom>
> {}
`

const identityOf = (fileName: string): string => {
  const compiled = compileActionContract(SOURCE, { fileName, exportName: "Work", id: "probe", version: 1 })
  if (!compiled.ok) return `DIAGNOSTICS ${JSON.stringify(compiled.diagnostics.map((d) => d.code + " " + d.message))}`
  return JSON.stringify((compiled.descriptor.error as { identity?: string }).identity)
}

const seen = new Map<string, string[]>()
for (
  const fileName of [
    "a b.sm",
    "a_b.sm",
    "orders.sm",
    ".a.sm",
    "source_.a.sm",
    "a#b.sm",
    "a%b.sm",
    "a!b.sm",
    "x/y.sm",
    "xé.sm",
    `${"c".repeat(250)}.sm`,
    `${"d".repeat(250)}.sm`
  ]
) {
  const identity = identityOf(fileName)
  console.log(JSON.stringify(fileName).padEnd(30), "->", identity)
  seen.set(identity, [...(seen.get(identity) ?? []), fileName])
}
console.log("\n--- COLLISIONS ---")
for (const [identity, files] of seen) {
  if (files.length > 1) console.log(identity, "<-", JSON.stringify(files))
}
