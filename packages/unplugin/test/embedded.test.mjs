// The esbuild configurations a repository embeds in its tests and scripts,
// as the VibeLang migration wires them (`vibelang()` from
// vibelang-unplugin/esbuild appended to the call's plugins): each still
// bundles once a module it reaches is a .vibe module. The shapes are
// Smithers' browser-bundle checks: a .ts entry that imports a .vibe module, a
// browser IIFE, stdin with a resolveDir, packages external, a bundle: false
// build, and an existing plugin ahead of vibelang(). Run test/run.sh first.
import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"
import vibelang from "vibelang-unplugin/esbuild"
import { runChild } from "./child.mjs"

const here = fileURLToPath(new URL(".", import.meta.url))
const fc = createRequire(import.meta.url)("fast-check")
// twice compiled: `n * 2`, or `o*2` minified.
const compiled = /\w ?\* ?2\b/

// A package whose src/lib.vibe the .ts modules import three ways.
async function project(t) {
  const root = await mkdtemp(join(here, ".fixtures", "embedded-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const put = async (file, text) => { await mkdir(join(root, file, ".."), { recursive: true }); await writeFile(join(root, file), text) }
  await put("package.json", '{ "private": true, "type": "module" }\n')
  await put("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [], rootDir: ".", outDir: "dist", rewriteRelativeImportExtensions: true }, include: ["src/*.vibe", "src/*.ts"] }))
  await put("src/lib.vibe", "export function twice(n: number): number {\n  return n * 2\n}\n")
  await put("src/viaVibe.ts", 'import { twice } from "./lib.vibe"\nexport const a = twice(1)\n')
  await put("src/viaJs.ts", 'import { twice } from "./lib.js"\nexport const a = twice(2)\n')
  await put("src/viaBare.ts", 'import { twice } from "./lib"\nexport const a = twice(3)\n')
  return root
}

const text = (result) => result.outputFiles.map((file) => file.text).join("\n")

describe("embedded esbuild configurations with vibelang() appended", () => {
  const shapes = {
    "a .ts entry importing ./lib.vibe, browser IIFE": (root) => ({ entryPoints: [join(root, "src/viaVibe.ts")], bundle: true, platform: "browser", format: "iife" }),
    "a .ts entry importing ./lib.js, browser ESM": (root) => ({ entryPoints: [join(root, "src/viaJs.ts")], bundle: true, platform: "browser", format: "esm", target: "es2022" }),
    "a .ts entry importing ./lib, node": (root) => ({ entryPoints: [join(root, "src/viaBare.ts")], bundle: true, platform: "node", format: "esm" }),
    "a relative entry under absWorkingDir": (root) => ({ absWorkingDir: root, entryPoints: ["src/viaJs.ts"], bundle: true, platform: "browser" }),
    "a relative .vibe entry under absWorkingDir": (root) => ({ absWorkingDir: root, entryPoints: ["src/lib.vibe"], bundle: true, platform: "browser" }),
    "stdin with a resolveDir": (root) => ({ stdin: { contents: 'export * from "./src/lib.vibe"', resolveDir: root, loader: "ts" }, bundle: true, platform: "browser", format: "iife", globalName: "bundle" }),
    "stdin importing ./src/lib.js from its resolveDir": (root) => ({ stdin: { contents: 'export * from "./src/lib.js"', resolveDir: root, loader: "ts" }, bundle: true, platform: "browser" }),
    "stdin importing ./src/lib from its resolveDir": (root) => ({ stdin: { contents: 'export * from "./src/lib"', resolveDir: root, loader: "ts" }, bundle: true, platform: "browser" }),
    "a relative .vibe entry under an absWorkingDir that is not the root": (root) => ({ absWorkingDir: join(root, "src"), entryPoints: ["lib.vibe"], bundle: true, platform: "browser" }),
    "packages external, neutral, minified": (root) => ({ entryPoints: [join(root, "src/viaJs.ts")], bundle: true, platform: "neutral", packages: "external", minify: true }),
    "bundle: false on a .vibe entry": (root) => ({ entryPoints: [join(root, "src/lib.vibe")], bundle: false, format: "esm" })
  }
  for (const [name, options] of Object.entries(shapes)) {
    it(name, async (t) => {
      const root = await project(t)
      const result = await build({ write: false, logLevel: "silent", ...options(root), plugins: [vibelang({ root })] })
      assert.match(text(result), compiled)
      assert.doesNotMatch(text(result), /node:/)
    })
  }

  it("an existing plugin ahead of vibelang() keeps its resolution policy", async (t) => {
    const root = await project(t)
    const policy = { name: "builtins", setup(b) { b.onResolve({ filter: /^virtual:answer$/ }, () => ({ path: "answer", namespace: "virtual" })); b.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: "export default 42", loader: "js" })) } }
    const result = await build({ write: false, logLevel: "silent", stdin: { contents: 'export { default } from "virtual:answer"\nexport * from "./src/viaJs.ts"', resolveDir: root, loader: "ts" }, bundle: true, platform: "browser", metafile: true, plugins: [policy, vibelang({ root })] })
    assert.match(text(result), compiled)
    assert.match(text(result), /42/)
    // The metafile names a .vibe input in the plugin's namespace.
    assert.ok(Object.keys(result.metafile.inputs).some((input) => /^vibelang:.*lib\.vibe$/.test(input)), Object.keys(result.metafile.inputs).join(", "))
  })

  // Any combination of the options Smithers' embedded builds set still bundles the compiled .vibe module.
  it("property: platform, format, entry, working directory, minify, externals and an existing plugin", async (t) => {
    const root = await project(t)
    const entries = {
      vibe: { entryPoints: ["src/viaVibe.ts"] },
      js: { entryPoints: ["src/viaJs.ts"] },
      bare: { entryPoints: ["src/viaBare.ts"] },
      module: { entryPoints: ["src/lib.vibe"] },
      "stdin .vibe": { stdin: { contents: 'export * from "./src/lib.vibe"', resolveDir: root, loader: "ts" } },
      "stdin .js": { stdin: { contents: 'export * from "./src/lib.js"', resolveDir: root, loader: "ts" } },
      "stdin bare": { stdin: { contents: 'export * from "./src/lib"', resolveDir: root, loader: "ts" } }
    }
    const policy = { name: "policy", setup(b) { b.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, external: true })) } }
    await fc.assert(fc.asyncProperty(fc.record({
      platform: fc.constantFrom("browser", "node", "neutral"),
      format: fc.constantFrom("esm", "iife", "cjs"),
      entry: fc.constantFrom(...Object.keys(entries)),
      relative: fc.boolean(),
      minify: fc.boolean(),
      external: fc.boolean(),
      existing: fc.boolean(),
      rooted: fc.boolean()
    }), async (shape) => {
      const entry = entries[shape.entry]
      const options = {
        ...(entry.entryPoints && (shape.relative ? { absWorkingDir: root, entryPoints: entry.entryPoints } : { entryPoints: entry.entryPoints.map((file) => join(root, file)) })),
        ...(entry.stdin && { stdin: entry.stdin }),
        bundle: true, write: false, logLevel: "silent", platform: shape.platform, format: shape.format, minify: shape.minify,
        ...(shape.external && { packages: "external" }),
        plugins: [...(shape.existing ? [policy] : []), vibelang(shape.rooted || !shape.relative ? { root } : {})]
      }
      const result = await build(options)
      assert.match(text(result), compiled, JSON.stringify(shape))
    }), { numRuns: 24 })
  })

  // Smithers' tests run under Vitest from the repository root, which installs no vibelang.
  it("with no root, from a working directory that installs no vibelang, uses the compiler beside the plugin", async (t) => {
    const root = await project(t)
    const elsewhere = await mkdtemp(join(tmpdir(), "vibelang-embedded-cwd-"))
    t.after(() => rm(elsewhere, { recursive: true, force: true }))
    const script = join(root, "bundle.mjs")
    await writeFile(script, `import { build } from "esbuild"
import vibelang from "vibelang-unplugin/esbuild"
const result = await build({ entryPoints: [${JSON.stringify(join(root, "src/viaJs.ts"))}], bundle: true, platform: "browser", write: false, logLevel: "silent", plugins: [vibelang()] })
console.log(result.outputFiles[0].text)
`)
    const env = { ...process.env }
    delete env.VIBELANG_BINARY
    const { code, stdout, stderr } = await runChild(process.execPath, [script], { cwd: elsewhere, env })
    assert.equal(code, 0, stderr)
    assert.match(stdout, compiled)
  })

  // A plugin installed without its vibelang peer: each build reports the missing package, and the process lives on.
  it("without the vibelang package, every build fails with the install hint and nothing crashes the process", async (t) => {
    const root = await project(t)
    const alone = await mkdtemp(join(tmpdir(), "vibelang-embedded-alone-"))
    t.after(() => rm(alone, { recursive: true, force: true }))
    await mkdir(join(alone, "node_modules/vibelang-unplugin"), { recursive: true })
    // A copy, so Node resolves the plugin's imports from here, where no vibelang peer is installed.
    for (const entry of ["src", "package.json"]) await cp(join(here, "..", entry), join(alone, "node_modules/vibelang-unplugin", entry), { recursive: true })
    // The plugin's dependencies and esbuild, without the vibelang peer.
    for (const name of await readdir(join(here, "../node_modules"))) {
      if (name !== "vibelang" && name !== ".bin") await symlink(join(here, "../node_modules", name), join(alone, "node_modules", name))
    }
    const script = join(alone, "bundle.mjs")
    await writeFile(script, `import { build } from "esbuild"
import vibelang from "vibelang-unplugin/esbuild"
const plugin = vibelang({ root: ${JSON.stringify(alone)} })
for (const attempt of [1, 2]) {
  try {
    await build({ entryPoints: [${JSON.stringify(join(root, "src/viaJs.ts"))}], bundle: true, write: false, logLevel: "silent", plugins: [plugin] })
    console.log("built " + attempt)
  } catch (error) {
    console.log("failed " + attempt + ": " + error.message.split("\\n").find((line) => /vibelang/.test(line)))
  }
}
console.log("done")
`)
    const env = { ...process.env }
    delete env.VIBELANG_BINARY
    const { code, stdout, stderr } = await runChild(process.execPath, ["--preserve-symlinks", script], { cwd: alone, env })
    assert.equal(code, 0, stdout + stderr)
    assert.match(stdout, /failed 1: .*npm install --save-dev vibelang/)
    assert.match(stdout, /failed 2: .*npm install --save-dev vibelang/)
    assert.match(stdout, /done/)
  })
})
