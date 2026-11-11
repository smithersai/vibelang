// The migrate flow is being rewritten in VibeLang, one module at a time.
// conversion.json lists the modules that are .vibe files, one per line, so the
// count is in the repository and two conversions landing together do not edit
// the same line. This test keeps the list equal to the tree: a module that
// becomes .vibe joins the list in the same change, and its JavaScript or
// TypeScript file goes. Run it to read the count:
//
//   node --test .smithers/flows/migrate/test/conversion.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const flow = fileURLToPath(new URL("..", import.meta.url))
const source = /\.(?:mjs|mts|ts|vibe)$/

// modules lists the flow's own source modules, relative to the flow: its
// top-level files and lib/, without the code lib/vendor copies from others.
export function modules(directory) {
  const files = (at) => readdirSync(path.join(directory, at), { withFileTypes: true }).flatMap((entry) => {
    const name = path.posix.join(at, entry.name)
    if (entry.isDirectory()) return name === "lib/vendor" ? [] : files(name)
    return source.test(entry.name) ? [name] : []
  })
  return [...readdirSync(directory).filter((name) => source.test(name)), ...files("lib")].sort()
}

// census counts a list of modules: the .vibe ones, the ones still to convert,
// and each .vibe module whose earlier JavaScript or TypeScript file remains.
export function census(names) {
  const stem = (name) => name.replace(source, "")
  const converted = names.filter((name) => name.endsWith(".vibe"))
  const remaining = names.filter((name) => !name.endsWith(".vibe"))
  const stems = new Set(remaining.map(stem))
  return { converted, remaining, twins: converted.filter((name) => stems.has(stem(name))) }
}

test("census separates .vibe modules from the rest and finds a converted module whose old file remains", () => {
  assert.deepEqual(census(["flow.ts", "lib/plan.vibe", "lib/steps.mjs", "lib/util.mjs", "lib/util.vibe"]), {
    converted: ["lib/plan.vibe", "lib/util.vibe"],
    remaining: ["flow.ts", "lib/steps.mjs", "lib/util.mjs"],
    twins: ["lib/util.vibe"]
  })
})

test("conversion.json lists exactly the migrate flow's .vibe modules", (t) => {
  const { converted, remaining, twins } = census(modules(flow))
  const tracked = JSON.parse(readFileSync(path.join(flow, "conversion.json"), "utf8")).converted
  assert.deepEqual(tracked, converted, "conversion.json lists each .vibe module of the flow, sorted, and nothing else")
  assert.deepEqual(twins, [], "a converted module leaves no JavaScript or TypeScript file of the same name")
  t.diagnostic(`${converted.length} of ${converted.length + remaining.length} migrate flow modules are VibeLang`)
})
