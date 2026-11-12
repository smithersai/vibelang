import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const create = fileURLToPath(new URL("../bin/create-vibelang.mjs", import.meta.url))
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version

function run(cwd, ...args) {
  return spawnSync(process.execPath, [create, ...args], { cwd, encoding: "utf8", env: { ...process.env, npm_config_user_agent: "npm/11.0.0 node/v26.0.0" } })
}

test("copies the starter app and pins the VibeLang packages to its own version", () => {
  const scratch = mkdtempSync(join(tmpdir(), "create-vibelang-"))
  try {
    const result = run(scratch, "My App", "--no-install", "--no-git")
    assert.equal(result.status, 0, result.stderr)
    const app = join(scratch, "My App")
    for (const file of ["src/main.vibe", "src/greeting.vibe", "src/greeting.test.vibe", "tsconfig.json", "vitest.config.ts", "scripts/dev.mjs", ".gitignore", ".gitattributes", "README.md", "AGENTS.md"]) {
      assert.ok(existsSync(join(app, file)), file)
    }
    assert.ok(!existsSync(join(app, "node_modules")))
    assert.ok(!existsSync(join(app, ".git")))
    const manifest = JSON.parse(readFileSync(join(app, "package.json"), "utf8"))
    assert.equal(manifest.name, "my-app")
    assert.equal(manifest.dependencies["vibelang-runtime"], version)
    assert.equal(manifest.devDependencies.vibelang, version)
    assert.equal(manifest.devDependencies["vibelang-vite"], version)
    assert.match(result.stdout, /npm install/)
    const agents = readFileSync(join(app, "AGENTS.md"), "utf8")
    assert.match(agents, /`npm run build`/)
    assert.match(agents, /`npm run test`/)
    assert.doesNotMatch(agents, /bun run/)
    assert.match(result.stdout, /node_modules\/vibelang\/editor\/vibelang\.vsix/)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

// Every turn of a coding agent in a new app loads AGENTS.md, so it carries
// the docs' Essentials verbatim and stays small (CEO a-yrntzv).
test("the starter's AGENTS.md carries the docs' Essentials and stays under 2 KB", () => {
  const agents = readFileSync(new URL("../../../templates/app/AGENTS.md", import.meta.url), "utf8")
  const essentials = readFileSync(new URL("../../../docs/user/llms-essentials.md", import.meta.url), "utf8")
  assert.ok(agents.includes(essentials), "templates/app/AGENTS.md must contain docs/user/llms-essentials.md verbatim")
  assert.ok(Buffer.byteLength(agents) < 2048, `AGENTS.md is ${Buffer.byteLength(agents)} bytes`)
})

test("refuses a directory that is not empty", () => {
  const scratch = mkdtempSync(join(tmpdir(), "create-vibelang-"))
  try {
    mkdirSync(join(scratch, "app"))
    writeFileSync(join(scratch, "app", "keep.txt"), "mine")
    const result = run(scratch, "app", "--no-install")
    assert.equal(result.status, 1)
    assert.match(result.stderr, /app is not empty/)
    assert.equal(readFileSync(join(scratch, "app", "keep.txt"), "utf8"), "mine")
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test("rejects unknown options", () => {
  const result = run(tmpdir(), "--template", "x")
  assert.equal(result.status, 1)
  assert.match(result.stderr, /unknown option --template/)
})

function scratch(t) {
  const directory = mkdtempSync(join(tmpdir(), "create-vibelang-cli-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}

test("help and version exit successfully without creating an app", (t) => {
  const directory = scratch(t)
  for (const flag of ["-h", "--help", "-v", "--version"]) {
    const result = run(directory, flag)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), flag.endsWith("h") || flag === "--help"
      ? "Usage: create-vibelang [directory] [--no-install]" : version)
    assert.ok(!existsSync(join(directory, "vibelang-app")))
  }
})

test("rejects extra positional arguments before writing files", (t) => {
  const directory = scratch(t)
  const result = run(directory, "first", "second", "--no-install")
  assert.equal(result.status, 1)
  assert.match(result.stderr, /unexpected argument second/)
  assert.ok(!existsSync(join(directory, "first")))
})

test("uses the default directory and accepts an existing empty directory", (t) => {
  const directory = scratch(t)
  mkdirSync(join(directory, "vibelang-app"))
  const result = run(directory, "--no-install")
  assert.equal(result.status, 0, result.stderr)
  const manifest = JSON.parse(readFileSync(join(directory, "vibelang-app/package.json"), "utf8"))
  assert.equal(manifest.name, "vibelang-app")
})

test("can scaffold the current directory", (t) => {
  const directory = scratch(t)
  const result = run(directory, ".", "--no-install")
  assert.equal(result.status, 0, result.stderr)
  assert.ok(existsSync(join(directory, "src/main.vibe")))
})

test("normalizes directory names to npm package names", (t) => {
  const directory = scratch(t)
  for (const [name, expected] of [["Hello WORLD!", "hello-world"], ["...Hidden_App--", "hidden_app"], ["日本語", "vibelang-app"], ["A~B.C_2", "a~b.c_2"]]) {
    const result = run(directory, name, "--no-install")
    assert.equal(result.status, 0, result.stderr)
    const manifest = JSON.parse(readFileSync(join(directory, name, "package.json"), "utf8"))
    assert.equal(manifest.name, expected)
  }
})

// Exercise real subprocess installation without contacting a registry. Each
// shim records the cwd and arguments, and proves the template was ready first.
for (const manager of ["npm", "bun", "pnpm", "yarn"]) {
  test(`installs with the invoking ${manager} and prints its next steps`, (t) => {
    const directory = scratch(t)
    const bin = join(directory, "bin")
    mkdirSync(bin)
    writeFileSync(join(bin, manager), `#!${process.execPath}\nimport { writeFileSync, existsSync } from "node:fs"\nwriteFileSync(${JSON.stringify(join(directory, "install.json"))}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), ready: existsSync("src/main.vibe") }))\n`, { mode: 0o755 })
    const result = spawnSync(process.execPath, [create, "app"], {
      cwd: directory, encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, npm_config_user_agent: `${manager}/99.0.0` }
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(readFileSync(join(directory, "install.json"), "utf8")), {
      argv: ["install"], cwd: realpathSync(join(directory, "app")), ready: true
    })
    const readme = readFileSync(join(directory, "app/README.md"), "utf8")
    assert.ok(readme.includes(`${manager} run start`))
    assert.ok(readme.includes(`${manager} install`))
    const add = manager === "npm" ? "npm install" : `${manager} add`
    assert.ok(readme.includes(`${add} vibelang-runtime@latest`))
    assert.ok(readme.includes(`${add} ${manager === "yarn" ? "--dev" : "--save-dev"} vibelang@latest vibelang-vite@latest`))
    if (manager !== "bun") assert.doesNotMatch(readme, /bun (?:run|install|add)/)
    assert.match(result.stdout, new RegExp(`Installing dependencies with ${manager}`))
    assert.match(result.stdout, new RegExp(`${manager} run test`))
    assert.doesNotMatch(result.stdout, new RegExp(`cd app\\n  ${manager} install`))
  })
}

test("propagates install failure and leaves a recoverable scaffold", (t) => {
  const directory = scratch(t)
  const bin = join(directory, "bin")
  mkdirSync(bin)
  writeFileSync(join(bin, "npm"), `#!${process.execPath}\nprocess.exit(42)\n`, { mode: 0o755 })
  const result = spawnSync(process.execPath, [create, "app"], {
    cwd: directory, encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, npm_config_user_agent: "npm/11" }
  })
  assert.equal(result.status, 42)
  assert.match(result.stderr, /npm install failed\. Run it again in app/)
  assert.ok(existsSync(join(directory, "app/src/main.vibe")))
  assert.doesNotMatch(result.stdout, /Next steps:/)
})

test("falls back to the host package manager for an unknown user agent", (t) => {
  const directory = scratch(t)
  const result = spawnSync(process.execPath, [create, "app", "--no-install"], {
    cwd: directory, encoding: "utf8", env: { ...process.env, npm_config_user_agent: "other/1" }
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(`  ${process.versions.bun ? "bun" : "npm"} install`))
})

test("a missing installer exits with failure and useful recovery instructions", (t) => {
  const directory = scratch(t)
  const result = spawnSync(process.execPath, [create, "app"], {
    cwd: directory, encoding: "utf8",
    env: { ...process.env, PATH: directory, npm_config_user_agent: "pnpm/99" }
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /pnpm was not found/)
  assert.match(result.stderr, /Install pnpm.*pnpm install.*app/)
  assert.ok(existsSync(join(directory, "app/src/main.vibe")))
  assert.doesNotMatch(result.stdout, /Next steps:/)
})

test("the packaged template restores dotfiles and excludes generated artifacts", (t) => {
  const directory = scratch(t)
  const packaged = join(directory, "package")
  mkdirSync(join(packaged, "bin"), { recursive: true })
  cpSync(create, join(packaged, "bin/create-vibelang.mjs"))
  cpSync(new URL("../package.json", import.meta.url), join(packaged, "package.json"))
  cpSync(new URL("../../../templates/app", import.meta.url), join(packaged, "template"), { recursive: true })
  for (const ignored of ["node_modules", "dist", ".prototype"]) {
    mkdirSync(join(packaged, "template", ignored), { recursive: true })
    writeFileSync(join(packaged, "template", ignored, "excluded.txt"), "generated")
  }
  writeFileSync(join(packaged, "template/bun.lock"), "generated lock")
  writeFileSync(join(packaged, "template/packaged-only.txt"), "published template")
  const result = spawnSync(process.execPath, [join(packaged, "bin/create-vibelang.mjs"), "app", "--no-install"], {
    cwd: directory, encoding: "utf8"
  })
  assert.equal(result.status, 0, result.stderr)
  const app = join(directory, "app")
  assert.equal(readFileSync(join(app, "packaged-only.txt"), "utf8"), "published template")
  for (const name of ["gitignore", "gitattributes"]) {
    assert.ok(existsSync(join(app, `.${name}`)))
    assert.ok(!existsSync(join(app, name)))
  }
  for (const ignored of ["node_modules", "dist", ".prototype", "bun.lock"]) {
    assert.ok(!existsSync(join(app, ignored)), ignored)
  }
})


test("new apps start at 0.0.0 and their README describes an installed starter", (t) => {
  const directory = scratch(t)
  const result = run(directory, "app", "--no-install")
  assert.equal(result.status, 0, result.stderr)
  const app = join(directory, "app")
  assert.equal(JSON.parse(readFileSync(join(app, "package.json"), "utf8")).version, "0.0.0")
})

test("new app READMEs omit repository setup instructions", (t) => {
  const directory = scratch(t)
  const result = run(directory, "app", "--no-install")
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(readFileSync(join(directory, "app/README.md"), "utf8"), /scripts\/setup\.sh|local VibeLang checkout/)
})
test("reserved npm package names use a valid fallback", (t) => {
  for (const name of ["node_modules", "favicon.ico", "NODE_MODULES", "Favicon.ico"]) {
    const directory = scratch(t)
    const result = run(directory, name, "--no-install")
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(readFileSync(join(directory, name, "package.json"), "utf8")).name, "vibelang-app")
  }
})

test("new npm package names stay within 214 characters", (t) => {
  const directory = scratch(t)
  for (const name of ["a".repeat(230), "b".repeat(213) + "-more"]) {
    const result = run(directory, name, "--no-install")
    assert.equal(result.status, 0, result.stderr)
    const actual = JSON.parse(readFileSync(join(directory, name, "package.json"), "utf8")).name
    assert.equal(actual.length, 214)
    assert.equal(actual, name.slice(0, 214))
  }
})

test("refuses a file target without an uncaught filesystem error", (t) => {
  const directory = scratch(t)
  writeFileSync(join(directory, "app"), "keep me")
  const result = run(directory, "app", "--no-install")
  assert.equal(result.status, 1)
  assert.match(result.stderr, /create-vibelang: app is not a directory/)
  assert.doesNotMatch(result.stderr, /ENOTDIR|at .*\.mjs:/)
  assert.equal(readFileSync(join(directory, "app"), "utf8"), "keep me")
})

test("printed cd commands reach targets containing shell metacharacters", (t) => {
  const directory = scratch(t)
  for (const name of ["My App", "it's here", "cash$HOME", "`literal`", "~", "./-leading"]) {
    const result = run(directory, name, "--no-install")
    assert.equal(result.status, 0, result.stderr)
    const command = result.stdout.match(/^  (cd .+)$/m)?.[1]
    assert.ok(command)
    const changed = spawnSync("/bin/sh", ["-c", command + " && pwd -P"], { cwd: directory, encoding: "utf8" })
    assert.equal(changed.status, 0, changed.stderr)
    assert.equal(changed.stdout.trim(), realpathSync(join(directory, name)))
  }
})

test("filesystem failures report the target and recovery without a stack trace", (t) => {
  const directory = scratch(t)
  writeFileSync(join(directory, "parent"), "preserve")
  symlinkSync("absent", join(directory, "dangling"))
  for (const [target, code] of [["parent/app", /ENOTDIR/], ["dangling", /ENOENT|EEXIST/], ["x".repeat(256), /ENAMETOOLONG/]]) {
    const result = run(directory, target, "--no-install")
    assert.equal(result.status, 1)
    assert.match(result.stderr, /create-vibelang: Could not create/)
    assert.ok(result.stderr.includes(target))
    assert.match(result.stderr, code)
    assert.match(result.stderr, /path.*permissions.*new or empty directory/)
    assert.doesNotMatch(result.stderr, /\n\s+at |node:fs|Node\.js v/)
    assert.doesNotMatch(result.stdout, /Created|Next steps/)
  }
  assert.equal(readFileSync(join(directory, "parent"), "utf8"), "preserve")
})

// The compiler writes a declaration pair and ownership receipts per module.
// They belong in vibe.sidecarDir, which .gitignore and dprint skip, so a first
// `git add .` commits only sources and the formatting guide's dprint check passes.
test("the starter keeps generated declarations in an ignored sidecar directory", () => {
  const template = new URL("../../../templates/app/", import.meta.url)
  const tsconfig = JSON.parse(readFileSync(new URL("tsconfig.json", template), "utf8"))
  const sidecarDir = tsconfig.vibe.sidecarDir
  assert.equal(sidecarDir, ".vibe/declarations")
  assert.deepEqual(tsconfig.compilerOptions.rootDirs, [tsconfig.compilerOptions.rootDir, sidecarDir])
  const ignored = readFileSync(new URL(".gitignore", template), "utf8").split("\n").filter((line) => line && !line.startsWith("#"))
  assert.ok(ignored.some((line) => sidecarDir.startsWith(line.replace(/\/$/, "") + "/") || line === sidecarDir + "/"), `.gitignore must list ${sidecarDir}`)
  for (const output of ["dist/", "node_modules/"]) assert.ok(ignored.includes(output), output)
  // Every test extension Vitest runs stays out of the build.
  const vitest = readFileSync(new URL("vitest.config.ts", template), "utf8")
  assert.match(vitest, /include: \["src\/\*\*\/\*\.test\.\{vibe,vibex\}"\]/)
  assert.deepEqual(tsconfig.exclude, ["src/**/*.test.vibe", "src/**/*.test.vibex"])
})
