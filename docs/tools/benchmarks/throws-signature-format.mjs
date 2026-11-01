import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../../", import.meta.url))

test("the inventory formats each real signature once and preserves the pinned artifact", { timeout: 120_000 }, () => {
  // An isolated Node process installs a counting proxy before the generator's
  // first TypeScript import. Every operation delegates to the real compiler.
  const child = spawnSync(process.versions.bun ? "node" : process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict"
    import { createRequire, registerHooks } from "node:module"
    import { readFileSync } from "node:fs"
    import { resolve } from "node:path"
    import { pathToFileURL } from "node:url"
    const require = createRequire(resolve("docs/tools/package.json"))
    const parserPath = require.resolve("typescript")
    const parser = require(parserPath)
    const signatures = new WeakSet(), checkers = new WeakSet()
    const stats = { calls: 0, distinct: 0 }
    globalThis.inventoryCompilerObserver = new Proxy(parser, {
      get(target, key, receiver) {
        if (key !== "createProgram") return Reflect.get(target, key, receiver)
        return (...args) => {
          const program = Reflect.apply(target.createProgram, target, args)
          const getChecker = program.getTypeChecker
          program.getTypeChecker = (...checkerArgs) => {
            const checker = Reflect.apply(getChecker, program, checkerArgs)
            if (!checkers.has(checker)) {
              checkers.add(checker)
              const format = checker.signatureToString
              checker.signatureToString = (signature, ...formatArgs) => {
                stats.calls++
                if (!signatures.has(signature)) { signatures.add(signature); stats.distinct++ }
                return Reflect.apply(format, checker, [signature, ...formatArgs])
              }
            }
            return checker
          }
          return program
        }
      }
    })
    const generatorURL = pathToFileURL(resolve("docs/tools/throws-inventory.mjs")).href
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === "typescript" && context.parentURL === generatorURL)
        return { url: "data:text/javascript,export default globalThis.inventoryCompilerObserver", shortCircuit: true }
      return next(specifier, context)
    } })
    const inventory = await import(generatorURL)
    const text = inventory.serializeInventory(inventory.generateThrowsInventory())
    assert.equal(text, readFileSync(resolve(inventory.artifactPath), "utf8"), "inventory bytes changed")
    console.log(JSON.stringify(stats))
    assert.ok(stats.distinct > 1000, "the real declaration surface was not visited")
    assert.equal(stats.calls, stats.distinct, "an unchanged signature was formatted again")
  `], { cwd: root, encoding: "utf8", timeout: 110_000, maxBuffer: 1024 * 1024 })
  assert.ifError(child.error)
  assert.equal(child.status, 0, child.stdout + child.stderr)
  console.log("signature formatter:", child.stdout.trim())
})
