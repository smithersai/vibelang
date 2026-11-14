import { test } from "bun:test"
import fc from "fast-check"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")

for (const subpath of Object.keys(manifest.exports)) {
  const specifier = subpath === "." ? manifest.name : manifest.name + subpath.slice(1)
  test(`README names the package export ${specifier}`, () => {
    assert.ok(readme.includes(`\`${specifier}\``), `Document ${specifier} in README.md`)
  })
}


const specifiers = Object.keys(manifest.exports).map(subpath =>
  subpath === "." ? manifest.name : manifest.name + subpath.slice(1))
const missing = (text: string) => specifiers.filter(specifier => !text.includes("`" + specifier + "`"))

test("README export audit rejects omissions and prefix collisions", () => {
  assert.deepEqual(missing(readme), [])
  const retained = JSON.parse(readFileSync(new URL("./readme-export-regressions/experimental-companions.json", import.meta.url), "utf8"))
  for (const specifier of retained) {
    assert.ok(specifiers.includes(specifier))
    assert.deepEqual(missing(readme.replaceAll("`" + specifier + "`", "")), [specifier])
  }
  fc.assert(fc.property(fc.constantFrom(...specifiers), fc.integer({min: 0, max: 100000}), (specifier, suffix) => {
    const quoted = "`" + specifier + "`"
    const mutated = readme.replaceAll(quoted, "`" + specifier + "/child" + suffix + "`")
    assert.deepEqual(missing(mutated), [specifier])
  }), {seed: 74173, numRuns: 200})
})

test("README never tells a user to run vibelang --fix", () => {
  // The README is the npm package page. The compiler has no --fix option (TS5023), so
  // the page must not send a user to it.
  assert.doesNotMatch(readme, /vibelang(?:\s+[^\s`|]+)*\s+--fix\b/)
})

// The README is the npm package page, frozen with each release. It must tell a
// reader which exports are the core alpha and which come from open proposals
// (VIPs 55 to 73, docs/design/vips/README.md), and how to opt in to the second.
const section = (heading: string) => {
  const start = readme.indexOf("\n" + heading + "\n")
  assert.ok(start >= 0, heading)
  const next = readme.slice(start + heading.length + 2).search(/^#{1,3} /m)
  return readme.slice(start, next < 0 ? undefined : start + heading.length + 2 + next)
}
const openModules = ["Human", "Fuzz", "FuzzSimulation", "Durable", "Eval", "Test", "Memory", "Scorer", "Patterns"]

test("README separates the core platform modules from the open-proposal modules", () => {
  const core = section("## Experimental platform APIs")
  const open = section("### Open-proposal modules (opt-in)")
  for (const name of openModules) {
    const row = "| `vibelang-runtime/experimental/" + name + "` |"
    assert.ok(open.includes(row), name + " is listed as an open-proposal module")
    assert.ok(!core.includes(row), name + " is not listed with the core platform modules")
  }
  assert.match(core, /VIP-33's platform additions, part of the core alpha; they\s+need no opt-in/)
})

test("README shows the experimental opt-in and marks the VIP-55 exports", () => {
  const alpha = section("## What is in the alpha")
  assert.ok(alpha.includes('{ "vibe": { "experimental": ["builtins"] } }'))
  assert.ok(alpha.includes("`EK3013`"))
  for (const name of openModules) assert.ok(alpha.includes("`" + name + "`"), name)
  for (const helper of ["$task", "$workflow"]) {
    assert.match(readme, new RegExp("^\\| `\\" + helper + "` \\|.*\\| VIP-55 \\(open, experimental\\) \\|$", "m"))
  }
})

test("README names the module generated code imports, as the compiler emits it", () => {
  const prelude = readFileSync(new URL("../../../typescript/tsc/internal/vibelang/prelude.go", import.meta.url), "utf8")
  const generated = /const generatedRuntimeModule = "([^"]+)"/.exec(prelude)?.[1]
  assert.equal(generated, "vibelang-runtime/internal")
  const claims = [...readme.matchAll(/(?:Generated (?:code|modules)|Code the `vibelang` compiler generates)[^.]*?`(vibelang-runtime[^`]*)`/g)].map(m => m[1])
  assert.ok(claims.length >= 2, String(claims))
  assert.deepEqual([...new Set(claims)], [generated])
  assert.match(section("## Fast calls without types"), /\*\*Prototype\.\*\*/)
})
