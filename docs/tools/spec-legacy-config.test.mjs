import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const read = path => readFileSync(resolve(repo, path), "utf8")
const tooling = read("docs/design/src/007-tooling.md")
const tick = String.fromCharCode(96)
const legacy = tooling.split("### Legacy severity maps\n")[1]?.split("\n## ")[0]

test("legacy configuration defines admission, precedence and warning suppression separately", () => {
  assert.ok(legacy, "missing legacy severity contract")
  for (const path of ["vibelang.diagnostics", "compilerOptions.vibelang.diagnostics",
    "vibe.config.json", "tsconfig.json", "jsconfig.json"]) {
    assert.ok(legacy.includes(tick + path + tick), "missing legacy location " + path)
  }
  assert.match(legacy, /supported legacy setting still controls its legacy diagnostic/)
  assert.match(legacy, /modern.*same diagnostic or.*explicitly mapped port/)
  assert.match(legacy, /replacement and inheritance behavior/)
  assert.match(legacy, /explicit child legacy section replaces.*as a whole/)
  assert.match(legacy, /empty object or.*null.*clears/)
  assert.match(legacy, /suggestion.*not a legacy one/)
  assert.match(legacy, /EK0801.*not valid in a legacy map/)
  assert.match(legacy, /newly assigned release errors cannot be disabled/)
  assert.match(legacy, /off.*hides only this warning/)
  assert.match(legacy, /does not validate, migrate or disable/)
  assert.match(legacy, /TS5023/)
})

test("legacy examples distinguish a retained setting from its migration warning", () => {
  const examples = [...(legacy ?? "").matchAll(/```jsonc\n([\s\S]*?)```/g)]
    .flatMap(match => match[1].split("\n").filter(line => line.trim().startsWith("{")).map(line => JSON.parse(line.replace(/\/\*[\s\S]*?\*\//g, ""))))
  assert.ok(examples.some(config => config.vibelang?.diagnostics?.EK4801 === "off"
    && config.vibe?.severities?.EK3009 === "off"), "missing retained-map / hidden-warning control")
  assert.ok(examples.some(config => config.vibelang?.diagnostics?.EK4801 === "off"
    && config.vibe?.severities?.EK3801 === "error"), "missing explicit modern port precedence")
  assert.ok(examples.some(config => config.compilerOptions?.vibelang?.diagnostics?.EK4801 === "warning"),
    "missing legacy compilerOptions control")
})

test("all own release warnings appear in the configurable-warning table", () => {
  const table = tooling.split("| Warning | Code | Suggested fix |")[1]?.split("\n\n")[0] ?? ""
  const listed = [...table.matchAll(/\| .+ \| `(EK\d+)` \|/g)].map(match => match[1])
  assert.deepEqual(listed.sort(), ["EK0508", "EK0703", "EK0801", "EK3009", "EK4609", "EK4610"])
})

test("VIP, catalog and both user references identify both supported legacy paths", () => {
  for (const path of ["docs/design/vips/0030-config-files.md", "docs/design/src/900-appendices.md",
    "docs/user/src/setup/vibelang-cli.md", "docs/user/src/getting-started/012-devtools.md"]) {
    const text = read(path)
    assert.ok(text.includes(tick + "vibelang.diagnostics" + tick), path)
    assert.ok(text.includes(tick + "compilerOptions.vibelang.diagnostics" + tick), path)
  }
  assert.match(read("docs/design/vips/0030-config-files.md"), /preserving JSONC comments/)
  assert.match(read("docs/user/src/setup/vibelang-cli.md"), /supported legacy settings keep applying/)
})

const compiler = process.env.VIBELANG_BINARY
  ?? resolve(repo, "packages/compiler/native", process.platform === "win32" ? "vibelang.exe" : "vibelang")

test("supported legacy settings stay active and the explicit modern port wins", { skip: !existsSync(compiler), timeout: 60000 }, () => {
  const fixture = mkdtempSync(resolve(repo, "docs/tools/.legacy-config-"))
  try {
    symlinkSync(process.env.EFFECT_NODE_MODULES ?? resolve(repo, "docs/tools/node_modules"),
      resolve(fixture, "node_modules"), "dir")
    writeFileSync(resolve(fixture, "package.json"), '{"type":"module"}')
    writeFileSync(resolve(fixture, "main.vibe"),
      'import { Effect } from "effect"\nexport function floating(program: Effect.Effect<number>) { program; return 1 }\n')
    for (const [legacyCode, legacyValue, modern, expected, category] of [
      ["EK4801", "error", {}, 1, "error"],
      ["EK4801", "off", {}, 0, undefined],
      ["EK4801", "off", { EK3801: "error" }, 1, "error"],
      ["EK0801", "off", {}, 1, undefined]
    ]) {
      writeFileSync(resolve(fixture, "tsconfig.json"), JSON.stringify({
        compilerOptions: { strict: true, skipLibCheck: true, module: "nodenext",
          target: "es2022", types: [], noEmit: true },
        files: ["main.vibe"],
        vibelang: { diagnostics: { [legacyCode]: legacyValue } },
        vibe: { effectGlobals: false, effectModules: false, severities: { EK3009: "off", ...modern } }
      }))
      const result = spawnSync(compiler, ["-p", resolve(fixture, "tsconfig.json"), "--pretty", "false"],
        { encoding: "utf8", timeout: 30000 })
      const output = result.stdout + result.stderr
      assert.equal(result.error, undefined, String(result.error))
      assert.equal(result.signal, null, output)
      assert.equal(result.status === 0, expected === 0, output)
      assert.ok(!output.includes("EK3009"), output)
      if (legacyCode === "EK0801") assert.match(output, /TS5023.*EK0801 is not adjustable/)
      else {
        const categories = [...output.matchAll(/(error|warning) EK(?:4801|3801)(?: floatingEffect)?:/g)].map(match => match[1])
        assert.deepEqual(categories, category ? [category] : [], output)
      }
    }
  } finally { rmSync(fixture, { recursive: true, force: true }) }
})
