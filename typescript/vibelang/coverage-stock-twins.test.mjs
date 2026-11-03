import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"
import test from "node:test"
import { checkStockTwin } from "./test/coverage-stock-twins.mjs"

test("stock reference detects a changed Exit or public type", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-stock-check-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, "out"))
  const exit = { _id: "Exit", _tag: "Success", value: [1, 2] }
  fs.writeFileSync(path.join(dir, "stock-exit.json"), JSON.stringify({ typescript: "5.9.3", effect: "4.1.0", exit }))
  fs.writeFileSync(path.join(dir, "stock-types.txt"), "// generated reference\nexport declare function main(): number[];\n")
  fs.writeFileSync(path.join(dir, "out/main.d.ts"), "export declare function main( ): number [ ];\n")
  const url = pathToFileURL(path.join(dir, "run.mjs"))
  checkStockTwin(url, exit)
  assert.throws(() => checkStockTwin(url, { ...exit, value: [1, 3] }), /Exit differs/)
  fs.writeFileSync(path.join(dir, "out/main.d.ts"), "export declare function main(): string[];\n")
  assert.throws(() => checkStockTwin(url, exit), /public types differ/)
})

test("stock generation rejects an Effect version drift before compiling", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-stock-pin-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  for (const [name, version] of [["typescript", "5.9.3"], ["effect", "4.1.1"]]) {
    fs.mkdirSync(path.join(dir, name))
    fs.writeFileSync(path.join(dir, name, "package.json"), JSON.stringify({ version }))
  }
  const result = spawnSync(process.execPath, [new URL("./test/coverage-stock-twins.mjs", import.meta.url).pathname, "--write"], {
    encoding: "utf8",
    env: { ...process.env, COVERAGE_REFERENCE_NODE_MODULES: dir },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /4\.1\.1/)
})
