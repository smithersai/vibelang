// opencode:cli:default-export. Under vibelang/bun a migrated package's emitted
// file (.vibelang/js/) loads as a re-export of its source (emitted-js.mjs), so
// a package import must give exactly the source module's namespace: the keys
// Bun gives the .ts twin without the preload. The re-export always added
// `export default source.default`, and a source with no default gained an
// undefined `default` key (opencode's CLI `run` entry, 2 keys to 3).
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compilerPackage = fileURLToPath(new URL("../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const noBun = spawnSync("bun", ["--version"]).status !== 0 && "bun is not on PATH"
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const noCompiler = noBun || (missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`)

function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
}

function workspace(files, vibe) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-emitted-namespace-")))
  write(root, files)
  mkdirSync(join(root, "node_modules"), { recursive: true })
  symlinkSync(compilerPackage, join(root, "node_modules/vibelang"))
  if (vibe) {
    symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
    symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  }
  return root
}

function bun(root, args) {
  const env = { ...process.env, VIBELANG_BINARY: native, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache") }
  const result = spawnSync("bun", args, { cwd: root, encoding: "utf8", env })
  return { status: result.status, out: result.stdout.trim(), err: result.stderr }
}

test("opencode-emitted-namespace: an export routed to emitted JavaScript keeps its source's keys under vibelang/bun", { skip: noBun }, (t) => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-emitted-namespace.json", import.meta.url), "utf8"))
  const root = workspace(corpus.files, false)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const plain = bun(root, ["probe.mjs"])
  assert.equal(plain.out, corpus.prints, plain.err)
  const preloaded = bun(root, ["--preload", "vibelang/bun", "probe.mjs"])
  assert.equal(preloaded.out, corpus.prints, preloaded.err)
})

// A generated package of modules m0..mN, each routed through its own package
// export to .vibelang/js. A module has its own named exports, a default in one
// of several forms or none, and may re-export everything of the module before
// it (`export *`, which never carries a default). Kinds mix .ts, .js and, with
// a compiler, .vibe sources.
const defaults = ["none", "expression", "as", "from", "namespace", "type"]
const moduleShape = (kinds) => fc.record({
  kind: fc.constantFrom(...kinds),
  names: fc.subarray(["a", "b"]),
  def: fc.constantFrom(...defaults),
  star: fc.boolean()
})

const extension = { ts: ".ts", js: ".js", vibe: ".vibe" }

// The package's files and each module's expected keys, from the shapes alone.
function render(shapes) {
  const files = {}, expected = [], exportsMap = {}
  shapes.forEach((shape, i) => {
    const previous = i > 0 ? `./m${i - 1}.js` : undefined
    const typed = shape.kind !== "js"
    const lines = shape.names.map((name) => `export const ${name}${i}${typed ? ": number" : ""} = ${i}`)
    let def = shape.def
    if ((def === "from" || def === "namespace") && previous === undefined) def = "none"
    if (def === "from" && !expected[i - 1].includes("default")) def = "none"
    if (def === "type" && shape.kind !== "ts") def = "none"
    if (def === "expression") lines.push(`export default ${i}`)
    if (def === "as") lines.push(`const d${i}${typed ? ": number" : ""} = ${i}`, `export { d${i} as default }`)
    if (def === "from") lines.push(`export { default } from "${previous}"`)
    if (def === "namespace") lines.push(`export * as default from "${previous}"`)
    if (def === "type") lines.push(`export default interface Shape${i} { readonly n: number }`)
    const star = shape.star && previous !== undefined
    if (star) lines.push(`export * from "${previous}"`)
    if (!lines.length) lines.push("export {}")
    files[`src/m${i}${extension[shape.kind]}`] = lines.join("\n") + "\n"
    files[`.vibelang/js/src/m${i}.js`] = "export {}\n"
    exportsMap[`./m${i}`] = { types: `./src/m${i}${extension[shape.kind]}`, "vibelang-source": `./src/m${i}${extension[shape.kind]}`, default: `./.vibelang/js/src/m${i}.js` }
    const keys = new Set(shape.names.map((name) => `${name}${i}`))
    if (["expression", "as", "from", "namespace"].includes(def)) keys.add("default")
    if (star) for (const key of expected[i - 1]) if (key !== "default") keys.add(key)
    expected.push([...keys].sort())
  })
  files["package.json"] = JSON.stringify({ name: "@probe/generated", type: "module", exports: exportsMap }) + "\n"
  files["tsconfig.json"] = JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true }, include: ["src/**/*"] }) + "\n"
  files["probe.mjs"] = `const out = []
for (const [i, file] of ${JSON.stringify(shapes.map((shape, i) => `./src/m${i}${extension[shape.kind]}`))}.entries()) {
  const routed = await import("@probe/generated/m" + i)
  const source = await import(file)
  out.push({ routed: Object.keys(routed).sort(), source: Object.keys(source).sort(), same: Object.keys(source).every((key) => routed[key] === source[key]) })
}
console.log(JSON.stringify(out))
`
  return { files, expected }
}

function namespacesHold(shapes) {
  const { files, expected } = render(shapes)
  const root = workspace(files, shapes.some((shape) => shape.kind === "vibe"))
  try {
    const run = bun(root, ["--preload", "vibelang/bun", "probe.mjs"])
    assert.equal(run.status, 0, run.err + "\n" + JSON.stringify(files, null, 2))
    const modules = JSON.parse(run.out)
    modules.forEach((module, i) => {
      const where = `m${i} of ${JSON.stringify(files, null, 2)}`
      assert.deepEqual(module.routed, module.source, where)
      assert.deepEqual(module.routed, expected[i], where)
      assert.ok(module.same, where)
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("emitted-namespace: a routed .ts or .js module's namespace is its source's, with or without a default or export *", { skip: noBun }, () => {
  fc.assert(fc.property(fc.array(moduleShape(["ts", "js"]), { minLength: 1, maxLength: 4 }), namespacesHold), { seed: 2026110222, numRuns: 30 })
})

test("emitted-namespace: mixed .ts and .vibe sources keep their namespaces through the routed export", { skip: noCompiler }, () => {
  fc.assert(fc.property(fc.array(moduleShape(["ts", "vibe"]), { minLength: 1, maxLength: 3 }), namespacesHold), { seed: 2026110223, numRuns: 10 })
})
