#!/usr/bin/env node
// create-vibelang copies the VibeLang starter app into a new directory, pins the
// VibeLang packages to its own version, and installs dependencies with the
// package manager that ran it: `bun create vibelang@latest my-app` or
// `npm create vibelang@latest my-app`.
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const usage = "Usage: create-vibelang [directory] [--no-install]"
const own = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))

let target
let install = true
for (const arg of process.argv.slice(2)) {
  if (arg === "--no-install") install = false
  else if (arg === "--no-git") continue // accepted; create-vibelang never runs git init
  else if (arg === "-h" || arg === "--help") {
    console.log(usage)
    process.exit(0)
  } else if (arg === "-v" || arg === "--version") {
    console.log(own.version)
    process.exit(0)
  } else if (arg.startsWith("-")) fail(`unknown option ${arg}\n${usage}`)
  else if (target === undefined) target = arg
  else fail(`unexpected argument ${arg}\n${usage}`)
}
target ??= "vibelang-app"
const directory = resolve(target)
const manager = packageManager()
try {
  if (existsSync(directory)) {
    if (!statSync(directory).isDirectory()) fail(`${target} is not a directory. Choose a new directory name.`)
    if (readdirSync(directory).length > 0) fail(`${target} is not empty. Choose a new directory name.`)
  }

  // The published package carries the template in template/; a checkout uses
  // templates/app directly.
  const packaged = fileURLToPath(new URL("../template", import.meta.url))
  const template = existsSync(packaged) ? packaged : fileURLToPath(new URL("../../../templates/app", import.meta.url))
  mkdirSync(directory, { recursive: true })
  cpSync(template, directory, {
    recursive: true,
    filter: (path) => !["node_modules", "dist", "bun.lock", ".prototype"].includes(basename(path))
  })
  // npm drops .gitignore from published packages, so the template stores dotfiles without the dot.
  for (const name of ["gitignore", "gitattributes"]) {
    if (existsSync(join(directory, name))) renameSync(join(directory, name), join(directory, `.${name}`))
  }

  const manifestPath = join(directory, "package.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  manifest.name = packageName(basename(directory))
  manifest.version = "0.0.0"
  manifest.dependencies["vibelang-runtime"] = own.version
  manifest.devDependencies["vibelang"] = own.version
  manifest.devDependencies["vibelang-vite"] = own.version
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")

  // AGENTS.md names the commands with the manager that created the app, as the
  // next steps below do, so an agent's first command is one this machine has.
  const agentsPath = join(directory, "AGENTS.md")
  if (existsSync(agentsPath)) writeFileSync(agentsPath, readFileSync(agentsPath, "utf8").replaceAll("bun run ", `${manager} run `))
  const readmePath = join(directory, "README.md")
  if (existsSync(readmePath)) {
    const add = manager === "npm" ? "npm install" : `${manager} add`
    writeFileSync(readmePath, readFileSync(readmePath, "utf8")
      .replaceAll("bun run ", `${manager} run `)
      .replaceAll("bun install", `${manager} install`)
      .replaceAll("bun add -d ", `${add} ${manager === "yarn" ? "--dev" : "--save-dev"} `)
      .replaceAll("bun add ", `${add} `))
  }
} catch (error) {
  if (typeof error?.code !== "string" || !/^E[A-Z]+$/.test(error.code)) throw error
  fail(`Could not create ${target} (${error.code}). Check the path and directory permissions, then retry with a new or empty directory.`)
}
console.log(`Created ${target} with VibeLang ${own.version}.`)
if (install) {
  console.log(`Installing dependencies with ${manager}...`)
  const result = spawnSync(manager, ["install"], { cwd: directory, stdio: "inherit", shell: process.platform === "win32" })
  if (result.error) {
    if (result.error.code === "ENOENT") fail(`${manager} was not found. Install ${manager}, then run ${manager} install in ${target}.`)
    fail(`Could not start ${manager} install: ${result.error.message}. Retry in ${target}.`)
  }
  if (result.status !== 0) {
    console.error(`create-vibelang: ${manager} install failed. Run it again in ${target}.`)
    process.exit(result.status || 1)
  }
}

console.log(`
Next steps:
  cd ${shellQuote(target)}${install ? "" : `\n  ${manager} install`}
  ${manager} run start    build and run src/main.vibe
  ${manager} run dev      rebuild and restart on every save
  ${manager} run test     run the .vibe tests with Vitest

Editor support for VS Code or Cursor, after the install:
  code --install-extension node_modules/vibelang/editor/vibelang.vsix
  cursor --install-extension node_modules/vibelang/editor/vibelang.vsix

VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use.`)

// packageName turns a directory name into a valid npm package name.
function packageName(name) {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9._~-]+/g, "-").replace(/^[._-]+/, "").replace(/-+$/, "").slice(0, 214)
  return !cleaned || ["node_modules", "favicon.ico"].includes(cleaned) ? "vibelang-app" : cleaned
}

// packageManager reports the tool that ran this script, from the user agent
// npm, bun, pnpm, and yarn set for package binaries.
function packageManager() {
  const name = (process.env.npm_config_user_agent || "").split("/")[0]
  if (["bun", "npm", "pnpm", "yarn"].includes(name)) return name
  return process.versions.bun ? "bun" : "npm"
}

function fail(message) {
  console.error(`create-vibelang: ${message}`)
  process.exit(1)
}

// Quote paths for POSIX shells while keeping simple next steps readable.
function shellQuote(value) {
  return /^[a-zA-Z0-9_./-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'"
}
