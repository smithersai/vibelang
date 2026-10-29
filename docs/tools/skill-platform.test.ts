import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const repo = resolve(import.meta.dir, "../..")
const skill = "packages/compiler/skills/vibelang/SKILL.md"

// The experimental services VibeLang adds for what Effect lacks (D313).
const services = ["Crypto", "FileSystem", "Locks", "Process"]

// The experimental modules a clause of the skill names, such as `Experimental.Process`.
const modules = (clause: string) => [...clause.matchAll(/`Experimental\.(\w+)`/g)].map(m => m[1]).sort()

// Rule 2 of the shipped skill names each experimental service and the layer
// that provides it, as the platform globals page does. A .vibe file has no
// platform imports (VIP-26, VIP-33): the entry provides the layer.
test("skill: rule 2 names the experimental services and the layers that provide them", () => {
  const text = readFileSync(join(repo, skill), "utf8")
  const rule = text.split("\n").find(line => line.startsWith("2. "))
  expect(rule).toBeDefined()
  expect(modules(rule!)).toEqual(services)
  for (const layer of ["ExperimentalNodeServices.layer", "ExperimentalBrowserServices.layer"]) {
    expect(rule).toContain(layer)
    expect(readFileSync(join(repo, "docs/user/src/platform/platform-globals.md"), "utf8")).toContain(layer)
  }
  expect(rule).not.toContain("vibelang/platform/")
})
