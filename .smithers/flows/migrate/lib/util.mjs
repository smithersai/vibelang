// Small shared helpers for the migrate flow's deterministic steps: processes,
// JSON files, paths. Every step is a composition root on one machine, so these
// use Node's own modules directly.
import { spawn } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, relative, sep } from "node:path"

/** Runs a shell command and resolves with its exit code and output; never rejects on a nonzero exit. */
export function run(command, { cwd, env, log, input } = {}) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", command], { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("error", reject)
    // A command that exits without reading its input (`true` as an install step) closes stdin first: that is no failure.
    child.stdin.on("error", (error) => { if (error.code !== "EPIPE") reject(error) })
    child.on("close", (code, signal) => {
      const result = { command, cwd, code: code ?? 128, signal, stdout, stderr, ms: Date.now() - started }
      if (log) {
        mkdirSync(dirname(log), { recursive: true })
        writeFileSync(log, `$ ${command}\n# cwd ${cwd ?? process.cwd()}\n# exit ${result.code} in ${result.ms} ms\n\n${stdout}${stderr ? "\n# stderr\n" + stderr : ""}`)
      }
      resolve(result)
    })
    child.stdin.end(input ?? "")
  })
}

/** Like run, but rejects with the command's tail when it exits nonzero. */
export async function must(command, options = {}) {
  const result = await run(command, options)
  if (result.code !== 0) {
    const tail = (result.stdout + result.stderr).trim().split("\n").slice(-30).join("\n")
    throw new Error(`${command} exited ${result.code}${options.log ? ` (log: ${options.log})` : ""}\n${tail}`)
  }
  return result
}

/** Quotes a string for bash. */
export const quote = (text) => `'${String(text).replaceAll("'", `'\\''`)}'`

export const readJson = (path) => JSON.parse(readFileSync(path, "utf8"))
export const readJsonIf = (path, fallback) => (existsSync(path) ? readJson(path) : fallback)

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n")
}

export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

export function appendJsonl(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify(value) + "\n")
}

export function readJsonl(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8").split("\n").filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line)
    } catch {
      throw new Error(`${path}:${index + 1}: not JSON`)
    }
  })
}

/**
 * Whether path names a declaration file: x.d.ts, x.d.mts, x.d.cts, or the
 * declaration of another extension, such as the x.d.vibe.ts sidecar vibelang
 * writes beside x.vibe or TypeScript's x.d.css.ts.
 */
export const isDeclarationFile = (path) => /\.d\.(?:[^./]+\.)?[cm]?ts$/.test(path)

/** A path relative to root, with forward slashes. */
export const rel = (root, path) => relative(root, path).split(sep).join("/")

/** A file system name for a package directory: packages/foldkit becomes packages__foldkit. */
export const slug = (path) => (path === "." || path === "" ? "root" : path.replaceAll("/", "__"))

/** The batch directory name for batch index i (0-based). */
export const batchName = (index) => String(index + 1).padStart(2, "0")

export const unique = (values) => [...new Set(values)]
