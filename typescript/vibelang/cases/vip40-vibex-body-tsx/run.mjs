import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
const out = new URL("./out/", import.meta.url)
assert.ok(existsSync(new URL("main.vibex.view.jsx", out)))
assert.ok(!existsSync(new URL("main.vibex.view.js", out)))
const compiler = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
for (const jsx of ["preserve", "react", "react-native"]) for (const rewrite of [false, true]) {
  const directory = "out/matrix/" + jsx + "-" + rewrite
  const result = spawnSync(compiler, ["-p", "tsconfig.json", "--jsx", jsx,
    "--rewriteRelativeImportExtensions", String(rewrite), "--outDir", directory,
    "--declaration", "true", "--sourceMap", "true", "--pretty", "false"], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const extension = jsx === "preserve" ? ".jsx" : ".js"
  const body = directory + "/main.vibex.view" + extension
  assert.ok(existsSync(body), body)
  const source = readFileSync(directory + "/main" + extension, "utf8")
  assert.ok(source.includes("./main.vibex.view" + extension), source)
  const declaration = readFileSync(directory + "/main.d.ts", "utf8")
  assert.ok(declaration.includes("./main.vibex.view" + extension), declaration)
  const map = JSON.parse(readFileSync(body + ".map", "utf8"))
  assert.ok(map.sources.some(source => source.endsWith("main.vibex")))
}
console.log("[true,false]")
