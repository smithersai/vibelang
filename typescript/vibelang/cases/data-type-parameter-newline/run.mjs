// run-seconds: 180
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("./out/repair/", import.meta.url))
mkdirSync(root, { recursive: true })
const binary = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const source = "const data = <T>(value:T)=>value;\ndata as\n<T>(value:T)=>T;\ndata satisfies /* keep\n*/ <T>(value:T)=>T;\nexport const result:number = data(7)\n"
writeFileSync(root + "/main.vibe", source)
writeFileSync(root + "/reference.ts", source)
writeFileSync(root + "/package.json", '{"type":"module"}')
writeFileSync(root + "/tsconfig.json", JSON.stringify({
  compilerOptions: { target:"ESNext", module:"NodeNext", strict:true, skipLibCheck:true, types:[], declaration:true, outDir:"out" },
  files:["main.vibe","reference.ts"]
}))
function compile(fix) {
  const result = spawnSync(binary, ["-p", root, "--pretty", "false", ...(fix ? ["--fix"] : [])], { encoding:"utf8", timeout:60000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
}
compile(true)
const fixed = readFileSync(root + "/main.vibe", "utf8")
assert.equal(fixed, "const data = <T>(value:T)=>value;\n(data as\n<T>(value:T)=>T);\n(data satisfies /* keep\n*/ <T>(value:T)=>T);\nexport const result:number = data(7)\n")
assert.equal(readFileSync(root + "/out/main.d.ts","utf8"), readFileSync(root + "/out/reference.d.ts","utf8"))
const actual = await import(new URL("./out/repair/out/main.js", import.meta.url))
const reference = await import(new URL("./out/repair/out/reference.js", import.meta.url))
assert.equal(actual.result, 7)
assert.equal(actual.result, reference.result)
compile(true)
assert.equal(readFileSync(root + "/main.vibe", "utf8"), fixed)
console.log("ok")
