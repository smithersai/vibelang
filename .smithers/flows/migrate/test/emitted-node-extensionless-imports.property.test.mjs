// emitPackageJs writes .vibelang/js so that plain Node, which loads no
// VibeLang plugin, can run a migrated package. The compiler keeps a relative
// import as written, as TypeScript does, so `import { Api } from "../api"`
// stayed extensionless, and Node's ESM resolver rejected it
// (ERR_MODULE_NOT_FOUND .vibelang/js/src/api). opencode's packed server
// reached .vibelang/js/src/handlers/command.js that way and its Node
// consumer failed. The emitted tree mirrors the package, so such an import
// names the module's emitted file.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { emitPackageJs } from "../lib/declarations.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-server-command-extensionless-imports.json", import.meta.url), "utf8"))

const write = (root, files) => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
}

// A compiler that writes each source's JavaScript as given, with a source map
// naming its source, as vibelang does for --outDir and --sourceMap true.
function fakeCompiler(root, pkg, outputs) {
  const compiler = join(root, "emit.cjs")
  writeFileSync(compiler, [
    "#!/usr/bin/env node",
    'const fs = require("node:fs"), path = require("node:path")',
    'const out = process.argv[process.argv.indexOf("--outDir") + 1]',
    `for (const [source, text] of Object.entries(${JSON.stringify(outputs)})) {`,
    '  const file = path.join(out, source.replace(/\\.(?:ts|vibe)$/, ".js"))',
    "  fs.mkdirSync(path.dirname(file), { recursive: true })",
    "  fs.writeFileSync(file, text)",
    `  fs.writeFileSync(file + ".map", JSON.stringify({ version: 3, sourceRoot: ${JSON.stringify(pkg + "/")}, sources: [source], names: [], mappings: "" }))`,
    '  console.log("TSFILE: " + file); console.log("TSFILE: " + file + ".map")',
    "}"
  ].join("\n") + "\n", { mode: 0o755 })
  return compiler
}

async function emitted(files, outputs) {
  const root = mkdtempSync(join(tmpdir(), "migrate-emitted-node-imports-"))
  const pkg = join(root, "pkg")
  write(root, {
    "package.json": '{"type":"module"}',
    "pkg/package.json": JSON.stringify({ name: "@demo/pkg", type: "module" }),
    "pkg/tsconfig.json": JSON.stringify({ compilerOptions: { target: "ES2022", module: "Preserve", moduleResolution: "Bundler" }, include: ["src"] }),
    ...Object.fromEntries(Object.entries(files).map(([file, text]) => ["pkg/" + file, text]))
  })
  const result = await emitPackageJs({ compiler: fakeCompiler(root, pkg, outputs), tsconfigs: ["tsconfig.json"], packageDir: pkg, root })
  assert.equal(result.code, 0, JSON.stringify(result.diagnostics))
  return { root, pkg, read: (file) => readFileSync(join(pkg, ".vibelang/js", file), "utf8") }
}

test("opencode server: an emitted handler's extensionless imports resolve under plain Node", async () => {
  const { root, pkg, read } = await emitted(corpus.sources, corpus.outputs)
  try {
    const command = read("src/handlers/command.js")
    assert.match(command, /from "\.\.\/api\.js"/)
    assert.match(command, /from "\.\.\/location\/index\.js"/)
    const node = spawnSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(join(pkg, ".vibelang/js/src/handlers/command.js"))}); console.log(m.describe())`], { cwd: root, encoding: "utf8" })
    assert.equal(node.status, 0, node.stderr)
    assert.equal(node.stdout.trim(), corpus.expected)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// Neighbourhood: a relative import names a .ts or .vibe module, a directory
// with an index module, a module outside the package, a test module, or an
// asset or package. Only a module the emitted tree holds gains its name.
test("an extensionless relative import names the emitted module only when the tree holds it", async () => {
  const kinds = ["ts", "vibe", "index", "outside", "test", "bare", "explicit"]
  await fc.assert(fc.asyncProperty(fc.uniqueArray(fc.constantFrom(...kinds), { minLength: 1, maxLength: kinds.length }), async (picked) => {
    const sources = { "src/main.ts": "" }, outputs = {}, imports = [], expected = {}
    for (const kind of picked) {
      const name = "m_" + kind
      if (kind === "ts" || kind === "vibe") {
        sources[`src/lib/${name}.${kind}`] = "export const v = 1\n"; outputs[`src/lib/${name}.${kind}`] = "export const v = 1;\n"
        imports.push(`./lib/${name}`); expected[`./lib/${name}`] = `./lib/${name}.js`
      } else if (kind === "index") {
        sources[`src/${name}/index.ts`] = "export const v = 1\n"; outputs[`src/${name}/index.ts`] = "export const v = 1;\n"
        imports.push(`./${name}`); expected[`./${name}`] = `./${name}/index.js`
      } else if (kind === "outside") {
        imports.push(`../../${name}`); expected[`../../${name}`] = `../../${name}`
      } else if (kind === "test") {
        sources[`src/${name}.test.ts`] = "export const v = 1\n"
        imports.push(`./${name}.test`); expected[`./${name}.test`] = `./${name}.test`
      } else if (kind === "bare") {
        imports.push("effect"); expected.effect = "effect"
      } else {
        sources[`src/${name}.ts`] = "export const v = 1\n"; outputs[`src/${name}.ts`] = "export const v = 1;\n"
        imports.push(`./${name}.js`); expected[`./${name}.js`] = `./${name}.js`
      }
    }
    outputs["src/main.ts"] = imports.map((specifier, i) => `export * as i${i} from ${JSON.stringify(specifier)};`).join("\n") + "\n"
    const { root, read } = await emitted(sources, outputs)
    try {
      const main = read("src/main.js")
      for (const [before, after] of Object.entries(expected)) assert.ok(main.includes(JSON.stringify(after)), `${before} -> ${after}:\n${main}`)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { numRuns: 25 })
})
