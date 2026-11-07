import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import fc from "fast-check"
import { extensionlessImport, missingRelativeInputs } from "../src/relative-imports.js"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const diagnostic = (file, specifier) => ({
  code: "TS2307", file,
  text: `Cannot find module '${specifier}' or its corresponding type declarations.`
})

test("missing relative imports watch every source creation that can resolve them", async () => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-missing-imports-"))
  try {
    await checkProperty(fc, {
      name: "missing-relative-inputs",
      rule: "packages/unplugin/README.md: recompiles in watch mode; TypeScript relative source resolution",
      arbitrary: fc.record({
        name: fc.array(fc.constantFrom("a", "b", "é", "日", "-", "_", " "), { minLength: 1, maxLength: 12 }).map(chars => "module-" + chars.join("")),
        style: fc.constantFrom("explicit", "rewritten", "extensionless", "directory"),
        extension: fc.constantFrom(".vibe", ".ts", ".tsx")
      }),
      numRuns: 100,
      command: "node --test test/missing-imports.property.test.mjs",
      async check({ name, style, extension }) {
        const importer = join(root, "entry.vibe")
        const specifier = "./" + name + (style === "explicit" ? extension : style === "rewritten" ? ".js" : "")
        const target = style === "directory" ? join(root, name, "index" + extension) : join(root, name + extension)
        const inputs = missingRelativeInputs([diagnostic(importer, specifier)])
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, "export const value = 1\n")
        try {
          // Resolve after creation, independently of the missing-file watcher.
          const resolved = style === "explicit" || style === "rewritten" ? target : extensionlessImport(root, specifier)
          assert.equal(resolved, target)
          assert.ok(inputs.includes(resolved), `${specifier} must watch the source that now resolves it`)
        } finally {
          rmSync(style === "directory" ? join(root, name) : target, { recursive: true, force: true })
        }
      }
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("missing import watches use the importing file and ignore unrelated diagnostics", () => {
  const root = join(tmpdir(), "project")
  const importer = join(root, "nested", "entry.vibe")
  const error = diagnostic(importer, "../créé.vibe")
  assert.deepEqual(missingRelativeInputs([error, error]), [join(root, "créé.vibe")])
  assert.deepEqual(missingRelativeInputs([
    diagnostic(importer, "absent-package"),
    { ...error, code: "TS2322" },
    { ...error, file: undefined }
  ]), [])
  assert.ok(missingRelativeInputs([diagnostic(importer, "./view.vibex")]).includes(join(root, "nested/view.vibex")))
  assert.deepEqual(missingRelativeInputs([{
    file: importer, code: "TS6263",
    text: "Module './missing.vibe' was resolved to 'missing.d.vibe.ts', but '--allowArbitraryExtensions' is not set."
  }]), [join(root, "nested/missing.vibe")])
})

test("Rollup keeps source and type-only watches after missing-import recovery", async () => {
  const { mkdir, mkdtemp, rename, rm, symlink, writeFile } = await import("node:fs/promises")
  const { spawnSync } = await import("node:child_process")
  const { fileURLToPath } = await import("node:url")
  const { watch } = await import("rollup")
  const plugin = (await import("../src/rollup.js")).default
  const repo = fileURLToPath(new URL("../../../", import.meta.url))
  const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
  let history
  async function check({ name, rootSources, value, polling = false }) {
    const parent = join(repo, "packages/unplugin/test/.fixtures")
    await mkdir(parent, { recursive: true })
    const root = await mkdtemp(join(parent, "rollup-recovery-"))
    const source = rootSources ? root : join(root, "src")
    await mkdir(source, { recursive: true })
    await mkdir(join(root, "node_modules"))
    await symlink(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
    await symlink(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"))
    await writeFile(join(root, "package.json"), '{"type":"module"}')
    const config = JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], rewriteRelativeImportExtensions: true },
      include: [rootSources ? "*.vibe" : "src", ...(rootSources ? ["*.ts"] : [])]
    })
    const project = join(root, "tsconfig.json"), main = join(source, "main.vibe"), types = join(source, name + ".ts")
    await writeFile(project, config)
    await writeFile(main, "export const value = 1\n")
    const entry = join(source, "entry.mjs"), output = join(root, "out/main.mjs")
    await writeFile(entry, 'import {value} from "./main.vibe"; console.log(value)\n')
    history = []
    const events = []
    const watcher = watch({
      input: entry, plugins: [plugin({ root, compiler })],
      output: { file: output, format: "es", sourcemap: true },
      watch: { chokidar: { usePolling: polling, interval: 20 }, buildDelay: 50 }
    })
    watcher.on("event", async event => {
      try {
        if (event.code === "BUNDLE_END") {
          await event.result.close()
          events.push({ ok: true })
          history.push("build succeeded")
        } else if (event.code === "ERROR") {
          await event.result?.close()
          events.push({ ok: false, message: event.error.message })
          history.push("build failed: " + event.error.message)
        }
      } catch (error) {
        events.push({ ok: false, message: error.message })
      }
    })
    const prints = expected => {
      const run = spawnSync(process.execPath, [output], { encoding: "utf8" })
      return run.status === 0 && run.stdout.trim() === String(expected)
    }
    async function until(from, predicate, stage) {
      const deadline = Date.now() + 10000
      while (Date.now() < deadline) {
        if (events.slice(from).some(predicate)) return
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      assert.fail(stage + ": no rebuild\n" + history.join("\n"))
    }
    async function edit(stage, write, predicate) {
      await new Promise(resolve => setTimeout(resolve, 300))
      const from = events.length
      history.push(stage)
      await write()
      await until(from, predicate, stage)
    }
    const valid = expected => event => event.ok && prints(expected)
    const invalid = code => event => !event.ok && event.message.includes(code)
    try {
      await until(0, valid(1), "initial build")
      await edit("missing import", () => writeFile(main, 'import {value as imported} from "./missing.vibe"; export const value = imported\n'), invalid("TS2307"))
      await edit("create missing source", () => writeFile(join(source, "missing.vibe"), "export const value = 42\n"), valid(42))
      await edit("source type error", () => writeFile(main, 'export const value: number = "bad"\n'), invalid("TS2322"))
      await edit("source recovery", () => writeFile(main, "export const value = 2\n"), valid(2))
      await edit("add type-only import", async () => {
        await writeFile(types, "export type Label = number\n")
        await writeFile(main, `import type {Label} from ${JSON.stringify("./" + name + ".ts")}; export const value: Label = ${value}\n`)
      }, valid(value))
      await edit("type-only error", () => writeFile(types, "export type Label = string\n"), invalid("TS2322"))
      await edit("type-only recovery", () => writeFile(types, "export type Label = number\n"), valid(value))
      await edit("later source edit", () => writeFile(main, `export const value = ${value + 1}\n`), valid(value + 1))
      const replaceConfig = async text => {
        await writeFile(project + ".next", text)
        await rename(project + ".next", project)
      }
      const brokenConfig = JSON.parse(config)
      brokenConfig.compilerOptions.types = ["missing-types"]
      await edit("configuration error", () => replaceConfig(JSON.stringify(brokenConfig)), invalid("TS2688"))
      await edit("configuration recovery", () => replaceConfig(config), valid(value + 1))
    } finally {
      await watcher.close()
      await rm(root, { recursive: true, force: true })
    }
  }
  await check({ name: "types", rootSources: false, value: 41 })
  await check({ name: "types", rootSources: true, value: 43, polling: true })
  await checkProperty(fc, {
    name: "rollup-watch-after-recovery",
    rule: "packages/unplugin/README.md: recompiles in watch mode; source and type-only edits remain active after error recovery",
    arbitrary: fc.record({
      name: fc.array(fc.constantFrom("a", "b", "é", "日", "-", "_", " "), { minLength: 1, maxLength: 8 }).map(chars => "types-" + chars.join("")),
      rootSources: fc.boolean(), polling: fc.boolean(), value: fc.integer({ min: 3, max: 100 })
    }),
    numRuns: 5, check,
    command: "node --test test/missing-imports.property.test.mjs",
    diagnostics: () => history.join("\n")
  })
})

test("Rollup preceding transforms still receive compiled JavaScript", async () => {
  const { mkdir, mkdtemp, rm, symlink, writeFile } = await import("node:fs/promises")
  const { spawnSync } = await import("node:child_process")
  const { fileURLToPath } = await import("node:url")
  const { rollup } = await import("rollup")
  const plugin = (await import("../src/rollup.js")).default
  const repo = fileURLToPath(new URL("../../../", import.meta.url))
  const parent = join(repo, "packages/unplugin/test/.fixtures")
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, "rollup-transform-order-"))
  let bundle, repeated
  try {
    await mkdir(join(root, "node_modules"))
    await symlink(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
    await symlink(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"))
    await writeFile(join(root, "package.json"), '{"type":"module"}')
    await writeFile(join(root, "tsconfig.json"), '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","types":[],"skipLibCheck":true},"include":["*.vibe"]}')
    const source = join(root, "main.vibe"), output = join(root, "out/main.mjs")
    await writeFile(source, "export const answer: number = 41\n")
    await writeFile(join(root, "entry.mjs"), 'import {answer} from "./main.vibe"; console.log(answer)\n')
    let seen
    bundle = await rollup({
      input: join(root, "entry.mjs"),
      plugins: [{
        name: "javascript-consumer",
        transform(code, id) {
          if (id !== source) return
          seen = code
          return { code: code.replace("= 41", "= 42"), map: null }
        }
      }, plugin({ root, compiler: process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang") })]
    })
    await bundle.write({ file: output, format: "es" })
    assert.match(seen, /export const answer = 41/)
    const result = spawnSync(process.execPath, [output], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), "42")
    await writeFile(source, "export const answer: string = 41\n")
    await assert.rejects(async () => {
      repeated = await rollup({
        input: join(root, "entry.mjs"), cache: bundle.cache,
        plugins: [{
          name: "diagnostic-consumer",
          transform(_code, id) {
            if (id === source) throw new Error("the compiler diagnostic must precede this transform")
          }
        }, plugin({ root, compiler: process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang") })]
      })
    }, /TS2322/)
  } finally {
    await repeated?.close()
    await bundle?.close()
    await rm(root, { recursive: true, force: true })
  }
})


test("closing a pending missing-source watcher removes its file and directory handles", async () => {
  const { missingSourceWatcher } = await import("../src/missing-watcher.js")
  const root = mkdtempSync(join(tmpdir(), "missing-watch-close-"))
  const before = new Set(process._getActiveHandles())
  const watcher = missingSourceWatcher()
  try {
    watcher.add([join(root, "missing.vibe")])
    assert.ok(existsSync(watcher.file))
    const owned = new Set(process._getActiveHandles().filter(handle => !before.has(handle)))
    watcher.close()
    watcher.close()
    watcher.add([join(root, "later.vibe")])
    // Native close callbacks run after the check phase. Inspect only handles
    // opened synchronously by this watcher, after that phase has completed.
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(existsSync(watcher.file), false)
    assert.deepEqual(process._getActiveHandles().filter(handle => owned.has(handle)), [])
  } finally {
    watcher.close()
    rmSync(root, { recursive: true, force: true })
  }
})
