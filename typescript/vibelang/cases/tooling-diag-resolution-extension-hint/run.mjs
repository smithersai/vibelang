// "Module resolution is as in TypeScript, with .vibe and .vibex beside .ts
// and .tsx." Under NodeNext an extensionless relative ESM import of a .ts or
// .tsx module is TS2835, "Did you mean './user.js'?" (or './user.jsx' for
// .tsx under jsx preserve). The same import of user.vibe or user.vibex must
// print the same diagnostic, from a .vibe or a .ts importer.
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

const twin = name => name.replace(/\.vibex$/, ".tsx").replace(/\.vibe$/, ".ts")
const line = /^(\S+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/gm
const byFile = text => {
  const out = {}
  for (const m of text.matchAll(line)) (out[m[1]] ??= []).push(m[2] + "," + m[3] + " " + m[4] + " " + m[5])
  return out
}
const rows = [["user.vibe", "./user"], ["user.vibex", "./user"], ["sub/user.vibe", "./sub/user"], ["user.vibe", "./missing"]]
for (const jsx of ["preserve", "react-jsx"]) project(({ put, invoke, stock }) => {
  const compilerOptions = { ...baseOptions(), noEmit: true, jsx, jsxImportSource: "effect" }
  const importer = spec => `import { user } from "${spec}"\nexport const u: number = user\n`
  rows.forEach(([file, spec], i) => {
    put(`v/r${i}/${file}`, "export const user = 1\n")
    put(`v/r${i}/main.vibe`, importer(spec))
    put(`v/r${i}/native.ts`, importer(spec))
    put(`s/r${i}/${twin(file)}`, "export const user = 1\n")
    put(`s/r${i}/main.ts`, importer(spec))
  })
  put("v/tsconfig.json", { compilerOptions, files: rows.flatMap((_, i) => [`r${i}/main.vibe`, `r${i}/native.ts`]) })
  put("s/tsconfig.json", { compilerOptions, files: rows.map((_, i) => `r${i}/main.ts`) })
  const v = byFile(invoke("-p", "v", "--pretty", "false").text)
  const s = byFile(stock("-p", "s", "--pretty", "false").text)
  // The twin's diagnostics: TS2835 with the runtime name, TS2834 when there
  // is nothing to suggest.
  const ext = jsx === "preserve" ? ".jsx" : ".js"
  assert.match(s["s/r0/main.ts"][0], /^1,22 TS2835 .*Did you mean '\.\/user\.js'\?$/)
  assert.match(s["s/r1/main.ts"][0], new RegExp("^1,22 TS2835 .*Did you mean '\\./user\\" + ext + "'\\?$"))
  assert.match(s["s/r3/main.ts"][0], /^1,22 TS2834 /)
  rows.forEach(([file, spec], i) => {
    assert.deepEqual(v[`v/r${i}/main.vibe`], s[`s/r${i}/main.ts`], `${jsx} ${file} ${spec} from .vibe`)
    assert.deepEqual(v[`v/r${i}/native.ts`], s[`s/r${i}/main.ts`], `${jsx} ${file} ${spec} from .ts`)
  })
})
console.log("an extensionless import of a VibeLang module suggests its runtime name as the .ts twin does")
