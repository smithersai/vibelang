import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"

const root = new URL("../", import.meta.url)
const read = (path) => readFileSync(new URL(path, root), "utf8")

// Read actual target declarations, rather than comments or a parallel list of
// supposedly run packages. goTest takes the package selector and input directory;
// goVibelang takes its complete Go command as the second argument.
function selections(rootSource, moduleSource) {
  const selected = []
  for (const match of moduleSource.matchAll(/^\s*"[^"]+": goTest\("[^"]*", "([^"]+)", "([^"]+)"\)/gm)) {
    selected.push({ pattern: match[1], inputs: match[2] })
  }
  for (const match of rootSource.matchAll(/^  "[^"]+": goVibelang\(([\s\S]*?)\n  \)/gm)) {
    const command = match[1]
    if (!/\bgo test\b/.test(command)) continue
    for (const pattern of command.match(/\.\/internal\/[\w/.-]+/g) ?? []) selected.push({ pattern })
  }
  return selected
}
const covers = (pattern, path) => pattern.endsWith("/...")
  ? path === pattern.slice(0, -4) || path.startsWith(pattern.slice(0, -3))
  : path === pattern

function ownedTestPackages() {
  const packages = []
  const walk = (path) => {
    const entries = readdirSync(new URL(`typescript/tsc/${path}/`, root), { withFileTypes: true })
    if (entries.some((entry) => entry.isFile() && entry.name.endsWith("_test.go"))) packages.push(`./${path}`)
    for (const entry of entries) if (entry.isDirectory() && entry.name !== "testdata") walk(`${path}/${entry.name}`)
  }
  for (const entry of readdirSync(new URL("typescript/tsc/internal/", root), { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("vibelang")) walk(`internal/${entry.name}`)
  }
  return packages.sort()
}

test("every VibeLang Go test package is selected by the validation graph", () => {
  const packages = ownedTestPackages()
  assert.ok(packages.length >= 7, `only ${packages.length} VibeLang packages discovered`)
  const selected = selections(read("PACKAGE.ts"), read("typescript/tsc/PACKAGE.ts"))
  assert.deepEqual(packages.filter((path) => !selected.some(({ pattern }) => covers(pattern, path))), [],
    "Go does not run a dependency's tests; give each owned test package a target")
})

test("standalone Go targets include their selected package's test sources", () => {
  const selected = selections("", read("typescript/tsc/PACKAGE.ts"))
  assert.ok(selected.length >= 4)
  for (const { pattern, inputs } of selected) {
    assert.ok(covers(pattern, `./${inputs}`), `${pattern} is keyed on unrelated ${inputs}`)
  }
  assert.match(read("typescript/tsc/PACKAGE.ts"), /data:\s*\[srcs, files\(dir\)\]/)
})

test("inventory selectors respect Go package boundaries and active declarations", () => {
  assert.ok(covers("./internal/vibelang/...", "./internal/vibelang"))
  assert.ok(covers("./internal/vibelang/...", "./internal/vibelang/sub"))
  assert.equal(covers("./internal/vibelang/...", "./internal/vibelangfmt"), false)
  assert.equal(covers("./internal/vibelang", "./internal/vibelang/sub"), false)
  assert.deepEqual(selections("", '// "fake": goTest("unused", "./internal/forgotten/...", "internal/forgotten")'), [])
  assert.deepEqual(selections("", '    "actual": goTest("real", "./internal/vibelangfmt/...", "internal/vibelangfmt"),'),
    [{ pattern: "./internal/vibelangfmt/...", inputs: "internal/vibelangfmt" }])
})
