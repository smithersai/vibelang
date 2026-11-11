import assert from "node:assert/strict"
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import * as apiInputs from "../api-inputs.ts"
import * as buildContractInputs from "../build-contract-inputs.ts"
import { declarationTargets } from "./testing/package-declaration.mjs"

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8")
const consumers = ["forms-generator", "native-output", "fuzz-hangs-target", "spec-progress-target"]

for (const name of consumers) test(name + " uses the shared declaration context", () => {
  const source = read("scripts/" + name + ".test.mjs")
  assert.match(source, /import \{ declaration(?:Targets|Fixture) \} from "\.\/testing\/package-declaration\.mjs"/)
  assert.doesNotMatch(source, /stripTypeScriptTypes|runInNewContext|createApiIdentityInputs|createBuildContractInputs/,
    "production helper bindings and VM adaptation belong to the shared context")
})

test("the shared context binds the actual production input helpers and suite inventory", () => {
  const targets = declarationTargets("PACKAGE.ts", { source: `
import { createApiIdentityInputs } from "./api-inputs.ts"
import { buildContractSuites, createBuildContractInputs } from "./build-contract-inputs.ts"
export const Package = S.Package({ targets: { createApiIdentityInputs, buildContractSuites, createBuildContractInputs } })
` })
  assert.equal(targets.createApiIdentityInputs, apiInputs.createApiIdentityInputs)
  assert.equal(targets.createBuildContractInputs, buildContractInputs.createBuildContractInputs)
  assert.equal(targets.buildContractSuites, buildContractInputs.buildContractSuites)
})

for (const name of ["createApiIdentityInputs", "createBuildContractInputs", "buildContractSuites"]) {
  test("a missing production binding is diagnosed while loading the real root: " + name, () => {
    assert.throws(() => declarationTargets("PACKAGE.ts", { bindings: { [name]: undefined } }),
      { message: "PACKAGE.ts: fixture has no binding for imported " + name })
  })
}

test("real declarations retain caller dependency identities and isolated environments", () => {
  const native = {}, forms = {}, compiler = {}
  const ts = declarationTargets("typescript/PACKAGE.ts", { bindings: { Tsc: { "native-srcs": native } } })
  for (const name of ["compiler", "forms-generator", "mapper"]) assert.ok(ts[name].data.includes(native))
  const root = declarationTargets("PACKAGE.ts", {
    env: { VIBELANG_FUZZ_BUDGET_LOG: "budget with spaces.tsv" },
    bindings: { Typescript: { "forms-generator": forms }, Packages: { "compiler-native": compiler } }
  })
  assert.ok(root.forms.data.includes(forms))
  assert.ok(root.release.data.includes(compiler))
  assert.equal(root["go-vibelangfuzz"].env.VIBELANG_FUZZ_BUDGET_LOG, "budget with spaces.tsv")
  assert.equal(declarationTargets("PACKAGE.ts")["go-vibelangfuzz"].env.VIBELANG_FUZZ_BUDGET_LOG, "")
})


// A new export in either production helper must reach every real consumer
// without adding another hand-maintained list of VM bindings.
for (const module of ["api-inputs.ts", "build-contract-inputs.ts"]) {
  for (const binding of ["nextInput", "next_inventory2", "nextInputÉ"]) {
    test(module + " adds " + binding + " without changing consumer contexts", t => {
      const root = mkdtempSync(join(tmpdir(), "declaration-export-"))
      t.after(() => rmSync(root, { recursive: true, force: true }))
      const files = [
        "PACKAGE.ts", "typescript/PACKAGE.ts", "packages/PACKAGE.ts",
        "api-inputs.ts", "build-contract-inputs.ts", "scripts/testing/package-declaration.mjs",
        ...consumers.map(name => "scripts/" + name + ".test.mjs"),
        "scripts/build-vibelang.sh", "scripts/native-output.sh",
        "packages/compiler/test/eslint/run.sh", "packages/vite/test/run.sh",
        "packages/unplugin/test/run.sh", "typescript/vibelang/smoke.sh",
        "typescript/vibelang/lsp-smoke.sh", "packages/ts-mapper/test/e2e.sh",
        "packages/test-inventory.json", "packages/test-groups.json", "packages/test-batches.json", "scripts/testing/node-selection.mjs"
      ]
      for (const file of files) {
        mkdirSync(dirname(join(root, file)), { recursive: true })
        copyFileSync(new URL("../" + file, import.meta.url), join(root, file))
      }
      writeFileSync(join(root, module), read(module) + "\nexport const " + binding + " = 7\n")
      writeFileSync(join(root, "PACKAGE.ts"),
        'import { ' + binding + ' } from "./' + module + '"\n' +
        read("PACKAGE.ts") + '\nif (' + binding + ' !== 7) throw new Error("missing helper export")\n')
      const env = { ...process.env }
      delete env.NODE_TEST_CONTEXT
      const pattern = "^(the forms check declares|release declares|the pending merge gate|the spec gate reports)"
      const result = spawnSync(process.execPath, [
        "--test", "--test-reporter=tap", "--test-name-pattern=" + pattern,
        ...consumers.map(name => join(root, "scripts/" + name + ".test.mjs"))
      ], { cwd: root, env, encoding: "utf8", timeout: 30000 })
      assert.ifError(result.error)
      assert.equal(result.status, 0, result.stdout + result.stderr)
      assert.match(result.stdout, /^# pass 4$/m, "all four actual consumers must execute")
      assert.match(result.stdout, /^# fail 0$/m)
    })
  }
}
