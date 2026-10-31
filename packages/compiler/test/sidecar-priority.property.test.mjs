import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const corpus = new URL("./property-regressions/", import.meta.url)
const rule = 'VIP-27; docs/design/src/007-tooling.md: "VibeLang uses the source"; paired compatibility suffixes must not substitute stale declarations for it'
let diagnostics = ""

test("sidecar source-priority oracle quotes the current specification", () => {
  const chapter = readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8")
  assert.ok(chapter.includes("VibeLang uses the source"))
})

function filesOf(input) {
  const stem = input.kind === "directory" ? "src/part/index" : "src/part"
  const suffix = input.native ? ".native" : ""
  const source = stem + suffix
  const specifier = input.kind === "js" ? "./part.js" : input.kind === "vibe" ? "./part.vibe" : "./part"
  const chosen = input.kind === "vibe" || input.sibling === "none" ? "number" : JSON.stringify(input.sibling)
  const original = input.native ? (input.fallback === false ? [".native"] : [".native", ""]) : [""]
  const options = {
    target: "ES2022", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve",
    strict: true, noEmit: true, types: [], skipLibCheck: true, allowArbitraryExtensions: true, allowImportingTsExtensions: true
  }
  return {
    "src/main.ts": "export * as Runtime from " + JSON.stringify(specifier) + "\nimport { value } from " + JSON.stringify(specifier) + "\nexport const checked: " + chosen + " = value\n",
    [source + ".vibe"]: "export const value: number = 42\n",
    [source + ".d.vibe.ts"]: 'export declare const value: "stale"\n',
    ...(input.sibling === "none" ? {} : {
      [source + "." + input.sibling]: "export const value: " + JSON.stringify(input.sibling) + " = " + JSON.stringify(input.sibling) + "\n"
    }),
    "tsconfig.original.json": JSON.stringify({
      compilerOptions: { ...options, moduleSuffixes: original },
      vibe: { effectGlobals: false, effectModules: false }, include: ["src/**/*"]
    }),
    "tsconfig.sidecars.json": JSON.stringify({
      compilerOptions: { ...options, moduleSuffixes: [...original, ...original.map(value => value + ".d.vibe")] },
      vibe: { effectGlobals: false, effectModules: false }, include: ["src/**/*"]
    })
  }
}

test("paired sidecar suffixes preserve source diagnostics and normal file priority (opencode-19)", async () => {
  await checkProperty(fc, {
    name: "sidecar-module-suffix-source", rule,
    command: "node --test test/sidecar-priority.property.test.mjs",
    arbitrary: fc.record({
      kind: fc.constantFrom("extensionless", "js", "directory", "vibe"),
      native: fc.boolean(), fallback: fc.boolean(), sibling: fc.constantFrom("none", "ts", "tsx")
    }), regressions: corpus, numRuns: 40, artifacts: filesOf,
    diagnostics: () => diagnostics,
    check: input => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "opencode-sidecar-priority-")))
      try {
        symlinkSync(modules, join(root, "node_modules"))
        for (const [file, contents] of Object.entries(filesOf(input))) {
          mkdirSync(dirname(join(root, file)), { recursive: true })
          writeFileSync(join(root, file), contents)
        }
        const run = project => spawnSync(binary, ["-p", project, "--pretty", "false"], {
          cwd: root, encoding: "utf8", timeout: 20000, env: { ...process.env, NO_COLOR: "1" }
        })
        const original = run("tsconfig.original.json")
        // A compiler that always emits sidecars may refresh them above.
        // Recreate the stale input before probing compatibility resolution.
        for (const [file, contents] of Object.entries(filesOf(input))) {
          if (file.endsWith(".d.vibe.ts")) writeFileSync(join(root, file), contents)
        }
        const sidecars = run("tsconfig.sidecars.json")
        diagnostics = JSON.stringify({ input, original, sidecars }).replaceAll(root, "<project>")
        for (const result of [original, sidecars]) {
          assert.ifError(result.error)
          assert.equal(result.status, 0, diagnostics)
        }
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  })
})
