import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const regressions = new URL("./property-regressions/", import.meta.url)
const rule = "Relative source imports and literal JavaScript imports denote distinct files, matching the native TypeScript bundler control."

// Bun.build runs only under Bun; a Bun child builds and prints the bundle.
const bunBuild = `
const [plugin, root, compiler, entry] = JSON.parse(process.env.BUN_BUILD_ARGS)
const { default: vibelang } = await import(plugin)
const result = await Bun.build({ entrypoints: [entry], target: "node", format: "esm", plugins: [vibelang({ root, compiler })] })
if (!result.success) { console.error(result.logs.map(String).join("\\n")); process.exit(1) }
console.log(JSON.stringify(await result.outputs[0].text()))
`

const forms = {
  import: (source, literal) => `import { kind as source } from ${source}\nimport { kind as literal } from ${literal}\nexport const out = [source, literal]\n`,
  reexport: (source, literal) => `export { kind as source } from ${source}\nexport { kind as literal } from ${literal}\n`,
  namespace: (source, literal) => `import * as a from ${source}\nimport * as b from ${literal}\nexport const out = [a.kind, b.kind]\n`
}

// A .vibe module imports ./<name>.vibe and the literal file ./<encoded name>.js,
// which is also the name the compiler emits for the first import. Each import
// loads its own file under Bun, as under the other bundlers.
async function check({ name, form }) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-bun-restored-"))
  try {
    mkdirSync(join(root, "node_modules"))
    mkdirSync(join(root, "src"))
    symlinkSync(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
    symlinkSync(join(repo, "experiments/node_modules/effect"), join(root, "node_modules/effect"))
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }))
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [], noEmit: true, allowImportingTsExtensions: true, allowJs: true },
      include: ["src"], vibe: { effectGlobals: false, effectModules: false }
    }))
    const literal = encodeURI(name)
    writeFileSync(join(root, "src", name + ".vibe"), 'export const kind: string = "vibe"\n')
    writeFileSync(join(root, "src", literal + ".js"), 'export const kind = "js"\n')
    // A hand-written x.d.ts beside x.vibe would collide with the module's
    // native declaration (VIP-27); allowJs types the literal file.
    if (literal !== name) writeFileSync(join(root, "src", literal + ".d.ts"), "export declare const kind: string\n")
    const entry = join(root, "src/entry.vibe")
    writeFileSync(entry, forms[form](JSON.stringify("./" + name + ".vibe"), JSON.stringify("./" + literal + ".js")))
    const args = [pathToFileURL(join(repo, "packages/unplugin/src/bun.js")).href, root, compiler, entry]
    const script = join(root, "bun-build.mjs")
    writeFileSync(script, bunBuild)
    const run = spawnSync("bun", [script], { cwd: root, encoding: "utf8", env: { ...process.env, BUN_BUILD_ARGS: JSON.stringify(args) } })
    assert.equal(run.status, 0, run.stderr + run.stdout)
    const output = join(root, "out.mjs")
    writeFileSync(output, JSON.parse(run.stdout.trim().split("\n").at(-1)))
    const module = await import(pathToFileURL(output).href)
    assert.deepEqual(module.out ?? [module.source, module.literal], ["vibe", "js"], JSON.stringify({ name, literal, form }))
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Bun: ./créé.vibe and the literal ./cr%C3%A9%C3%A9.js in one module load their own files", () => check({ name: "créé", form: "import" }))

test("property: Bun keeps a .vibe module's source imports apart from the literal .js files they emit to", async () => {
  await checkProperty(fc, {
    name: "bun-restored-source-imports", rule, command: "node --test test/bun-restored-imports.property.test.mjs",
    arbitrary: fc.record({
      name: fc.array(fc.constantFrom("a", "é", "日", " ", "%", "2", "0"), { minLength: 1, maxLength: 6 }).map(chars => "module-" + chars.join("")),
      form: fc.constantFrom(...Object.keys(forms))
    }),
    check, numRuns: 12, regressions
  })
})
