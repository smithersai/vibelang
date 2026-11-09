import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import fc from "fast-check"
import { build } from "tsdown"
import vibelang from "../src/rolldown.js"

const here = fileURLToPath(new URL(".", import.meta.url))
const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url))
const corpus = JSON.parse(await readFile(new URL("./property-regressions/alchemy-rolldown-native-type-exports.json", import.meta.url), "utf8"))

async function bundledTypes({ extension = "vibe", directory = "src", sidecarDir, hook = "Hook", provider = "Provider", missing = false, chain = false, packageImport = false, sourceText, repeat = false }) {
  const parent = join(here, ".fixtures")
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(join(parent, "declarations-"))
  const previous = process.cwd()
  try {
    await mkdir(join(root, directory), { recursive: true })
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}')
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, target: "ESNext", module: "Preserve",
        moduleResolution: "Bundler", allowImportingTsExtensions: true, types: [], jsx: "preserve",
        ...(sidecarDir ? { rootDirs: [".", sidecarDir] } : {}) },
      ...(sidecarDir ? { vibe: { sidecarDir } } : {}),
      include: ["index.ts", directory + "/**/*"]
    }))
    if (chain) await writeFile(join(root, directory, "metadata." + extension), 'export interface Metadata { readonly kind?: "meta" }\n')
    const source = sourceText ?? ((chain ? 'import type { Metadata } from "./metadata.' + extension + '";\n' : "") + "export interface " + hook + (chain ? " extends Metadata" : "") + " { value: string }; export class " + provider + " { readonly value = 1; }\n")
    await writeFile(join(root, directory, "provider." + extension), source)
    if (packageImport) {
      await mkdir(join(root, "node_modules"), { recursive: true })
      const packageRoot = join(root, directory)
      await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "graph-lib", type: "module", exports: { ".": { types: "./provider." + extension, default: "./provider." + extension } } }))
      await symlink(packageRoot, join(root, "node_modules/graph-lib"), "dir")
    }
    const specifier = packageImport ? "graph-lib" : "./" + directory + "/provider." + extension
    const importedHook = missing ? "Missing" : hook
    await writeFile(join(root, "index.ts"), "import { " + provider + ", " + importedHook + ' } from "' + specifier + '";\nexport const make = (_hook: ' + importedHook + "): " + provider + " => new " + provider + "();\n")
    process.chdir(root)
    const plugin = vibelang()
    const options = { entry: ["index.ts"], format: "esm", dts: true, deps: packageImport ? { alwaysBundle: ["graph-lib"], dts: { alwaysBundle: ["graph-lib"] } } : undefined, plugins: [plugin], outDir: "dist", exports: false, logLevel: "silent" }
    await build(options)
    const declaration = await readFile(join(root, "dist/index.d.mts"), "utf8")
    assert.match(declaration, new RegExp("interface " + hook))
    assert.ok(!declaration.includes("vibelang-declarations-"), declaration)
    async function checkConsumer(kind = "string") {
      const good = kind === "string" ? '\"ok\"' : "123"
      const bad = kind === "string" ? "123" : '\"bad\"'
      await writeFile(join(root, "consumer.mts"), [
        'import { make } from "./dist/index.mjs"',
        "const one: 1 = make({ value: " + good + " }).value",
        "// @ts-expect-error the bundled interface keeps its value type",
        "make({ value: " + bad + " })",
        ...(chain ? ["// @ts-expect-error the inherited native type is retained", "make({ value: " + good + ", kind: 123 })"] : []),
        "void one", ""
      ].join("\n"))
      const checked = spawnSync(process.execPath, [tsc, "--strict", "--noEmit", "--skipLibCheck", "--target", "ESNext",
        "--module", "NodeNext", "--moduleResolution", "NodeNext", join(root, "consumer.mts")], { encoding: "utf8" })
      assert.equal(checked.status, 0, checked.stdout + checked.stderr)
    }
    await checkConsumer()
    const runtime = await import(pathToFileURL(join(root, "dist/index.mjs")).href)
    assert.deepEqual(Object.keys(runtime), ["make"])
    assert.equal(runtime.make({ value: "ok" }).value, 1)
    assert.equal(await readFile(join(root, directory, "provider." + extension), "utf8"), source)
    if (repeat) {
      await writeFile(join(root, directory, "provider." + extension), source.replace("value: string", "value: number"))
      await build(options)
      const rebuilt = await readFile(join(root, "dist/index.d.mts"), "utf8")
      assert.match(rebuilt, /value: number/)
      assert.ok(!rebuilt.includes("vibelang-declarations-"), rebuilt)
      await checkConsumer("number")
    }
    return declaration
  } finally {
    process.chdir(previous)
    await rm(root, { recursive: true, force: true })
  }
}

test("ordinary TypeScript declaration bundling retains an interface and class", async () => {
  await bundledTypes({ extension: "ts" })
})
test("the Alchemy declaration corpus retains native type exports", async () => {
  await bundledTypes({ ...corpus.input, sourceText: corpus.source + "\n" })
})
test("native declarations retain types across generated source layouts", async () => {
  await fc.assert(fc.asyncProperty(
    fc.record({
      extension: fc.constantFrom("vibe", "vibex"),
      directory: fc.constantFrom("src", "nested/lib"),
      sidecarDir: fc.option(fc.constantFrom(".vibe/declarations", "types"), { nil: undefined }),
      suffix: fc.integer({ min: 0, max: 999 }),
      chain: fc.boolean(),
      packageImport: fc.boolean(),
      repeat: fc.boolean()
    }),
    async ({ suffix, ...input }) => { await bundledTypes({ ...input, hook: "Hook" + suffix, provider: "Provider" + suffix }) }
  ), { seed: 40327, numRuns: 12 })
})
test("a nonexistent native type export still fails declaration bundling", async () => {
  await assert.rejects(bundledTypes({ missing: true }), /Missing/)
})

test("native declarations follow a native type-only dependency", async () => {
  await bundledTypes({ chain: true })
})
test("declaration package imports follow native package exports", async () => {
  await bundledTypes({ packageImport: true })
})

test("reusing the plugin refreshes declarations after an authored type change", async () => {
  await bundledTypes({ repeat: true })
})
