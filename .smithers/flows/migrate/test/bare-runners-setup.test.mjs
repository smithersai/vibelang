// The whole setup step, through its receipt: a package bin Node runs with no
// VibeLang loader keeps what it reaches TypeScript, and setup.json says which.
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { makeConfig, paths, setup } from "../lib/steps.mjs"
import { commitId } from "../lib/jj.mjs"
import { must, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const effectModule = `import * as Effect from "effect/Effect"\nexport const value = Effect.succeed(1)\n`

test("setup's receipt names a bare runner's entry and the modules it keeps TypeScript", async () => {
  const root = mkdtempSync(join(tmpdir(), "bare-runner-setup-"))
  const target = join(root, "repo"), run = join(root, "run")
  const put = (name, text) => {
    mkdirSync(dirname(join(target, name)), { recursive: true })
    writeFileSync(join(target, name), text)
  }
  try {
    put("package.json", JSON.stringify({ name: "bare", bin: { bare: "./src/cli.ts" } }))
    put(".gitignore", "node_modules/\n")
    put("tsconfig.json", JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "lib", strict: true }, include: ["src/**/*.ts", "src/**/*.vibe"] }))
    put("src/cli.ts", `#!/usr/bin/env node\nimport { value } from "./Reached.ts"\nconsole.log(value)\n`)
    put("src/Reached.ts", effectModule)
    put("src/Elsewhere.ts", effectModule)
    put("node_modules/.bin/vibelang", [
      "#!/usr/bin/env node",
      'const fs = require("node:fs"), path = require("node:path")',
      'if (process.argv.includes("--version")) console.log("fixture 0.0.11")',
      'const at = process.argv.indexOf("--outDir")',
      'if (at >= 0) {',
      '  fs.mkdirSync(process.argv[at + 1], { recursive: true })',
      '  for (const name of ["cli", "Reached", "Elsewhere"]) fs.writeFileSync(path.join(process.argv[at + 1], name + ".d.ts"), "export declare const value: number\\n")',
      '}'
    ].join("\n") + "\n")
    chmodSync(join(target, "node_modules/.bin/vibelang"), 0o755)
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost && jj commit -m original", { cwd: target })
    const p = paths(run)
    writeJson(p.config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11", wire: false }))
    writeJson(p.upgrade, { jj: { initialized: true, commit: await commitId(target) }, effect: { to: "4.1.0" }, changed: [], tests: {} })
    writeJson(join(p.baseline, "upgraded-tests.json"), { code: 0, tests: {} })
    await setup({ run })
    const { bareRunners } = JSON.parse(readFileSync(p.setup, "utf8"))
    assert.ok(bareRunners.entries.some(entry => entry.entry === "src/cli.ts" && entry.runner === "node"), JSON.stringify(bareRunners))
    assert.ok(bareRunners.modules.includes("src/Reached.ts"), JSON.stringify(bareRunners))
    assert.ok(!bareRunners.modules.includes("src/Elsewhere.ts"), JSON.stringify(bareRunners))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
