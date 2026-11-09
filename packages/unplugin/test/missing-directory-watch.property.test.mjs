import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, watch, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { unplugin } from "../src/index.js"

// A failed build's host watcher observes files, without recursively following
// directories that did not exist when its watches were registered.
async function recovery(framework, segments, extension, command = "build") {
  const root = mkdtempSync(join(tmpdir(), "unplugin-missing-directory-"))
  const plugin = unplugin.raw({ root }, { framework })
  if (framework === "vite") plugin.vite.configResolved({ root, command })
  const watched = new Set(), observers = []
  let timer
  try {
    const source = join(root, "main.vibe"), project = join(root, "tsconfig.json")
    writeFileSync(source, 'import { value } from "./' + segments.join("/") + '"; export { value }')
    writeFileSync(project, '{"files":["main.vibe"]}')
    const backend = join(root, "node_modules/vibelang")
    mkdirSync(backend, { recursive: true })
    writeFileSync(join(backend, "package.json"), JSON.stringify({
      type: "module", exports: { "./project": "./project.mjs" }
    }))
    writeFileSync(join(backend, "project.mjs"), `
export const findCompiler = () => "unused"
export const formatDiagnostic = diagnostic => diagnostic.text
export function projects({ root, project }) {
  return {
    invalidate() {}, async close() {},
    async load(file) {
      return { project, code: "", map: null, inputs: [file],
        errors: [{ file, line: 1, column: 1, code: "TS2307",
          text: "Cannot find module './${segments.join("/")}' or its corresponding type declarations." }],
        warnings: [] }
    }
  }
}
`)
    const context = { meta: { watchMode: true }, addWatchFile(file) { watched.add(file) },
      error(error) { throw new Error(error.message) }, warn() {} }
    await plugin.buildStart.call(context)
    await assert.rejects(plugin.load.call(context, source), /Cannot find module/)
    await plugin.buildEnd(new Error("unresolved import"))
    if (command === "serve") {
      assert.ok(watched.has(root), "the server retains its existing parent directory watch")
      assert.ok([...watched].every(file => !relative(root, file).startsWith("..")),
        "a server load must not register a build-only notification file")
      return
    }
    const signal = new Promise((accept, reject) => {
      timer = setTimeout(() => reject(new Error(framework + ": no file notification for a new directory index")), 5000)
      for (const file of watched) {
        if (existsSync(file) && statSync(file).isFile())
          observers.push(watch(file, () => accept(file)))
      }
    })
    const target = join(root, ...segments, "index." + extension)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, 'export const value = "restored"')
    const changed = await signal
    assert.ok(watched.has(changed))
    assert.ok(readFileSync(changed, "utf8").length)
    await plugin.buildStart.call(context)
    await plugin.buildEnd()
  } finally {
    clearTimeout(timer)
    for (const observer of observers) observer.close()
    await plugin.closeWatcher()
    rmSync(root, { recursive: true, force: true })
  }
}

for (const framework of ["vite", "rolldown", "rollup"]) {
  test(framework + ": a missing directory index notifies a file-only host watcher", () =>
    recovery(framework, ["missing"], "vibe"))
  test(framework + ": generated nested missing-source paths notify the host watcher", async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.constantFrom("missing", "with space", "leaf-雪", "x+y"), { minLength: 1, maxLength: 4 }),
      fc.constantFrom("vibe", "ts", "tsx", "js"),
      (segments, extension) => recovery(framework, segments, extension)
    ), { seed: 391721, numRuns: 24 })
  })
}

test("Vite serve retains native directory watching without build notifications", () =>
  recovery("vite", ["missing"], "vibe", "serve"))
