// RD-024: checking coverage advertised for the preload must match its scoped
// compiler invocation. Native TypeScript tests need the full compiler command.
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { compileProjectSync, parseOutput } from "../project.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")

test("RD-024: preload docs distinguish Vibe checking from the full native-TypeScript test check", () => {
  for (const page of ["docs/user/src/setup/vibelang-cli.md", "packages/compiler/README.md"]) {
    const text = readFileSync(join(repo, page), "utf8")
    assert.equal(/preload checks the whole project|first .* import compiles the whole project/i.test(text), false, page)
    assert.ok(text.includes("The preload checks and emits only the project's own") &&
      text.includes("native TypeScript") && text.includes("vibelang -p tsconfig.json"), page)
  }
})

test("RD-024: Bun loads a clean Vibe module while the full command diagnoses an included native test", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-preload-coverage-")))
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
    symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true },
      include: ["main.vibe", "*.test.ts"]
    }))
    writeFileSync(join(root, "main.vibe"), "export const value = 7\n")
    writeFileSync(join(root, "unused.test.ts"), 'test("unused", () => {}); const bad: string = 1\n')
    writeFileSync(join(root, "entry.mjs"), 'import { value } from "./main.vibe"; console.log(value)')

    const full = spawnSync(compiler, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false"], { cwd: root, encoding: "utf8" })
    assert.equal(full.status, 2, full.stdout + full.stderr)
    const errors = parseOutput(full.stdout + full.stderr, root).diagnostics
    assert.ok(errors.some((d) => d.file === join(root, "unused.test.ts") && d.code === "TS2322"), full.stdout)
    assert.ok(errors.some((d) => d.file === join(root, "unused.test.ts") && /TS(2593|2304)/.test(d.code)), full.stdout)
    const loaded = compileProjectSync({ project: join(root, "tsconfig.json"), compiler, cache: false })
    assert.deepEqual(loaded.errors, [])
    assert.deepEqual([...loaded.outputs.keys()], [join(root, "main.vibe")])

    const run = () => spawnSync("bun", ["--preload", join(repo, "packages/compiler/bun.mjs"), "entry.mjs"], {
      cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: compiler,
        VIBELANG_DISABLE_CACHE: "1", VIBELANG_PROJECT: "" }
    })
    const clean = run()
    assert.equal(clean.status, 0, clean.stdout + clean.stderr)
    assert.equal(clean.stdout.trim(), "7")
    writeFileSync(join(root, "main.vibe"), "export const value: string = 7\n")
    const bad = run()
    assert.notEqual(bad.status, 0)
    assert.match(bad.stderr, /TS2322/)
    assert.match(bad.stderr, /main\.vibe/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
