import { expect, test } from "bun:test"
import fc from "fast-check"
import { checkProperty } from "../../scripts/testing/property.mjs"
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

// The service list follows pure or provides. A clause can include introductory
// sentences and later usage examples; neither extends that list.
// Keep duplicate entries inside the list visible to the catalog comparison.
const modules = (clause: string) => {
  const list = /\b(?:pure|provides)\s+(.*?)(?:\.\s|$)/su.exec(clause)?.[1] ?? ""
  return [...list.matchAll(/`Experimental\.(\w+)`/g)].map(match => match[1]).sort()
}

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

test("service list parsing ignores usage sentences while preserving duplicate list entries", () => {
  const clause = "`ExperimentalBrowserServices.layer` provides `Experimental.Window`. `Experimental.Window` uses `Experimental.Process` in an example."
  expect(modules(clause)).toEqual(["Window"])
  expect(modules("provides `Experimental.Window` and `Experimental.Window`. Usage.")).toEqual(["Window", "Window"])
})

test("usage mentions do not change the services a platform bundle documents", async () => {
  const platforms = ["Node", "Bun", "Browser", "Pure"] as const
  const expectedServices = (platform: typeof platforms[number]) => platform === "Pure" ? ["Encoding", "NetAddress"] : services(platform)
  const names = [...new Set(platforms.flatMap(expectedServices))]
  await checkProperty(fc, {
    name: "skill-platform-service-lists",
    regressions: new URL("./testdata/skill-platform-service-lists/", import.meta.url),
    rule: "Skill rule 2 lists the services each platform layer provides, separately from its usage explanations",
    command: "bun test docs/tools/skill-platform.test.ts",
    numRuns: 200,
    arbitrary: fc.record({
      platform: fc.constantFrom(...platforms),
      intro: fc.constantFrom("", "Platform access uses services. ", "An example mentions `Experimental.Window`. "),
      mentions: fc.array(fc.constantFrom(...names), { maxLength: 8 }),
      whitespace: fc.constantFrom(" ", "\n", "\t")
    }),
    check({ platform, mentions, whitespace, intro = "" }) {
      const expected = expectedServices(platform)
      const clause = (list: string[]) => {
        const prefix = platform === "Pure" ? "pure" : `\`Experimental${platform}Services.layer\` provides`
        return intro + prefix + " " + list.map(name => `\`Experimental.${name}\``).join(", ") + "." + whitespace
          + "Usage: " + mentions.map(name => `\`Experimental.${name}\``).join(" and ") + " can appear in examples."
      }
      expect(modules(clause(expected))).toEqual(expected)
      expect(modules(clause(expected.slice(1)))).not.toEqual(expected)
      expect(modules(clause([...expected, expected[0]!]))).not.toEqual(expected)
      expect(modules(clause([...expected, "UnlistedService"]))).not.toEqual(expected)
    }
  })
})
