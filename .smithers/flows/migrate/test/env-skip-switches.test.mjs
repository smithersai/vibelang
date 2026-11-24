// A test that skips unless an environment variable is set never runs in
// //packages:migrate-test, which sets none: the native compiler and the
// installed Vite, Rolldown and Oxlint are found in the tree instead. Each
// switch left here names the install the gate does not provision.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"

const unprovisioned = {
  VIBELANG_TOOLING_NODE_MODULES: "no lockfile in the tree installs @ast-grep/cli beside ESLint",
  VIBELANG_LINT_ORACLE_NODE_MODULES: "an ESLint, Oxlint and espree install outside the tree",
  VIBELANG_OXLINT_NODE_MODULES: "upstream Oxlint and ESLint installed together outside the tree",
  VIBELANG_UNUSED_ORACLE_NODE_MODULES: "an Oxlint install outside the tree",
  VIBELANG_VITE_ORACLE_MODULES: "a Vite install outside the tree",
  VIBELANG_LEGACY_BINARY: "a compiler built before the inference flip",
}

/** The environment variables a test file's skip conditions read, directly or through a constant with no fallback. */
export function skipSwitches(text) {
  const envOnly = new Map([...text.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*process\.env\.(\w+)\s*;?\s*$/gm)].map(m => [m[1], m[2]]))
  const names = new Set()
  for (const [, condition] of text.matchAll(/\bskip\s*:\s*([^}]*)/g)) {
    for (const [, name] of condition.matchAll(/process\.env\.(\w+)/g)) names.add(name)
    for (const [variable, name] of envOnly) if (new RegExp("\\b" + variable + "\\b").test(condition)) names.add(name)
  }
  return [...names].sort()
}

test("skipSwitches finds direct and constant environment switches, not fallbacks", () => {
  assert.deepEqual(skipSwitches('const c = process.env.FOO\ntest("a", { skip: !c && "set FOO" }, () => {})\n'), ["FOO"])
  assert.deepEqual(skipSwitches('test("a", { skip: !process.env.BAR }, () => {})\n'), ["BAR"])
  assert.deepEqual(skipSwitches('const oracle = { skip: process.env.BAZ !== "1" }\n'), ["BAZ"])
  assert.deepEqual(skipSwitches('const c = process.env.FOO || "/bin/c"\ntest("a", { skip: !c }, () => {})\n'), [])
})

test("every migrate test skip switch is one the gate cannot provision", () => {
  const directory = new URL("./", import.meta.url)
  const found = new Map()
  for (const file of readdirSync(directory).filter(file => file.endsWith(".test.mjs") && file !== "env-skip-switches.test.mjs").sort()) {
    for (const name of skipSwitches(readFileSync(new URL(file, directory), "utf8"))) found.set(name, [...(found.get(name) ?? []), file])
  }
  const unexplained = [...found].filter(([name]) => !Object.hasOwn(unprovisioned, name))
  assert.deepEqual(unexplained, [], "these tests never run in //packages:migrate-test: find the tool in the tree or name why it cannot be")
  assert.deepEqual(Object.keys(unprovisioned).filter(name => !found.has(name)), [], "retire the entry of a switch no test reads")
})
