// Small shared helpers for the migrate flow's deterministic steps: processes,
// JSON files, paths. Every step is a composition root on one machine, so these
// use Node's own modules directly.
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, relative, sep } from "node:path"

/** Runs a shell command and resolves with its exit code and output; never rejects on a nonzero exit. */
export function run(command, { cwd, env, log, input, timeoutMs, onStderr } = {}) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", command], { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"], detached: Boolean(timeoutMs) })
    let timedOut = false, forceTimer, observerError, observerFailed = false
    const kill = signal => { try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== "ESRCH") throw error } }
    const timer = timeoutMs && setTimeout(() => {
      timedOut = true
      kill("SIGTERM")
      forceTimer = setTimeout(() => kill("SIGKILL"), 1000)
    }, timeoutMs)
    let stdout = ""
    let stderr = ""
    // Decode each stream as a whole: a character split across two chunks stays one character.
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
      if (!onStderr || observerFailed) return
      try { onStderr(chunk, { pid: child.pid }) }
      catch (error) {
        observerError = error
        observerFailed = true
        const stop = signal => timeoutMs ? kill(signal) : child.kill(signal)
        stop("SIGTERM")
        forceTimer = setTimeout(() => stop("SIGKILL"), 1000)
      }
    })
    child.on("error", reject)
    // A command that exits without reading its input (`true` as an install step) closes stdin first: that is no failure.
    child.stdin.on("error", (error) => { if (error.code !== "EPIPE") reject(error) })
    child.on("close", (code, signal) => {
      clearTimeout(timer)
      clearTimeout(forceTimer)
      const result = { command, cwd, timedOut, code: timedOut ? 124 : code ?? 128, signal, pid: child.pid, stdout, stderr, ms: Date.now() - started }
      if (log) {
        mkdirSync(dirname(log), { recursive: true })
        writeFileSync(log, `$ ${command}\n# cwd ${cwd ?? process.cwd()}\n# exit ${result.code} in ${result.ms} ms\n# pid ${child.pid}${signal ? `, killed by ${signal}` : ""}, ended ${new Date().toISOString()}\n\n${stdout}${stderr ? "\n# stderr\n" + stderr : ""}`)
      }
      if (observerFailed) reject(observerError)
      else resolve(result)
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

export function syncDirectory(path) {
  const fd = openSync(path, "r")
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

/** Replace atomically, and flush both the contents and the directory entry. */
export function durableWrite(path, data, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.migrate-tmp`
  const fd = openSync(temp, "w", mode)
  try {
    writeFileSync(fd, data)
    fsyncSync(fd)
  } catch (error) {
    try { closeSync(fd) } catch {}
    rmSync(temp, { force: true })
    throw error
  }
  closeSync(fd)
  try {
    renameSync(temp, path)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
  syncDirectory(dirname(path))
}

export function writeJson(path, value) {
  durableWrite(path, JSON.stringify(value, null, 2) + "\n", 0o644)
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

/** A bounded package identity that preserves nesting, punctuation and the root. */
export function packageKey(pkg) {
  const path = pkg || ".", encoded = encodeURIComponent(path)
  return encoded.length <= 180 ? "package-" + encoded
    : "digest-" + createHash("sha256").update(path).digest("hex")
}

/** A file system name for a package directory: packages/foldkit becomes packages__foldkit. */
export const slug = (path) => (path === "." || path === "" ? "root" : path.replaceAll("/", "__"))

/** The batch directory name for batch index i (0-based). */
export const batchName = (index) => String(index + 1).padStart(2, "0")

export const unique = (values) => [...new Set(values)]

/**
 * Splits one command over files into shell commands whose text stays below
 * limit bytes. Linux limits the single bash -c argument (128 KiB) as well as
 * total argv bytes; count escaped UTF-8 bytes and keep room below it.
 */
export function chunkCommands(prefix, files, limit = 64 * 1024) {
  const head = prefix.map(quote).join(" ")
  const commands = []
  let command = head
  for (const file of files) {
    const arg = " " + quote(file)
    if (command !== head && Buffer.byteLength(command + arg) > limit) {
      commands.push(command)
      command = head
    }
    command += arg
  }
  if (command !== head) commands.push(command)
  return commands
}

/**
 * A runner for chunked file commands sharing one log: each chunk writes
 * log.part-N and log keeps every chunk's receipt. Each call returns the
 * first nonzero exit code of its chunks; every chunk still runs.
 */
export function chunkedRunner(log) {
  let part = 0
  const receipts = []
  return async (prefix, files, cwd) => {
    let code = 0
    for (const command of chunkCommands(prefix, files)) {
      const chunkLog = log && log + ".part-" + (++part)
      const result = await run(command, { cwd, log: chunkLog })
      code ||= result.code
      if (log) {
        receipts.push(readFileSync(chunkLog, "utf8"))
        writeFileSync(log, receipts.join("\n"))
      }
    }
    return code
  }
}
