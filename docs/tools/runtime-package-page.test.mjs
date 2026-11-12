import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"

const root = new URL("../../packages/runtime/", import.meta.url)
const read = path => readFileSync(new URL(path, root), "utf8")

// The compiler has no --fix option (TS5023), so the package page and the
// sources it ships must not tell users to run one.
const shipped = () => {
  const files = ["README.md", "package.json"]
  const walk = dir => {
    for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      const path = dir + entry.name
      if (entry.isDirectory()) walk(path + "/")
      else if (/\.ts$/.test(entry.name)) files.push(path)
    }
  }
  walk("src/")
  return files
}

test("the runtime package never tells users to run vibelang --fix", () => {
  for (const path of shipped()) assert.doesNotMatch(read(path), /vibelang --fix/, path)
})

test("the runtime package describes the helpers compiled code imports", () => {
  const { description } = JSON.parse(read("package.json"))
  assert.doesNotMatch(description, /continuation kernel/i)
  assert.match(description, /compiled/)
  const intro = read("README.md").split("\n## ")[0]
  assert.doesNotMatch(intro, /runtime: the one-shot continuation kernel/)
  assert.match(intro, /compiler imports/)
  assert.match(intro, /EK3501/)
})

// Each package README is the npm page for its release, so it states the alpha
// boundary and speaks only of things a package reader can run or look up.
const repo = new URL("../../", import.meta.url)
const readRepo = path => readFileSync(new URL(path, repo), "utf8")
const pages = ["packages/compiler/README.md", "packages/runtime/README.md"]

test("the compiler package page names the alpha, its opt-in and EK3013 before its first section", () => {
  const intro = readRepo("packages/compiler/README.md").split("\n## ")[0]
  assert.match(intro, /0\.0\.13 is the alpha/)
  assert.match(intro, /the 33 accepted VIPs numbered 1 to 41/)
  assert.ok(intro.includes('`"vibe": { "experimental": ["builtins"] }`'), "opt-in")
  assert.match(intro, /Without it the compiler reports `EK3013`/)
  assert.doesNotMatch(intro, /compile only with/)
  assert.ok(intro.includes("https://vibelang.sh/setup/alpha"), "alpha page link")
  assert.ok(intro.includes("https://github.com/smithersai/vibelang/issues/new/choose"), "bug link")
})

test("the package pages use no internal tool names, decision numbers or repository-only paths", () => {
  for (const path of pages) {
    const text = readRepo(path)
    for (const term of [/migrate flow/i, /opencode's/i, /\bD313\b/, /experiments\//, /prototype\/esc/]) {
      assert.doesNotMatch(text, term, path)
    }
  }
})

test("the runtime package page names one import path for generated code: the compiler's", () => {
  const emitted = readRepo("typescript/tsc/internal/vibelang/prelude.go").match(/const generatedRuntimeModule = "([^"]+)"/)[1]
  const text = read("README.md")
  assert.doesNotMatch(text, /Generated JavaScript can compose/)
  const claims = [...text.replace(/\s+/g, " ").matchAll(/(?:Code the `vibelang` compiler generates|[Gg]enerated (?:code|modules|JavaScript)) imports? (?:its |compiler )?helpers from `([^`]+)`/g)]
  assert.ok(claims.length >= 1, "the page says where generated code imports its helpers")
  for (const [, specifier] of claims) assert.equal(specifier, emitted)
})
