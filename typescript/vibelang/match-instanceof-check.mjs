// RC-15 / effectscript-75: EK4839 repairs preserve the predicate's results.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export async function checkInstanceOfRepair(url, expected, repaired) {
  const dir = path.dirname(fileURLToPath(url))
  const root = path.resolve(dir, "../../../..")
  const compiler = path.join(root, "typescript/built/local/tsc")
  const native = path.join(root, "docs/tools/node_modules/typescript/bin/tsc")
  const source = readFileSync(path.join(dir, "main.vibe"), "utf8")
  const base = JSON.parse(readFileSync(path.join(dir, "tsconfig.json"), "utf8"))
  const { Effect } = await import(pathToFileURL(path.join(root, "experiments/node_modules/effect/dist/index.js")).href)
  const run = async (file) => {
    const value = (await import(pathToFileURL(file).href)).main()
    return Effect.isEffect(value) ? Effect.runSync(value) : value
  }
  const original = await run(path.join(dir, "out/main.js"))
  assert.deepEqual(original, expected, "original Vibe predicate")

  // Keep each phase's source, declarations and emit for before/after evidence.
  const evidence = path.join(dir, "out/instanceof-evidence")
  mkdirSync(evidence, { recursive: true })
  const compile = (name, ext, binary, args = []) => {
    const work = path.join(evidence, name)
    mkdirSync(work, { recursive: true })
    writeFileSync(path.join(work, "package.json"), '{"type":"module"}')
    writeFileSync(path.join(work, "main." + ext), source)
    writeFileSync(path.join(work, "tsconfig.json"), JSON.stringify({ ...base, include: ["main." + ext] }))
    execFileSync(binary === native ? process.execPath : binary, [...(binary === native ? [native] : []), "-p", work, ...args], { encoding: "utf8" })
    return work
  }
  const nativeDir = compile("native", "ts", native)
  const fixedDir = compile("fixed", "vibe", compiler, ["--fix"])
  const fixed = readFileSync(path.join(fixedDir, "main.vibe"), "utf8")
  assert.deepEqual(await run(path.join(nativeDir, "out/main.js")), original, "native TypeScript vs original")
  assert.deepEqual(await run(path.join(fixedDir, "out/main.js")), original, "CLI repair vs original")
  if (dir.endsWith("-array")) {
    const { runInNewContext } = await import("node:vm")
    const foreign = runInNewContext("[7]")
    for (const file of [path.join(dir, "out/main.js"), path.join(nativeDir, "out/main.js"), path.join(fixedDir, "out/main.js")]) {
      assert.equal((await import(pathToFileURL(file).href)).choose(foreign), "miss", "native instanceof rejects a foreign array")
    }
  }
  if (repaired) {
    assert.match(fixed, /when C:/, "ordinary class still has its repair")
    assert.doesNotMatch(fixed, /Match.instanceOf/)
  } else {
    assert.match(fixed, /Match.instanceOf/, "unproven constructor keeps advisory without repair")
    assert.doesNotMatch(fixed, /when (Number|String|Boolean|Array):/)
  }
  const declaration = readFileSync(path.join(dir, "out/main.d.ts"), "utf8")
  for (const work of [nativeDir, fixedDir]) {
    assert.equal(readFileSync(path.join(work, "out/main.d.ts"), "utf8"), declaration, "public declarations")
  }
  console.log("native, original and CLI repair agree")
}
