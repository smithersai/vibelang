import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
const root = process.cwd(), require = createRequire(join(root, "docs/tools/package.json")), ts = require("typescript")
const { lostWrappers } = await import(pathToFileURL(join(root, ".smithers/flows/migrate/lib/lost-wrapper.mjs")))
const { original, emitted, expectedFlag } = JSON.parse(readFileSync(0, "utf8"))
for (const text of [original, emitted]) {
  const source = ts.createSourceFile("input.ts", text, ts.ScriptTarget.Latest, true)
  if (source.parseDiagnostics.length) throw Error("invalid migration model syntax")
}
const checked = lostWrappers({ ts, original, emitted })
const flags = checked.flags.map(flag => flag.function)
const ok = expectedFlag ? flags.length === 1 && flags[0] === "/make" : flags.length === 0
console.log(JSON.stringify({ ok, expectedFlag, flags: checked.flags, paired: checked.paired, unpaired: checked.unpaired, emitted }))
