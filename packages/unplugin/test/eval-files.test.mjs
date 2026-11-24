// Run through test/run.sh. VIP-59 rule 8: an eval file (*.eval.vibe,
// *.eval.vibex) is never reachable from an application entry; the plugin
// refuses an import of one from a non-eval file, in every bundler.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { unplugin } from "../src/index.js"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const vip = readFileSync(join(repo, "docs/design/vips/0059-eval-declarations.md"), "utf8")
const frameworks = ["vite", "rollup", "rolldown", "webpack", "rspack", "esbuild"]

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [],
    rewriteRelativeImportExtensions: true, allowImportingTsExtensions: true, jsx: "react-jsx"
  },
  include: ["src"]
})

const files = {
  "src/shared.vibe": "export const greeting = \"Hello\"\n",
  "src/greet.eval.vibe": "import { greeting } from \"./shared.vibe\"\nexport const cases = [greeting]\n",
  "src/other.eval.vibe": "import { cases } from \"./greet.eval.vibe\"\nexport const count = cases.length\n",
  "src/card.eval.vibex": "export const card = 1\n",
  "src/evaluate.vibe": "export const evaluate = 1\n",
  "src/app.vibe": "export const app = 1\n",
  "src/main.ts": "export const main = 1\n"
}

async function fixture(t, extra = {}) {
  const parent = join(repo, "packages/unplugin/test/.fixtures")
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, "eval-files-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "node_modules"))
  await symlink(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
  await writeFile(join(root, "package.json"), '{"type":"module"}')
  await writeFile(join(root, "tsconfig.json"), tsconfig)
  for (const [file, text] of Object.entries({ ...files, ...extra })) {
    await mkdir(join(root, file, ".."), { recursive: true })
    await writeFile(join(root, file), text)
  }
  return root
}

const refused = (importer, label) => (error) => {
  assert.match(error.message, /imports the eval file .*\.eval\.vibex?/, label)
  assert.ok(error.message.includes(importer), `${label}: ${error.message}`)
  assert.match(error.message, /`vibelang eval`/, label)
  assert.match(error.message, /never bundled into an application \(VIP-59\)/, label)
  return true
}

test("VIP-59 states the bundle rule", () => {
  assert.ok(vip.includes("**Bundles.** An eval file is never reachable from an application entry. The bundler plugins refuse an import of one from a non-eval file."))
  assert.ok(vip.includes("The bundler plugins refuse to bundle an eval file into an application."))
})

// Hook level: every spelling of an import of an eval file, in every bundler's hook.
test("resolveId refuses an eval file imported from a non-eval file, in every bundler", async (t) => {
  const root = await fixture(t)
  const src = join(root, "src")
  for (const framework of frameworks) {
    const plugin = unplugin.raw({ root, compiler }, { framework })
    const context = { resolve: async () => null }
    const resolveId = (source, importer) => Promise.resolve().then(() => plugin.resolveId.call(context, source, importer, {}))
    // A .ts importer needs no compile to resolve; a .vibe importer's emitted names do.
    for (const source of ["./greet.eval.vibe", "./greet.eval.js", "./greet.eval", "./greet.eval.vibe?import", "./card.eval.vibex", join(src, "greet.eval.vibe")]) {
      await assert.rejects(resolveId(source, join(src, "main.ts")), refused(join(src, "main.ts"), `${framework}: main.ts -> ${source}`))
    }
    for (const source of ["./greet.eval.vibe", "./card.eval.vibex", join(src, "greet.eval.vibe")]) {
      await assert.rejects(resolveId(source, join(src, "app.vibe")), refused(join(src, "app.vibe"), `${framework}: app.vibe -> ${source}`))
    }
    // An eval file imports another eval file, and an eval file can be an entry.
    assert.equal(await resolveId("./greet.eval.vibe", join(src, "other.eval.vibe")), join(src, "greet.eval.vibe"), framework)
    assert.equal(await resolveId("./greet.eval.vibe", join(src, "card.eval.vibex")), join(src, "greet.eval.vibe"), framework)
    await resolveId(join(src, "greet.eval.vibe"), undefined)
    // Names that only look alike are ordinary modules.
    assert.equal(await resolveId("./evaluate.vibe", join(src, "main.ts")), join(src, "evaluate.vibe"), framework)
    assert.equal(await resolveId("./shared.vibe", join(src, "greet.eval.vibe")), join(src, "shared.vibe"), framework)
    await plugin.closeBundle?.call(context)
  }
})

test("Bun's resolve hook refuses an eval file imported from a non-eval file", async (t) => {
  const root = await fixture(t)
  const src = join(root, "src")
  let resolve
  unplugin.raw({ root, compiler }, { framework: "bun" }).bun.setup({
    onResolve(options, callback) { resolve = (path, importer) => callback({ path, importer, kind: "import-statement" })?.path },
    onLoad() {}
  })
  assert.throws(() => resolve("./greet.eval.vibe", join(src, "main.ts")), refused(join(src, "main.ts"), "bun"))
  assert.throws(() => resolve("./greet.eval.js", join(src, "main.ts")), refused(join(src, "main.ts"), "bun .js"))
  assert.equal(resolve("./greet.eval.vibe", join(src, "other.eval.vibe")), join(src, "greet.eval.vibe"))
  assert.equal(resolve("./shared.vibe", join(src, "main.ts")), join(src, "shared.vibe"))
})

const builders = {
  async esbuild(root, entry) {
    const { build } = await import("esbuild")
    const plugin = (await import("../src/esbuild.js")).default
    const result = await build({
      absWorkingDir: root, entryPoints: [join(root, entry)], bundle: true, format: "esm", write: false, logLevel: "silent",
      external: ["effect", "effect/*", "vibelang-runtime", "vibelang-runtime/*"], plugins: [plugin({ root, compiler })]
    })
    return result.outputFiles[0].text
  },
  async rollup(root, entry) {
    const { rollup } = await import("rollup")
    const plugin = (await import("../src/rollup.js")).default
    const bundle = await rollup({
      input: join(root, entry), external: [/^effect(\/|$)/, /^vibelang-runtime(\/|$)/], onwarn() {},
      plugins: [plugin({ root, compiler }), {
        // Rollup has no TypeScript: the fixture's .ts entries are plain JavaScript.
        name: "ts-as-js", resolveId(source, importer) { if (/\.ts$/.test(source) && importer) return join(importer, "..", source) }
      }]
    })
    try {
      return (await bundle.generate({ format: "es" })).output[0].code
    } finally {
      await bundle.close()
    }
  }
}

for (const [name, bundle] of Object.entries(builders)) {
  test(`${name}: a build whose entry imports an eval file fails, and names both files`, async (t) => {
    const root = await fixture(t, { "src/main.ts": "import { cases } from \"./greet.eval.vibe\"\nexport const total = cases.length\n" })
    await assert.rejects(bundle(root, "src/main.ts"), (error) => {
      const text = error.message + JSON.stringify(error.errors ?? [])
      assert.match(text, /main\.ts imports the eval file .*greet\.eval\.vibe/)
      assert.match(text, /never bundled into an application \(VIP-59\)/)
      return true
    })
  })

  test(`${name}: a build fails when a .vibe module in the graph imports an eval file`, async (t) => {
    const root = await fixture(t, {
      "src/app.vibe": "import { cases } from \"./greet.eval.vibe\"\nexport const total = cases.length\n",
      "src/main.ts": "export { total } from \"./app.vibe\"\n"
    })
    await assert.rejects(bundle(root, "src/main.ts"), (error) => {
      assert.match(error.message + JSON.stringify(error.errors ?? []), /app\.vibe imports the eval file .*greet\.eval\.vibe/)
      return true
    })
  })

  test(`${name}: an application that imports no eval file builds beside eval files, and an eval file builds as an entry`, async (t) => {
    const root = await fixture(t, { "src/main.ts": "import { greeting } from \"./shared.vibe\"\nexport const text = greeting\n" })
    assert.match(await bundle(root, "src/main.ts"), /Hello/)
    assert.match(await bundle(root, "src/other.eval.vibe"), /Hello/)
  })
}
