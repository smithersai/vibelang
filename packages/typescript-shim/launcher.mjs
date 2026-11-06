// The tsc of a project whose typescript dependency is this package: it runs
// the native VibeLang compiler in place of this process, as TypeScript's own
// launcher runs tsc. An editor reaches it through lib/tsc or tsc.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { findBinary } from "vibelang/binary"

const require = createRequire(import.meta.url)
const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))
const wanted = manifest.dependencies.vibelang
const found = require("vibelang/package.json").version
if (found !== wanted) {
  console.error(`vibelang-typescript ${manifest.version} needs vibelang ${wanted}, but vibelang ${found} is installed.`)
  console.error("Install them together, at the versions the VibeLang release notes pair, then run tsc again.")
  process.exit(1)
}

const exe = findBinary()
const args = process.argv.slice(2)
if (process.platform !== "win32" && typeof process.execve === "function") {
  try {
    process.execve(exe, [exe, ...args])
  } catch {
    // Fall back to a child process below.
  }
}
try {
  execFileSync(exe, args, { stdio: "inherit" })
} catch (error) {
  process.exitCode = error.status ?? 1
}
