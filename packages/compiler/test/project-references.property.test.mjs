import { strict as assert } from "node:assert"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { projects } from "../project.mjs"

// A loader's compile (vibelang --loader-root) builds no project reference, so it
// reads each referenced project from its sources, whatever that project's
// rootDir and outDir and however the app reaches it: no TS6305 for a missing
// declaration output, no TS2878 for an output layout the loader never serves.
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const skip = !existsSync(native) && `run typescript/vibelang/smoke.sh first; missing ${native}`
const options = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true }

const arbitrary = fc.record({
  // The chain app -> p0 -> p1 ...: how many referenced projects, and how each importer reaches the next.
  links: fc.array(fc.constantFrom("relative", "package"), { minLength: 1, maxLength: 3 }),
  outDir: fc.constantFrom("lib", "dist", "build/types", "node_modules/.ts-dist/source"),
  rootDir: fc.constantFrom("src", "."),
  appNoEmit: fc.boolean()
})

function files({ links, outDir, rootDir, appNoEmit }) {
  const out = {}
  const specifier = (link, index, from) => link === "relative" ? `${from}p${index}/src/value.ts` : `p${index}/value`
  out["app/package.json"] = '{"type":"module"}'
  out["app/tsconfig.json"] = JSON.stringify({ compilerOptions: { ...options, noEmit: appNoEmit }, include: ["src"], references: [{ path: "../p0" }] })
  out["app/src/main.vibe"] = `import { value } from "${specifier(links[0], 0, "../../")}"\nexport const fromApp: number = value() + 1\n`
  links.forEach((_, index) => {
    const next = links[index + 1]
    out[`p${index}/package.json`] = JSON.stringify({ name: `p${index}`, type: "module", exports: { "./value": "./src/value.ts" } })
    out[`p${index}/tsconfig.json`] = JSON.stringify({
      compilerOptions: { ...options, composite: true, declaration: true, rootDir, outDir },
      include: ["src"], references: next ? [{ path: `../p${index + 1}` }] : []
    })
    out[`p${index}/src/value.ts`] = next
      ? `import { value as inner } from "${specifier(next, index + 1, "../../")}"\nexport const value = (): number => inner() + 1\n`
      : "export const value = (): number => 1\n"
    if (index > 0 && links[index] === "package") out[`p${index - 1}/node_modules/p${index}`] = `link:p${index}`
  })
  if (links[0] === "package") out["app/node_modules/p0"] = "link:p0"
  return out
}

test("a loader compile of a project with unbuilt references reads them from source", { skip }, async () => {
  await checkProperty(fc, {
    name: "loader-unbuilt-references", rule: "loader compiles need no built project reference (TS6305, TS2878)",
    command: "node --test test/project-references.property.test.mjs", arbitrary, numRuns: 12,
    artifacts: (input) => files(input),
    check: async (input) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-references-")))
      try {
        for (const [path, text] of Object.entries(files(input))) {
          const target = join(root, path)
          mkdirSync(dirname(target), { recursive: true })
          if (text.startsWith("link:")) { symlinkSync(join(root, text.slice(5)), target, "dir"); continue }
          writeFileSync(target, text)
          utimesSync(target, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
        }
        const app = join(root, "app")
        const modules = projects({ root: app, project: join(app, "tsconfig.json"), compiler: native, cache: false })
        try {
          const main = await modules.load(join(app, "src/main.vibe"))
          assert.deepEqual([main.errors.map(({ code, text }) => `${code} ${text}`), main.error], [[], false])
          assert.match(main.code, /fromApp = value\(\) \+ 1/)
        } finally { await modules.close() }
        input.links.forEach((_, index) => assert.equal(existsSync(join(root, `p${index}`, input.outDir)), false, `p${index}/${input.outDir} stays unbuilt`))
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  })
})

test("opencode-loader-unbuilt-package-reference: a .vibe module loads with its package reference unbuilt", { skip }, async () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-loader-unbuilt-package-reference.json", import.meta.url), "utf8"))
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-references-")))
  try {
    for (const [path, text] of Object.entries(corpus.files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    for (const [path, target] of Object.entries(corpus.links)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      symlinkSync(join(root, target), join(root, path), "dir")
    }
    const app = join(root, "app")
    const modules = projects({ root: app, project: join(app, "tsconfig.json"), compiler: native, cache: false })
    try {
      const main = await modules.load(join(app, "src/main.vibe"))
      assert.deepEqual([main.errors.map(({ code, text }) => `${code} ${text}`), main.error], [[], false])
      assert.match(main.code, /total = fromTs\(\) \+ fromVibe\(\)/)
    } finally { await modules.close() }
    assert.equal(existsSync(join(root, "core/node_modules/.ts-dist")), false, "the reference stays unbuilt")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
