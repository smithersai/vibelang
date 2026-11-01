import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, renameSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { emitPackageJs } from "../lib/declarations.mjs"
import { routeEmittedExports } from "../lib/emitted-exports.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-emitted-text-asset.json", import.meta.url), "utf8"))
const write = (root, files) => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text)
  }
}
async function fixture({ dir = "src", asset = "snapshot.txt", form = "static", native } = {}) {
  const root = mkdtempSync(join(tmpdir(), "opencode-emitted-asset-"))
  try {
    const pkg = join(root, "pkg"), specifier = "./" + asset
    const body = form === "dynamic"
      ? "export const snapshot = async () => (await import(" + JSON.stringify(specifier) + ', { with: { type: "text" } })).default;\n'
      : form === "reexport"
        ? "export { default as snapshot } from " + JSON.stringify(specifier) + ' with { type: "text" };\n'
        : "import text from " + JSON.stringify(specifier) + ' with { type: "text" }; export const snapshot = () => text;\n'
    const decoys = '// import text from "./not-a-module.txt"\nconst literal = "./snapshot.txt";\n'
    write(root, {
      "package.json": '{"type":"module"}',
      "pkg/package.json": JSON.stringify({ name: "@demo/pkg", type: "module", exports: { "./reader": "./" + dir + "/reader.ts" } }),
      "pkg/tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "Preserve", moduleResolution: "Bundler", allowArbitraryExtensions: true, rewriteRelativeImportExtensions: true }, include: ["**/*"] }),
      "pkg/assets.d.ts": 'declare module "*.txt" { const text: string; export default text }\n',
      ["pkg/" + dir + "/reader.ts"]: 'import "./private.ts";\n' + body,
      ["pkg/" + dir + "/private.ts"]: "export const unused = 1\n",
      ["pkg/" + dir + "/" + asset]: corpus.asset,
      "entry.mjs": 'import { snapshot } from "@demo/pkg/reader"; console.log(typeof snapshot === "function" ? await snapshot() : snapshot)\n'
    })
    mkdirSync(join(root, "node_modules/@demo"), { recursive: true })
    symlinkSync(pkg, join(root, "node_modules/@demo/pkg"))
    const run = name => {
      const build = spawnSync("bun", ["build", "entry.mjs", "--target=bun", "--outdir=" + name, "--entry-naming=bundle.mjs"], { cwd: root, encoding: "utf8" })
      assert.equal(build.status, 0, build.stdout + build.stderr)
      const result = spawnSync("bun", [name + "/bundle.mjs"], { cwd: root, encoding: "utf8" })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      return result.stdout.trim()
    }
    const beforeValue = run("before")
    renameSync(join(pkg, dir, "private.ts"), join(pkg, dir, "private.vibe"))
    writeFileSync(join(pkg, dir, "reader.ts"), 'import "./private.js";\n' + body)
    if (form !== "reexport") assert.equal(beforeValue, corpus.asset.trim())
    const compiler = join(root, "emit.cjs")
    writeFileSync(compiler, [
      "#!/usr/bin/env node",
      'const fs = require("node:fs"), path = require("node:path")',
      'const out = process.argv[process.argv.indexOf("--outDir") + 1]',
      "const file = path.join(out, " + JSON.stringify(dir + "/reader.js") + ")",
      'fs.mkdirSync(path.dirname(file), { recursive: true })',
      "fs.writeFileSync(file, " + JSON.stringify(decoys + body) + ")",
      'console.log("TSFILE: " + file)'
    ].join("\n") + "\n", { mode: 0o755 })
    const result = await emitPackageJs({ compiler: native || compiler, tsconfigs: ["tsconfig.json"], packageDir: pkg, root })
    assert.equal(result.code, 0, JSON.stringify(result.diagnostics))
    let routing
    assert.equal(routeEmittedExports(pkg, result.outputs, {onGraph: value => routing = value}), true, JSON.stringify({outputs: result.outputs, routing, reader: readFileSync(join(pkg, ".vibelang/js", dir, "reader.js"), "utf8")}))
    assert.equal(run("after"), beforeValue)
    const emitted = readFileSync(join(pkg, ".vibelang/js", dir, "reader.js"), "utf8")
    if (!native) assert.ok(emitted.includes(decoys), "comments and unrelated strings keep every byte")
    assert.equal(readFileSync(join(pkg, dir, asset), "utf8"), corpus.asset)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("opencode-56: routed native exports retain their relative text asset at runtime", async () => fixture())
test("asset relocation preserves actual Bun bundles across import forms and nested paths", async () => {
  await fc.assert(fc.asyncProperty(fc.constantFrom("src", "src/deep", "lib"), fc.constantFrom("snapshot.txt", "data/prompt.txt", "text with space.txt", "snapshot.sql"), fc.constantFrom("static", "dynamic", "reexport"), async (dir, asset, form) => fixture({ dir, asset, form })), { seed: 560056, numRuns: 100 })
})

test("the minimized Opencode text-asset pattern works with the actual compiler and Bun", { skip: !process.env.VIBELANG_BINARY && "set VIBELANG_BINARY" }, async () => fixture({ native: process.env.VIBELANG_BINARY }))

test("emitted asset imports follow the documented source-file identity contract", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes('Relative non-code imports in emitted JavaScript resolve to their original source assets.'))
})
