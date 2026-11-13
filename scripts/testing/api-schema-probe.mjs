import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { parentPort } from "node:worker_threads"
import { compareApiIdentity, loadTypeScript } from "../api-identity.mjs"

const stock = loadTypeScript()
const dependencies = new Map()
const ts = {
  ...stock,
  createCompilerHost(...args) {
    const host = stock.createCompilerHost(...args),
      read = host.getSourceFile.bind(host)
    host.getSourceFile = (file, languageVersion, onError, fresh) => {
      if (fresh || !file.replaceAll("\\", "/").includes("/node_modules/"))
        return read(file, languageVersion, onError, fresh)
      const key = file + ":" + JSON.stringify(languageVersion)
      if (!dependencies.has(key)) dependencies.set(key, read(file, languageVersion, onError, false))
      return dependencies.get(key)
    }
    return host
  }
}

parentPort.on("message", ({ id, kind, before, after, entry, compilerOptions, moduleRoots, changedSource }) => {
  try {
    const validate = (entry) => {
      const options = { ...compilerOptions, noEmit: true }
      const program = ts.createProgram([entry], options, ts.createCompilerHost(options))
      assert.deepEqual(
        ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\\n")),
        [],
        "the authored declaration must be valid before comparison"
      )
    }
    const step = (stage, run) => {
      const started = performance.now()
      parentPort.postMessage({ id, stage, state: "started" })
      const value = run()
      parentPort.postMessage({ id, stage, state: "finished", elapsedMs: performance.now() - started })
      return value
    }
    step("validate-before", () => validate(join(before, "entry.d.ts")))
    let result = step("compare-identical", () => compareApiIdentity(ts, before, after, { compilerOptions, moduleRoots }))
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.equal(result.identical, true, JSON.stringify(result))
    writeFileSync(join(after, "entry.d.ts"), changedSource)
    step("validate-after", () => validate(join(after, "entry.d.ts")))
    result = step("compare-changed", () => compareApiIdentity(ts, before, after, { compilerOptions, moduleRoots }))
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.equal(result.identical, false, JSON.stringify(result))
    assert.ok(
      result.typeDifferences.some((d) => d.export === "Nullable"),
      JSON.stringify(result)
    )
    const value = true
    parentPort.postMessage({ id, value: JSON.parse(JSON.stringify(value)) })
  } catch (error) {
    parentPort.postMessage({ id, error: { name: error.name, message: error.message, stack: error.stack, code: error.code, operator: error.operator, actual: error.actual, expected: error.expected } })
  }
})
