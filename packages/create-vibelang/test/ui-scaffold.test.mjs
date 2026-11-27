import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const binPath = fileURLToPath(new URL("../bin/create-vibelang.mjs", import.meta.url))
const own = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))

function run(cwd, args, env = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_user_agent: "npm/11.0.0 node/v24.11.1", ...env }
  })
}

test("--help advertises --ui alongside --smithers and --no-install", () => {
  const res = run(tmpdir(), ["--help"])
  assert.equal(res.status, 0, res.stderr)
  assert.match(res.stdout, /Usage: create-vibelang \[directory\] \[--ui\] \[--smithers\] \[--no-install\]/)
})

test("--ui and --smithers together exit non-zero with a clear diagnostic", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-ui-conflict-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const res = run(dir, ["my-app", "--ui", "--smithers", "--no-install"])
  assert.notEqual(res.status, 0)
  assert.match(res.stderr, /--ui and --smithers cannot be combined/)
  assert.ok(!existsSync(join(dir, "my-app")), "should not create target directory on flag conflict")
})

test("--ui scaffolds an Effect UI Vibe starter with strict exactOptionalPropertyTypes and Story/Scene tests", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-ui-scaffold-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const res = run(dir, ["My UI App", "--ui", "--no-install"])
  assert.equal(res.status, 0, res.stderr)

  const app = join(dir, "My UI App")
  for (const file of [
    "package.json",
    "tsconfig.json",
    "vite.config.ts",
    "index.html",
    "src/Counter.vibe",
    "src/Counter.test.vibe",
    "src/entry.ts",
    "src/styles.css",
    ".gitignore",
    ".gitattributes",
    "README.md",
    "AGENTS.md"
  ]) {
    assert.ok(existsSync(join(app, file)), `missing ${file}`)
  }

  const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"))
  assert.equal(pkg.name, "my-ui-app")
  assert.equal(pkg.dependencies["vibelang-runtime"], own.version)
  assert.equal(pkg.devDependencies["vibelang"], own.version)
  assert.equal(pkg.devDependencies["vibelang-vite"], own.version)
  assert.ok(pkg.dependencies["@effect/ui"], "missing @effect/ui")
  assert.ok(pkg.dependencies["@effect/ui-kit"], "missing @effect/ui-kit")
  assert.ok(pkg.dependencies["@effect/ui-devtools"], "missing @effect/ui-devtools")
  assert.equal(pkg.scripts.dev, "vite")
  assert.equal(pkg.scripts.build, "vibe --noEmit && vite build")
  assert.equal(pkg.scripts.test, "vitest run")

  const tsconfig = JSON.parse(readFileSync(join(app, "tsconfig.json"), "utf8"))
  assert.equal(tsconfig.compilerOptions.strict, true)
  assert.equal(tsconfig.compilerOptions.exactOptionalPropertyTypes, true)

  const counter = readFileSync(join(app, "src/Counter.vibe"), "utf8")
  assert.match(counter, /Command\.Service/)
  assert.match(counter, /Html\.component/)
  assert.match(counter, /Button/)

  const testFile = readFileSync(join(app, "src/Counter.test.vibe"), "utf8")
  assert.match(testFile, /Story\.make/)
  assert.match(testFile, /HtmlScene\.make/)

  assert.match(res.stdout, /Effect UI/)
  assert.match(res.stdout, /npm run dev/)
  assert.match(res.stdout, /npm run test/)
  assert.match(res.stdout, /npm run build/)
  assert.match(readFileSync(join(app, "README.md"), "utf8"), /npm run dev/)
  assert.match(readFileSync(join(app, "AGENTS.md"), "utf8"), /npm run dev/)
})

test("--ui works from published package layout (template-ui/ with dotless dotfiles)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-ui-packaged-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const packaged = join(dir, "pkg")
  mkdirSync(packaged, { recursive: true })
  cpSync(new URL("../package.json", import.meta.url), join(packaged, "package.json"))
  cpSync(new URL("../bin", import.meta.url), join(packaged, "bin"), { recursive: true })
  cpSync(new URL("../../../templates/effect-ui", import.meta.url), join(packaged, "template-ui"), { recursive: true })
  for (const dot of [".gitignore", ".gitattributes"]) {
    renameSync(join(packaged, "template-ui", dot), join(packaged, "template-ui", dot.slice(1)))
  }

  const out = join(dir, "out")
  mkdirSync(out)
  const res = spawnSync(process.execPath, [join(packaged, "bin/create-vibelang.mjs"), "ui-demo", "--ui", "--no-install"], {
    cwd: out,
    encoding: "utf8",
    env: { ...process.env, npm_config_user_agent: "pnpm/11.0.0 node/v24.11.1" }
  })
  assert.equal(res.status, 0, res.stderr)
  const app = join(out, "ui-demo")
  assert.ok(existsSync(join(app, ".gitignore")))
  assert.ok(existsSync(join(app, ".gitattributes")))
  assert.ok(existsSync(join(app, "pnpm-workspace.yaml")))
  const ws = readFileSync(join(app, "pnpm-workspace.yaml"), "utf8")
  assert.match(ws, /allowBuilds:\n  dprint: true/)
  assert.match(ws, /"@effect\/ui":/)
})
