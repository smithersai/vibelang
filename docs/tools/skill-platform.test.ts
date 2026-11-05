import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const repo = resolve(import.meta.dir, "../..")
const read = (path: string) => readFileSync(join(repo, path), "utf8")
const skill = "packages/compiler/skills/vibelang/SKILL.md"

// Compare the documented bundles with their declared experimental service outputs.
const services = (platform: string) => {
  const source = read(`packages/runtime/src/experimental/platform-${platform.toLowerCase()}/Experimental${platform}Services.ts`)
  const declaration = source.split(`export type Experimental${platform}Services =`)[1]!.split("/**")[0]!
  return [...declaration.matchAll(/\|\s+(\w+)\.\1\b/g)].map(match => match[1]).sort()
}

const modules = (clause: string) => [...clause.matchAll(/`Experimental\.(\w+)`/g)].map(match => match[1]).sort()

// A .vibe file has no platform value imports (VIP-26, VIP-33): the entry
// provides a bundle, or the DNS layer separately.
test("skill: rule 2 names the experimental services and the layers that provide them", () => {
  const rules = read(skill).split("\n").filter(line => line.startsWith("2. "))
  expect(rules).toHaveLength(1)
  const rule = rules[0]!
  const clauses = rule.split("; ")
  for (const platform of ["Node", "Bun", "Browser"]) {
    const layer = `Experimental${platform}Services.layer`
    const clause = clauses.find(clause => clause.includes(`\`${layer}\``))!
    expect(clause, layer).toBeDefined()
    expect(modules(clause), layer).toEqual(services(platform))
    expect(read("docs/user/src/platform/platform-globals.md")).toContain(layer)
  }
  const pure = clauses.find(clause => clause.includes("pure"))!
  expect(modules(pure)).toEqual(["Encoding", "NetAddress"])
  expect(pure).toContain("`decodeBase64Lenient`")
  const dns = clauses.find(clause => clause.includes("`Experimental.Dns`"))!
  for (const detail of ["ExperimentalNodeDns.layer", "ExperimentalWorkerDns.layer", "authoritative answers", "typed `Unsupported`"]) {
    expect(dns).toContain(detail)
  }
  expect(rule).not.toContain("vibelang/platform/")
})
