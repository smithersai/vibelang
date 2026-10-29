import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { capture, checkBuild, combinations, diagnostics, failureDiagnostics, fixture, managers, pins, prepareBuilds, root, run, savedFiles, scaffold, tree } from "./options-build.mjs"

const regressions = new URL("./property-regressions/", import.meta.url)
const pending = readdirSync(regressions).filter(file => file.endsWith(".json"))
  .map(file => JSON.parse(readFileSync(new URL(file, regressions)))).filter(input => input.knownFailure)
const guide = "docs/user/src/setup/new-project.md: 1. Create the project"
const tooling = "docs/design/history/src/428-part4-ch28-tooling.md: Packages and versions, Building and testing"
const command = "node --test test/create.property.test.mjs"
const propertyEnv = { ...process.env, FC_ARTIFACT_DIR: process.env.FC_ARTIFACT_DIR || join(root, ".cache/property-failures/S1") }
// Construct portable directory components; no slash/NUL, traversal, or real commands.
const names = fc.array(fc.constantFrom("a", "Z", "0", " ", "雪", "é", "😀", "'", '"', "$", "`", ";", "&", "(", ")", "#", "%"),
  { minLength: 0, maxLength: 5 }).map(parts => "app" + parts.join(""))
const options = fc.record({ source: fc.constantFrom("checkout", "packed"), manager: fc.constantFrom(...managers),
  noInstall: fc.boolean(), noGit: fc.boolean(), state: fc.constantFrom("new", "empty", "nonempty"),
  outcome: fc.constantFrom(0, 42, "missing"), name: names, sentinel: fc.uint8Array({ maxLength: 24 }) })
  .map(input => ({ ...input, sentinel: Array.from(input.sentinel) }))

function fakeInstaller(directory, input) {
  const bin = join(directory, "bin"), record = join(directory, "install.json")
  mkdirSync(bin)
  if (input.outcome !== "missing") writeFileSync(join(bin, input.manager), `#!${process.execPath}
import { existsSync, readFileSync, writeFileSync } from "node:fs"
writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(),
  ready: existsSync("src/main.vibe"), manifest: JSON.parse(readFileSync("package.json")) }))
process.exit(${input.outcome})
`, { mode: 0o755 })
  // No host-manager fallback: "missing" must really be absent.
  return { record, env: { PATH: bin } }
}

function checkCreate(f, input) {
  const directory = mkdtempSync(join(f.directory, "cli-")), app = join(directory, input.name)
  try {
    const installer = fakeInstaller(directory, input)
    if (input.state !== "new") mkdirSync(app)
    if (input.state === "nonempty") {
      mkdirSync(join(app, "nested"))
      writeFileSync(join(app, "nested/sentinel"), Buffer.from(input.sentinel))
      writeFileSync(join(app, ".hidden"), "preserve")
    }
    const before = input.state === "nonempty" ? tree(app, false) : null
    const created = scaffold(f, input, directory, { ...f.env, ...installer.env })
    if (before) {
      // User guide §1: refusal must preserve the whole sentinel tree.
      assert.notEqual(created.status, 0, created.output)
      assert.deepEqual(tree(app, false), before)
      assert.deepEqual([...readFileSync(join(app, "nested/sentinel"))], input.sentinel)
      assert.ok(!existsSync(installer.record))
      return
    }
    pins(app)
    assert.ok(!existsSync(join(app, ".git"))) // §1: never initializes a repository.
    const called = !input.noInstall && input.outcome !== "missing"
    assert.equal(existsSync(installer.record), called)
    if (called) {
      const installed = JSON.parse(readFileSync(installer.record))
      assert.equal(installed.argv[0], "install")
      assert.equal(installed.cwd, resolve(app))
      assert.ok(installed.ready)
      assert.deepEqual(installed.manifest, JSON.parse(readFileSync(join(app, "package.json"))))
    }
    if (!input.noInstall && input.outcome !== 0) {
      // Metamorphic: a failed/unavailable installer cannot yield CLI success;
      // the same scaffold must remain usable after an explicit successful install.
      assert.notEqual(created.status, 0, created.output)
    } else {
      assert.equal(created.status, 0, created.output)
      const cd = created.stdout.split("\n").find(line => line.startsWith("  cd "))
      assert.ok(cd, "missing next-step directory command")
      const reached = run("/bin/sh", ["-c", `${cd}\nexec "$1" -p 'JSON.stringify(process.cwd())'`, "sh", process.execPath], directory, f.env, "printed cd")
      assert.equal(reached.status, 0, reached.output)
      assert.equal(JSON.parse(reached.stdout), resolve(app))
      assert.ok(created.stdout.includes(`${input.manager} run start`))
    }
    // Metamorphic: --no-install and no-op --no-git preserve project content;
    // explicit installation after skipping must see the same pinned manifest.
    const other = mkdtempSync(join(f.directory, "equivalent-")), otherApp = join(other, input.name)
    try {
      const result = scaffold(f, { ...input, source: input.source === "packed" ? "checkout" : "packed", noInstall: true, noGit: !input.noGit }, other, f.env)
      assert.equal(result.status, 0, result.output)
      assert.deepEqual(tree(app), tree(otherApp))
      const successful = { ...input, outcome: 0 }, retry = fakeInstaller(other, successful)
      const installed = run(join(other, "bin", input.manager), ["install"], otherApp, f.env, "explicit fake install")
      assert.equal(installed.status, 0, installed.output)
      assert.deepEqual(JSON.parse(readFileSync(retry.record)).manifest, JSON.parse(readFileSync(join(app, "package.json"))))
    } finally { rmSync(other, { recursive: true, force: true }) }
  } catch (error) { capture(app, error); throw error }
  finally { rmSync(directory, { recursive: true, force: true }) }
}

