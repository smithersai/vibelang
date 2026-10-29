import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// The vibelang setting declarationSidecars writes x.d.vibe.ts beside each
// .vibe module, which stock TypeScript reads under allowArbitraryExtensions.
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const effect = join(modules, "effect")
const stockTsc = join(modules, "typescript/bin/tsc")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, stockTsc, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`

function project(t, files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-sidecars-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  return root
}

const options = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true }
const library = (compilerOptions = {}) => ({
  "lib/tsconfig.json": JSON.stringify({
    compilerOptions: { ...options, rewriteRelativeImportExtensions: true, noEmit: true, ...compilerOptions },
    vibelang: { declarationSidecars: true },
    include: ["src"]
  }),
  "lib/src/name.vibe": "export type Name = { readonly first: string }\n",
  "lib/src/greet.vibe": "import type { Name } from \"./name.vibe\"\n\nexport function greet(name: Name): string {\n  return `Hello, ${name.first}!`\n}\n",
  "lib/src/util.ts": "export type Loud = string\n",
  "lib/src/loud.vibe": "import type { Loud } from \"./util.ts\"\nimport { greet } from \"./greet.vibe\"\n\nexport const loud = (first: string): Loud => greet({ first })\n"
})

const run = (command, args, cwd) => spawnSync(command, args, { cwd, encoding: "utf8" })

test("vibelang writes x.d.vibe.ts beside each .vibe module, naming .vibe imports by their source", { skip }, (t) => {
  const root = project(t, library())
  const built = run(native, ["-p", "lib/tsconfig.json"], root)
  assert.equal(built.status, 0, built.stdout + built.stderr)
  const greet = readFileSync(join(root, "lib/src/greet.d.vibe.ts"), "utf8")
  assert.equal(greet, "import type { Name } from \"./name.vibe\";\nexport declare function greet(name: Name): string;\n")
  assert.equal(readFileSync(join(root, "lib/src/name.d.vibe.ts"), "utf8"), "export type Name = {\n    readonly first: string;\n};\n")
  // A TypeScript module keeps the name stock TypeScript resolves.
  assert.equal(readFileSync(join(root, "lib/src/loud.d.vibe.ts"), "utf8"), "import type { Loud } from \"./util.js\";\nexport declare const loud: (first: string) => Loud;\n")
  assert.equal(existsSync(join(root, "lib/src/util.d.vibe.ts")), false)
  // A sidecar is an output of its source, never an input of the project.
  const listed = run(native, ["-p", "lib/tsconfig.json", "--listFiles"], root)
  assert.doesNotMatch(listed.stdout, /\.d\.vibe\.ts/)

  // An unchanged sidecar is not written again, so a watch that includes it settles.
  const before = statSync(join(root, "lib/src/greet.d.vibe.ts")).mtimeMs
  assert.equal(run(native, ["-p", "lib/tsconfig.json"], root).status, 0)
  assert.equal(statSync(join(root, "lib/src/greet.d.vibe.ts")).mtimeMs, before)
})

test("stock tsc checks a TypeScript importer of a .vibe module against its sidecar", { skip }, (t) => {
  const root = project(t, {
    ...library(),
    "app/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, noEmit: true, allowArbitraryExtensions: true }, include: ["main.ts"] }),
    "app/main.ts": "import { greet } from \"../lib/src/greet.vibe\"\nimport { loud } from \"../lib/src/loud.vibe\"\n\nexport const ok: string = greet({ first: \"Ada\" }) + loud(\"Grace\")\nexport const wrong: number = greet({ first: \"Ada\" })\n"
  })
  // Without sidecars, stock tsc cannot resolve the import.
  const before = run(process.execPath, [stockTsc, "-p", "app/tsconfig.json"], root)
  assert.match(before.stdout, /TS2307: Cannot find module '\.\.\/lib\/src\/greet\.vibe'/)
  assert.equal(run(native, ["-p", "lib/tsconfig.json"], root).status, 0)
  const after = run(process.execPath, [stockTsc, "-p", "app/tsconfig.json"], root)
  assert.equal(after.stdout.trim().split("\n").filter(Boolean).length, 1, after.stdout)
  assert.match(after.stdout, /main\.ts\(5,14\): error TS2322: Type 'string' is not assignable to type 'number'/)
})

test("sidecars sit beside the sources when declarations go to an outDir", { skip }, (t) => {
  const root = project(t, library({ noEmit: false, declaration: true, declarationMap: true, outDir: "dist", rootDir: "src" }))
  const built = run(native, ["-p", "lib/tsconfig.json"], root)
  assert.equal(built.status, 0, built.stdout + built.stderr)
  assert.equal(readFileSync(join(root, "lib/src/greet.d.vibe.ts"), "utf8"), "import type { Name } from \"./name.vibe\";\nexport declare function greet(name: Name): string;\n")
  // The ordinary declarations keep their emitted names.
  assert.match(readFileSync(join(root, "lib/dist/greet.d.ts"), "utf8"), /from "\.\/name\.js"/)
})

test("vibelang -b writes the sidecars of a composite project", { skip }, (t) => {
  const root = project(t, library({ noEmit: false, composite: true, outDir: "dist", rootDir: "src" }))
  const built = run(native, ["-b", "lib"], root)
  assert.equal(built.status, 0, built.stdout + built.stderr)
  assert.equal(readFileSync(join(root, "lib/src/greet.d.vibe.ts"), "utf8"), "import type { Name } from \"./name.vibe\";\nexport declare function greet(name: Name): string;\n")
})

test("a project without the setting writes no sidecar", { skip }, (t) => {
  const files = library()
  files["lib/tsconfig.json"] = JSON.stringify({ compilerOptions: { ...options, rewriteRelativeImportExtensions: true, noEmit: true }, include: ["src"] })
  const root = project(t, files)
  assert.equal(run(native, ["-p", "lib/tsconfig.json"], root).status, 0)
  assert.equal(existsSync(join(root, "lib/src/greet.d.vibe.ts")), false)
})
