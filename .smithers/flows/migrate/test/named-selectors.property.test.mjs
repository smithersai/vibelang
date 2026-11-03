// opencode-33: a tool that selects modules by a named glob finds nothing once a
// module is renamed, so the plan keeps those modules, and only those, as .ts.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { enumerates, namedSelectors } from "../lib/enumerations.mjs"
import { buildInventory } from "../lib/inventory.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-drizzle-source-globs.json", import.meta.url)))

test("opencode core: drizzle-kit's schema globs select session/sql.ts and schema.sql.ts, no other module", () => {
  const findings = namedSelectors(["drizzle.config.ts"], () => corpus.config)
  assert.deepEqual(findings.map(f => f.match), ["./src/**/*.sql.ts", "./src/**/sql.ts"])
  for (const file of corpus.selected) assert.ok(findings.some(f => enumerates(f, file)), file)
  for (const file of corpus.free) assert.ok(!findings.some(f => enumerates(f, file)), file)
})

test("opencode core: the inventory keeps a module a named glob selects", () => {
  const root = mkdtempSync(join(tmpdir(), "opencode-named-selector-"))
  try {
    const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
    put("package.json", "{}")
    put("drizzle.config.ts", corpus.config)
    put("src/session/sql.ts", 'import { Effect } from "effect"\nexport const t = Effect.void\n')
    put("src/session/session.ts", 'import { Effect } from "effect"\nexport const s = Effect.void\n')
    const inventory = buildInventory({ root, packages: [{ dir: ".", sources: ["src"] }] })
    const of = path => inventory.files.find(f => f.path === path)
    assert.match(of("src/session/sql.ts").enumeratedBy.join(), /drizzle\.config\.ts:\d+ selects modules by the named glob \.\/src\/\*\*\/sql\.ts/)
    assert.equal(of("src/session/session.ts").enumeratedBy, undefined)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const word = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/)
test("named-selectors: a name glob picks exact base names, a suffix glob picks dotted suffixes, test globs pick nothing", async () => {
  await checkProperty(fc, {
    name: "opencode-named-selectors",
    rule: "A named glob selects only the modules it names; a sidecar or a test glob selects none.",
    command: "node --test .smithers/flows/migrate/test/named-selectors.property.test.mjs",
    arbitrary: fc.record({ name: word, other: word, quote: fc.constantFrom('"', "'", "`") }).filter(({ name, other }) => name !== other && !["test", "spec", "d", "stories", "bench", "e2e"].includes(name)),
    numRuns: 200,
    check: ({ name, other, quote }) => {
    const exact = namedSelectors(["c.ts"], () => `x = [${quote}./src/**/${name}.ts${quote}]`)
    assert.equal(exact.length, 1)
    assert.ok(enumerates(exact[0], `src/a/${name}.ts`))
    assert.ok(!enumerates(exact[0], `src/a/${other}.ts`))
    assert.ok(!enumerates(exact[0], `src/a/${name}.d.vibe.ts`))
    assert.ok(!enumerates(exact[0], `lib/${name}.ts`))
    const suffix = namedSelectors(["c.ts"], () => `x = [${quote}./src/**/*.${name}.ts${quote}]`)
    assert.ok(enumerates(suffix[0], `src/a/${other}.${name}.ts`))
    assert.ok(!enumerates(suffix[0], `src/a/${name}.ts`))
    assert.deepEqual(namedSelectors(["c.ts"], () => `x = ${quote}./src/**/*.test.ts${quote}`), [])
    assert.deepEqual(namedSelectors(["c.ts"], () => `x = ${quote}./src/**/*.ts${quote}`), [])
    }
  })
})
