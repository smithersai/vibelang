import { strict as assert } from "node:assert"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { projects } from "../project.mjs"

// A bundler root placed anywhere around the asked project's package: the
// package's directory itself, a directory nested inside it (Vite's
// `root: "vite"` with `project: "../tsconfig.json"`), a deeper one, its parent,
// or a sibling. The oracle is the README's rule: every module the project
// includes loads under that project in one compile, and a module it leaves
// out still fails with the membership error.
const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const skip = !existsSync(native) && `run typescript/vibelang/smoke.sh first; missing ${native}`
const rule = "it compiles from its package's directory instead, so every module it includes\nloads, inside `root` or not"
const options = { target: "ESNext", module: "ESNext", moduleResolution: "Bundler", strict: true, types: [], skipLibCheck: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true }

// Bundler roots, relative to the fixture; the package is pkg/.
const roots = { same: "pkg", nested: "pkg/vite", deep: "pkg/vite/deep", above: ".", beside: "other" }
const places = ["core/leaf.vibe", "vite/entry.vibe", "vite/deep/inner.vibe", "top.vibe"]

const arbitrary = fc.record({
  root: fc.constantFrom(...Object.keys(roots)),
  modules: fc.uniqueArray(fc.constantFrom(...places), { minLength: 1, maxLength: places.length }),
  // Whether the first module imports the next, so one is a dependency.
  imports: fc.boolean(),
  // Whether the package holds a .vibe module the include leaves out.
  stray: fc.boolean()
})

const specifier = (from, to) => {
  const path = relative(dirname(from), to)
  return path.startsWith(".") ? path : "./" + path
}

function files(input) {
  const out = {
    "pkg/package.json": '{"type":"module"}',
    "pkg/tsconfig.json": JSON.stringify({ compilerOptions: options, include: input.modules }),
    "other/.keep": ""
  }
  input.modules.forEach((path, index) => {
    const next = input.modules[index + 1]
    out["pkg/" + path] = input.imports && index === 0 && next !== undefined
      ? `import { v1 } from "${specifier(path, next)}"\nexport const v0: number = v1 + 1\n`
      : `export const v${index}: number = ${index + 1}\n`
  })
  if (input.stray) out["pkg/stray/left.vibe"] = "export const left: number = 1\n"
  return out
}

async function check(input) {
  assert.ok(readFileSync(join(packageRoot, "README.md"), "utf8").includes(rule))
  const fixture = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-nested-root-")))
  const started = []
  const project = join(fixture, "pkg/tsconfig.json")
  const modules = projects({ root: join(fixture, roots[input.root]), project, compiler: native, cache: false, debug(line) {
    if (/^compile .* started$/.test(line)) started.push(line.split(" ")[1])
  } })
  try {
    for (const [path, text] of Object.entries(files(input))) {
      mkdirSync(dirname(join(fixture, path)), { recursive: true })
      writeFileSync(join(fixture, path), text)
    }
    for (const [index, path] of input.modules.entries()) {
      const loaded = await modules.load(join(fixture, "pkg", path))
      assert.deepEqual([loaded.project, loaded.error, loaded.errors], [project, false, []], path)
      assert.match(loaded.code, new RegExp(`v${index} = `), path)
    }
    assert.deepEqual(started, [project], "one compile serves every module the project includes")
    if (input.stray) {
      const left = await modules.load(join(fixture, "pkg/stray/left.vibe"))
      assert.ok(left.error, "a module the include leaves out still fails")
      assert.match(left.error.message, /left\.vibe is not part of .*tsconfig\.json/)
    }
  } finally {
    await modules.close()
    rmSync(fixture, { recursive: true, force: true })
  }
}

test("a project compiles every module it includes wherever the bundler root sits", { skip, timeout: 240000 }, async () => {
  await checkProperty(fc, {
    name: "project-nested-root", rule: "a project above or beside the bundler root still compiles every module it includes",
    command: "node --test test/project-nested-root.property.test.mjs", arbitrary, numRuns: 30, check,
    regressions: new URL("./property-regressions/", import.meta.url),
    artifacts: (input) => files(input)
  })
})