for (const matrix of [true, false]) test(matrix ? "scaffold-option-matrix" : "scaffold-options", async () => {
  const name = matrix ? "scaffold-option-matrix" : "scaffold-options"
  if (process.env.FC_PROPERTY && process.env.FC_PROPERTY !== name) return
  const f = fixture()
  try {
    // §1 + Chapter 28: enumerate all switches cheaply, then shrink generated
    // names, target states and installer outcomes independently of that matrix.
    await checkProperty(fc, { name, rule: `${guide}; ${tooling}; metamorphic install/no-git equivalence`, command, regressions,
      arbitrary: matrix ? fc.constant(null) : options, numRuns: matrix ? 1 : 50,
      env: matrix ? { ...propertyEnv, FC_RUNS: undefined } : propertyEnv,
      check: input => matrix ? combinations.forEach(option => checkCreate(f, {
        ...option, name: "app 雪 '$;", outcome: 0, sentinel: []
      })) : checkCreate(f, input),
      artifacts: () => savedFiles, diagnostics: () => failureDiagnostics || diagnostics })
  } finally { f.cleanup() }
})

test("scaffold-builds", async () => {
  if (process.env.FC_PROPERTY && !process.env.FC_PROPERTY.startsWith("scaffold-builds-")) return
  const all = process.env.FC_SCAFFOLD_ALL === "1"
  const selected = all ? combinations : [combinations[0], combinations.find(input =>
    input.manager === "bun" && input.source === "packed" && input.noInstall && input.noGit && input.state === "empty")]
  const f = fixture()
  try {
    const prepared = prepareBuilds(f, selected)
    const failures = []
    // docs/user/src/setup/new-project.md §§1–3; Chapter 28's --noEmit/build/test
    // contract. Nightly enumerates every combination.
    for (const option of selected) try {
      const name = `scaffold-builds-${option.source}-${option.manager}-${Number(option.noInstall)}${Number(option.noGit)}-${option.state}`
      const cases = pending.filter(input => input.property === name), observed = new Map()
      // Pending finite matrix cases execute through saved-input replay. Removing
      // knownFailure restores discovery; each individual case fails on XPASS.
      const arbitrary = cases.some(input => input.matrixCase) ? fc.constant(null)
        : fc.constantFrom(...(option.noInstall ? ["app 雪 '$;", "app 雪 space"] : ["app", "app space"]))
          .map(name => ({ ...option, name }))
      await checkProperty(fc, {
        name,
        rule: `${guide}, 2. Build and run, 3. Run the tests; ${tooling}`,
        command: `${all ? "FC_SCAFFOLD_ALL=1 " : ""}${command}`, regressions, numRuns: 1,
        env: all ? { ...propertyEnv, FC_RUNS: undefined } : propertyEnv,
        // Directory fuzzing runs above; builds enumerate switches with plain and
        // Unicode/space/shell paths. The saved # regression replays before discovery.
        arbitrary, check: input => {
          if (input === null) return
          try { checkBuild(f, prepared, input) } catch (error) {
            for (const saved of cases) if (Object.entries(saved.input).every(([key, value]) => input[key] === value)) observed.set(saved, error.message)
            throw error
          }
        }, artifacts: () => savedFiles, diagnostics: () => failureDiagnostics || diagnostics
      })
      if (!process.env.FC_PROPERTY || process.env.FC_PROPERTY === name) {
        for (const saved of cases) if (saved.errorPattern) assert.match(observed.get(saved) || "", new RegExp(saved.errorPattern))
      }
    } catch (error) { failures.push(error) }
    if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join("\n"))
  } finally { f.cleanup() }
})
