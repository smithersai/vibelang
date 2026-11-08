// run-seconds: 120
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL("./", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const listing = (dir) => readdirSync(here + dir).filter((name) => name.startsWith("main.")).sort()

// The harness build: "jsx": "preserve".
const { result } = await import(new URL("./out/main.js", import.meta.url))
assert.deepEqual(result, [1, 2, 3, 4])
const vibe = listing("out")
const main = readFileSync(here + "out/main.js", "utf8")
for (const stem of ["main.vibe.-54-ext", "main.vibe.-dc-ber", "main.vibe.-24-x", "main.vibe.snake_case9"]) {
  for (const suffix of [".js", ".js.map", ".d.ts", ".d.ts.map"]) assert.ok(vibe.includes(stem + suffix), stem + suffix + " in " + vibe)
  assert.ok(main.includes(`"./${stem}.js"`), stem)
  assert.equal(JSON.parse(readFileSync(here + "out/" + stem + ".js.map", "utf8")).file, stem + ".js")
}

// The .vibex half: .jsx under preserve, .js with transformed JSX; declarations alike.
const vibex = {}
for (const jsx of ["preserve", "react"]) {
  const outDir = "out/matrix-" + jsx
  const r = spawnSync(compiler, ["-p", "tsconfig.json", "--jsx", jsx, "--outDir", outDir, "--pretty", "false"], { cwd: here, encoding: "utf8" })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const ext = jsx === "preserve" ? ".jsx" : ".js"
  const parent = readFileSync(here + outDir + "/app/main" + ext, "utf8")
  for (const stem of ["main.vibex.parse", "main.vibex.-dc-ber"]) assert.ok(parent.includes(`"./${stem}${ext}"`), stem + ext)
  vibex[jsx] = listing(outDir + "/app")
}
console.log(JSON.stringify({ vibe, vibex }, null, 1))
