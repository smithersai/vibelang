import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { cacheProject, native, skip } from "./cache-harness.mjs"

// D297: the checker gives a workspace package's .vibe source the settings of
// that package's own config, found as `vibelang -p <directory>` finds it:
// vibe.config.json, else tsconfig.json, else jsconfig.json. A loader's cached
// compile of a project that reads such a source must miss when that config
// changes, and only then.
const options = {
  target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true,
  noEmit: true, allowImportingTsExtensions: true
}

function fixture(t, name) {
  const project = cacheProject(t, {
    "package.json": '{"type":"module"}',
    "src/main.ts": 'import { greeting } from "@acme/dep"\nexport const shout: string = greeting().toUpperCase()\n',
    "../dep/package.json": JSON.stringify({ name: "@acme/dep", type: "module", exports: { ".": "./src/greeting.vibe" } }),
    "../dep/src/text.ts": 'export const text = (): string | undefined => "hi"\n',
    "../dep/src/greeting.vibe": 'import { text } from "./text.ts"\n\nexport function greeting(): string {\n  return text()\n}\n',
    [`../dep/${name}`]: JSON.stringify({ compilerOptions: { ...options, strictNullChecks: false } }),
    // A canonical config wins over another config in the same directory.
    ...(name === "vibe.config.json" ? { "../dep/tsconfig.json": JSON.stringify({ compilerOptions: options }) } : {})
  }, { include: ["src"], compilerOptions: options }, { loader: true })
  mkdirSync(join(project.app, "node_modules/@acme"), { recursive: true })
  symlinkSync(join(project.root, "dep"), join(project.app, "node_modules/@acme/dep"))
  const dep = join(project.root, "dep")
  // The package's own compile, which shows which config the compiler applies.
  const checkDep = () => spawnSync(native, ["-p", dep, "--pretty", "false"], { cwd: dep, encoding: "utf8" }).status
  return { ...project, dep, checkDep }
}

for (const name of ["vibe.config.json", "tsconfig.json", "jsconfig.json"]) {
  test(`foreign ${name} changes invalidate cached compilation`, { skip }, async (t) => {
    const project = fixture(t, name)
    await project.settle()
    assert.equal(project.checkDep(), 0, `the compiler applies ${name}'s strictNullChecks: false`)
    const cold = project.compile()
    assert.deepEqual(cold.result.errors, [])
    assert.equal(project.compile().compiled, false, "warm entry exists")
    writeFileSync(join(project.dep, name), JSON.stringify({ compilerOptions: options }))
    assert.equal(project.checkDep(), 2, `the compiler reads the edited ${name}`)
    const warm = project.compile()
    assert.ok(warm.compiled, `${name} change must invalidate foreign source settings`)
    assert.match(warm.messages.join("\n"), new RegExp(`dep/${name.replaceAll(".", "\\.")} changed`))
  })
}

test("a tsconfig.json shadowed by vibe.config.json does not invalidate cached compilation", { skip }, async (t) => {
  const project = fixture(t, "vibe.config.json")
  await project.settle()
  assert.equal(project.compile().compiled, true)
  writeFileSync(join(project.dep, "tsconfig.json"), JSON.stringify({ compilerOptions: options, files: ["missing.ts"] }))
  assert.equal(project.checkDep(), 0, "the compiler still applies vibe.config.json alone")
  const warm = project.compile()
  assert.equal(warm.compiled, false, "needless recompile: " + warm.messages.join("\n"))
})
