// run-seconds: 120
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
export function checkFileKind(caseUrl) {
  const dir = fileURLToPath(new URL(".", caseUrl))
  const require = createRequire(new URL("../../../experiments/package.json", import.meta.url))
  const stock = require.resolve("typescript/lib/tsc.js")
  const ts = require("typescript")
  const compiler = fileURLToPath(new URL("../../built/local/tsc", import.meta.url))
  function run(bin, args) {
    const r = spawnSync(bin, args, { cwd: dir, encoding: "utf8", timeout: 60000 })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    return r.stdout + r.stderr
  }
  run(process.execPath, [stock, "-p", "reference"])
  // Explicit CLI roots use the same file kind as tsconfig files/include.
  run(compiler, ["main.vibex", "ui.ts", "--noEmit", "--jsx", "preserve", "--strict",
    "--skipLibCheck", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler"])
  const config = JSON.parse(fs.readFileSync(path.join(dir,"tsconfig.json"),"utf8"))
  delete config.files
  config.include = ["*.vibex", "*.vibe", "ui.ts"]
  fs.writeFileSync(path.join(dir,"out/include.json"),JSON.stringify({
    ...config, include: ["../*.vibex", "../*.vibe", "../ui.ts"],
    compilerOptions: {...config.compilerOptions, rootDir:"..", noEmit:true}
  }))
  run(compiler, ["-p", "out/include.json"])
  function exportsOf(file) {
    const sf = ts.createSourceFile(file, fs.readFileSync(path.join(dir,file),"utf8"), ts.ScriptTarget.Latest, true)
    return sf.statements.flatMap(s => ts.isVariableStatement(s) ? s.declarationList.declarations.map(d=>d.name.getText(sf)) : s.name ? [s.name.getText(sf)] : []).sort()
  }
  assert.deepEqual(exportsOf("out/main.d.ts"), exportsOf("reference/out/main.d.ts"))
  const api = 'import * as actual from "../out/main.js"; import * as expected from "../reference/out/main.js"; const a: typeof actual = expected; const b: typeof expected = actual; export {a,b};'
  fs.writeFileSync(path.join(dir,"out/api.ts"),api)
  run(process.execPath,[stock,"--noEmit","--strict","--skipLibCheck","--target","es2022","--module","esnext","--moduleResolution","bundler","out/api.ts"])
  for (const jsx of ["preserve","react-jsx"]) {
    const out = "out/" + jsx
    run(compiler, ["-p", ".", "--jsx", jsx, "--outDir", out])
    const suffix = jsx === "preserve" ? ".jsx" : ".js"
    const emitted = fs.readFileSync(path.join(dir,out,"main"+suffix),"utf8")
    assert.ok(jsx === "preserve" ? emitted.includes("<") : emitted.includes("jsx-runtime"),emitted)
    assert.ok(fs.existsSync(path.join(dir,out,"main.d.ts")))
    const importer = fs.readFileSync(path.join(dir,out,"entry.js"),"utf8")
    assert.ok(importer.includes("./main"+suffix),importer)
  }
  console.log("foldkit file kind PASS")
}
