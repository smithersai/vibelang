import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

test("documented forms command flags are supported by the command", () => {
  const read = (path: string) => readFileSync(resolve(import.meta.dir, "../..", path), "utf8")
  const source = read("typescript/tsc/cmd/vibelang-forms/main.go")
  const flags = new Set([...source.matchAll(/\bflag\.(?:String|Bool|Int|Duration|Uint)(?:Var)?\(\s*"([^"]+)"/g)].map(match => match[1]))
  expect(flags.size).toBeGreaterThan(0)
  flags.add("h")
  flags.add("help")
  const readme = read("docs/tools/README.md")
  for (const match of readme.matchAll(/`([^`]*\bvibelang-forms\b[^`]*)`/g)) {
    for (const flag of match[1].matchAll(/(?:^|\s)--?([a-z][a-z-]*)/g)) {
      expect({ command: match[1], flag: flag[1], supported: flags.has(flag[1]) }).toEqual({
        command: match[1], flag: flag[1], supported: true,
      })
    }
  }
})
