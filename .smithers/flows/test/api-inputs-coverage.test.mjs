import test from "node:test"
import { assert, existsSync, globSync, readFileSync, readdirSync, statSync, dirname, join, matchesGlob, relative, repo } from "./api-inputs-fixture.mjs"

test("current API entrypoints, imports, corpus and specification reads remain covered", async () => {
  const { apiInputPatterns } = await import("../../../api-inputs.ts")
  const covered = path => path.startsWith("packages/") || apiInputPatterns.some(pattern => matchesGlob(path, pattern))
  const visited = new Set()
  function inspect(file) {
    if (visited.has(file)) return
    visited.add(file)
    assert.ok(covered(file), "declare the API read input " + file)
    const text = readFileSync(join(repo, file), "utf8")
    for (const match of text.matchAll(/(?:from\s*|import\s*\(|new URL\s*\()\s*["'](\.[^"']+)["']/g)) {
      const resolved = relative(repo, join(dirname(join(repo, file)), match[1]))
      if (!existsSync(join(repo, resolved)) || !statSync(join(repo, resolved)).isFile()) continue
      assert.ok(covered(resolved), "declare relative API input " + resolved)
      if (resolved.endsWith(".mjs")) inspect(resolved)
    }
    for (const match of text.matchAll(/SpecPath\(["']([^"']+)["']\)/g))
      assert.ok(covered("docs/design/src/" + match[1]), "declare specification lookup " + match[1])
  }
  for (const name of readdirSync(join(repo, "scripts")))
    if (/^api-identity.*\.mjs$/.test(name)) inspect("scripts/" + name)
  inspect("scripts/sync-api-identity.mjs")
  for (const file of globSync("scripts/api-identity-corpus/**/*.json", { cwd: repo })) {
    const corpus = JSON.parse(readFileSync(join(repo, file), "utf8"))
    if (typeof corpus.spec === "string")
      assert.ok(covered(corpus.spec.split("#")[0]), "declare corpus specification read " + corpus.spec)
  }
  assert.ok(visited.size >= 20, "audit actual API files, not an empty selection")
})
