import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// VibeLang always writes x.d.vibe.ts beside each
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
  // A written ./util.ts stays ./util.ts, as stock TypeScript declares it (detail 263).
  assert.equal(readFileSync(join(root, "lib/src/loud.d.vibe.ts"), "utf8"), "import type { Loud } from \"./util.ts\";\nexport declare const loud: (first: string) => Loud;\n")
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

for (const section of ["vibelang", "vibe"]) {
  for (const value of [false, true]) {
    test("the retired sidecar option is rejected in " + section + ": " + value, { skip }, (t) => {
      const files = library()
      const config = JSON.parse(files["lib/tsconfig.json"])
      config[section] = { declarationSidecars: value }
      files["lib/tsconfig.json"] = JSON.stringify(config)
      const root = project(t, files)
      const built = run(native, ["-p", "lib/tsconfig.json"], root)
      assert.notEqual(built.status, 0)
      assert.match(built.stdout + built.stderr, section === "vibe"
        ? /EK3007: Unknown vibe option declarationSidecars/
        : /TS5023: Unknown compiler option 'vibelang.declarationSidecars'/)
    })
  }
}

for (const placement of ["first", "last", "only", "extends", "compilerOptions", "bom", "duplicates", "vibe", "vibe.config.json"]) {
  test("--fix removes the retired sidecar option from " + placement + " without rewriting sources", { skip }, (t) => {
    const files = library()
    const config = JSON.parse(files["lib/tsconfig.json"])
    let edited = "lib/tsconfig.json"
    let configPath = edited
    if (placement === "extends") {
      config.extends = "../base.json"
      files["base.json"] = '{ /* keep this comment */ "vibelang": { "declarationSidecars": true } }'
      edited = "base.json"
    } else if (placement === "vibe" || placement === "vibe.config.json") {
      config.vibe = { effectGlobals: false, declarationSidecars: true, severities: { EK0801: "warning" } }
      if (placement === "vibe.config.json") configPath = edited = "lib/vibe.config.json"
    } else if (placement === "compilerOptions") {
      config.compilerOptions.vibelang = { declarationSidecars: true }
    } else {
      config.vibelang = placement === "first"
        ? { declarationSidecars: false, tracing: "none" }
        : placement === "last"
          ? { tracing: "none", declarationSidecars: true }
          : { declarationSidecars: true }
    }
    delete files["lib/tsconfig.json"]
    files[configPath] = JSON.stringify(config)
    if (placement === "bom") files["lib/tsconfig.json"] = "\ufeff" + files["lib/tsconfig.json"]
    if (placement === "duplicates") files["lib/tsconfig.json"] = files["lib/tsconfig.json"].replace('"declarationSidecars":true', '"declarationSidecars":true,"declarationSidecars":false')
    const root = project(t, files)
    const source = readFileSync(join(root, "lib/src/greet.vibe"), "utf8")
    const fixed = run(native, ["-p", configPath, "--fix", "--fix-vip-only"], root)
    assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr)
    const after = readFileSync(join(root, edited), "utf8")
    assert.doesNotMatch(after, /declarationSidecars/)
    if (placement === "vibe" || placement === "vibe.config.json") {
      assert.deepEqual(JSON.parse(after).vibe, { effectGlobals: false, severities: { EK0801: "warning" } })
    }
    if (placement === "extends") assert.match(after, /keep this comment/)
    if (placement === "bom") assert.equal(after.charCodeAt(0), 0xfeff)
    assert.equal(readFileSync(join(root, "lib/src/greet.vibe"), "utf8"), source)
    assert.ok(existsSync(join(root, "lib/src/greet.d.vibe.ts")))
    const again = run(native, ["-p", configPath, "--fix", "--fix-vip-only"], root)
    assert.equal(again.status, 0, again.stdout + again.stderr)
    assert.equal(readFileSync(join(root, edited), "utf8"), after)
  })
}

test("a sidecar's declaration error fails a declaration project, and a no-declaration project only at a .ts importer", { skip }, (t) => {
  const root = project(t, {
    "package.json": '{"type":"module"}',
    "tsconfig.json": JSON.stringify({ compilerOptions: { ...options, noEmit: true }, files: ["main.vibe"] }),
    "main.vibe": "export function make() {\n  service Local { value: number }\n  return Local\n}\n",
    "reference.ts": "import { Context } from \"effect\"\nexport function make() {\n  class Local extends Context.Service<Local, { value: number }>()(\"local\") {}\n  return Local\n}\n"
  })
  const nativeResult = run(native, ["-p", "tsconfig.json", "--pretty", "false"], root)
  const stockResult = run(process.execPath, [stockTsc, "--target", "es2022", "--module", "nodenext", "--strict", "--skipLibCheck", "--declaration", "--emitDeclarationOnly", "--outDir", "types", "reference.ts"], root)
  const stockPlain = run(process.execPath, [stockTsc, "--target", "es2022", "--module", "nodenext", "--strict", "--skipLibCheck", "--noEmit", "reference.ts"], root)
  const errors = (result) => [...new Set([...result.stdout.matchAll(/error (TS\d+):/g)].map((match) => match[1]))].sort()
  assert.notEqual(stockResult.status, 0, stockResult.stdout + stockResult.stderr)
  assert.deepEqual(errors(stockResult), ["TS4058"], stockResult.stdout + stockResult.stderr)
  assert.equal(stockPlain.status, 0, stockPlain.stdout + stockPlain.stderr)
  // As the same TypeScript under tsc: a project with neither declaration nor
  // composite publishes nothing, so a sidecar's error fails it only where a
  // .ts file imports the module (foldkit-33 ruling, 2026-10-31T18:55Z; the
  // Go test TestSidecarReaders covers the importer side).
  assert.equal(nativeResult.status, 0, nativeResult.stdout + nativeResult.stderr)
  assert.deepEqual(errors(nativeResult), errors(stockPlain), nativeResult.stdout + nativeResult.stderr)
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { ...options, noEmit: true, declaration: true }, files: ["main.vibe"] }))
  const declared = run(native, ["-p", "tsconfig.json", "--pretty", "false"], root)
  assert.notEqual(declared.status, 0, declared.stdout + declared.stderr)
  assert.deepEqual(errors(declared), errors(stockResult), declared.stdout + declared.stderr)
  assert.equal(existsSync(join(root, "main.js")), false)
})
