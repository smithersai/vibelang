// Both fix scopes write each legacy data receiver call as the resolved
// module's data-first call, through the prelude or an existing namespace
// import, leave native methods and namespace calls alone, and keep values.
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

// [legacy line, data-first line]
const rows = [
  ["export const mapped = Option.some(1).map(f)", "export const mapped = Option.map(Option.some(1), f)"],
  ["export const filtered = Option.some(3).filter((n: number) => n > 1)", "export const filtered = Option.filter(Option.some(3), (n: number) => n > 1)"],
  ["export const chained = o.map(f).map(f)", "export const chained = Option.map(Option.map(o, f), f)"],
  ["export const empty = Option.none<number>().map(f)", "export const empty = Option.map(Option.none<number>(), f)"],
  ["export const native = [1, 2].map(f)", "export const native = [1, 2].map(f)"],
  ["export const namespaced = Option.map(o, f)", "export const namespaced = Option.map(o, f)"],
]
const prefixes = {
  prelude: "",
  imported: 'import * as Option from "effect/Option"\n',
}
const observe = `const m = await import("./out/main.js")
const view = v => v && typeof v === "object" && "_tag" in v ? [v._tag, v.value] : v
console.log(JSON.stringify(Object.keys(m).sort().map(k => [k, view(m[k])])))
`
for (const [binding, prefix] of Object.entries(prefixes)) {
  for (const scope of [["--fix"], ["--fix", "--fix-migration-only"]]) {
    project(({ put, read, invoke, run }) => {
      const head = prefix + "const f = (n: number) => n + 1\nconst o = Option.some(1)\n"
      put("tsconfig.json", { compilerOptions: baseOptions(), files: ["main.vibe"] })
      put("main.vibe", head + rows.map(([legacy]) => legacy).join("\n") + "\n")
      put("observe.mjs", observe)
      const before = invoke("-p", ".", "--pretty", "false")
      assert.equal(before.status, 0, before.text)
      const values = run(process.execPath, ["observe.mjs"])
      assert.equal(values.status, 0, values.text)
      const fixed = invoke(...scope, "-p", ".", "--pretty", "false")
      assert.equal(fixed.status, 0, fixed.text)
      assert.match(fixed.text, /data-method namespace calls ×5/, binding + " " + scope.join(" "))
      assert.equal(read("main.vibe"), head + rows.map(([, repaired]) => repaired).join("\n") + "\n")
      const after = run(process.execPath, ["observe.mjs"])
      assert.equal(after.stdout, values.stdout)
    })
  }
}
console.log("legacy receiver calls become data-first module calls in both fix scopes")
