import { strict as assert } from "node:assert"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { projectImports, projects } from "../project.mjs"

// Which tsconfig compiles a module, from generated packages shaped like
// Smithers' apps/mvp. The oracle is the rule the README states, written out
// here over the generated shape; the compiler's own listing confirms each
// answer holds the module.
const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const skip = !existsSync(native) && `run typescript/vibelang/smoke.sh first; missing ${native}`
const rule = "A module compiles under the tsconfig that holds it, found as TypeScript's language\nservice finds it"
const options = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true }

const sibling = fc.record({
  // Its include names ../db; its own main.vibe; and whether that imports db/x.vibe.
  includesDb: fc.boolean(), includesSelf: fc.boolean(), imports: fc.boolean()
})
const arbitrary = fc.record({
  a: sibling, m: sibling, z: sibling,
  rootIncludesDb: fc.boolean(), rootImports: fc.boolean(),
  // db's own config: none, one that lists x.vibe, or one that does not.
  own: fc.constantFrom("none", "lists", "misses"),
  references: fc.subarray(["z", "m", "a"], { minLength: 0 }).chain((list) => fc.shuffledSubarray(list, { minLength: list.length }))
})

const names = ["a", "m", "z"]
const value = "export const value: number = 1\n"
const importing = "import { value } from \"../db/x.vibe\"\nexport const main: number = value\n"

function files(input) {
  const out = {
    "package.json": '{"type":"module"}',
    "db/x.vibe": value,
    "src/app.vibe": input.rootImports ? importing : value,
    "tsconfig.json": JSON.stringify({ compilerOptions: options, include: input.rootIncludesDb ? ["src", "db"] : ["src"], references: input.references.map((name) => ({ path: "./" + name })) })
  }
  if (input.own !== "none") out["db/tsconfig.json"] = JSON.stringify({ compilerOptions: options, include: input.own === "lists" ? ["."] : ["none"] })
  for (const name of names) {
    const { includesDb, includesSelf, imports } = input[name]
    out[name + "/main.vibe"] = imports ? importing : value
    out[name + "/tsconfig.json"] = JSON.stringify({ compilerOptions: { ...options, composite: true, noEmit: false }, include: [...(includesSelf ? ["."] : []), ...(includesDb ? ["../db"] : []), ...(includesSelf || includesDb ? [] : ["none"])] })
  }
  return out
}

// The README's rule over the generated shape.
function expected(input) {
  const lists = (name) => input[name].includesDb
  const holds = (name) => lists(name) || (input[name].includesSelf && input[name].imports)
  if (input.own === "lists") return "db/tsconfig.json"
  // TypeScript redirects a referenced project's root source back to its owner.
  const redirected = input.references.find(lists)
  if (input.rootIncludesDb || input.rootImports) return redirected === undefined ? "tsconfig.json" : redirected + "/tsconfig.json"
  const reference = input.references.find(lists)
  if (reference !== undefined) return reference + "/tsconfig.json"
  const remaining = names.filter((name) => !input.references.includes(name))
  const found = remaining.find(lists) ?? remaining.find(holds)
  return found === undefined ? undefined : found + "/tsconfig.json"
}

async function check(input) {
  assert.ok(readFileSync(join(packageRoot, "README.md"), "utf8").includes(rule))
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-membership-")))
  const old = new Date(Date.now() - 60_000)
  const modules = projects({ root, project: join(root, "tsconfig.json"), compiler: native, cache: false })
  try {
    for (const [path, text] of Object.entries(files(input))) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
      utimesSync(join(root, path), old, old)
    }
    const file = join(root, "db/x.vibe")
    const loaded = await modules.load(file)
    const owner = expected(input)
    if (owner === undefined) {
      // An empty nearest config reports TS18003 before the loader's membership error.
      // Both paths reject the orphan; never accept code from an unrelated config.
      assert.ok(loaded.error || loaded.errors.length, "a module with no owner must fail")
      if (!loaded.error) {
        assert.ok(loaded.errors.some((error) => error.code === "TS18003"), JSON.stringify(loaded.errors))
        return
      }
      assert.match(loaded.error.message, /x\.vibe is not part of .*tsconfig\.json\. Add it to the tsconfig's include\./)
      return
    }
    assert.deepEqual([loaded.project, loaded.error, loaded.errors], [join(root, owner), false, []])
    assert.match(loaded.code, /value = 1/)
    assert.ok(projectImports({ project: loaded.project, compiler: native }).files.includes(file), "the compiler lists the module in the answer")
  } finally {
    await modules.close()
    rmSync(root, { recursive: true, force: true })
  }
}

test("a module compiles under the tsconfig TypeScript's search finds, in generated packages", { skip, timeout: 240000 }, async () => {
  await checkProperty(fc, {
    name: "project-sibling-tsconfig", rule: "the nearest config, its references, the parents, then the package's others by path",
    command: "node --test test/project-membership.property.test.mjs", arbitrary, numRuns: 40, check,
    regressions: new URL("./property-regressions/", import.meta.url),
    artifacts: (input) => files(input)
  })
})
