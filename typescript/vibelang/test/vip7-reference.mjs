import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"

export const referenceVersions = Object.freeze({ typescript: "5.9.3", effect: "4.1.0" })
const alive = pid => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code !== "ESRCH" }
}
const valid = cache => {
  try {
    const ready = JSON.parse(fs.readFileSync(path.join(cache, "reference-ready.json"), "utf8"))
    return Object.entries(referenceVersions).every(([name, version]) =>
      ready[name] === version &&
      JSON.parse(fs.readFileSync(path.join(cache, "node_modules", name, "package.json"), "utf8")).version === version)
  } catch { return false }
}
const npmInstall = (cache, versions, childStarted, timeoutMs) => new Promise((resolve, reject) => {
  const child = spawn("npm", ["install", "--prefix", cache, "--ignore-scripts", "--no-audit", "--no-fund",
    ...Object.entries(versions).map(([name, version]) => name + "@" + version)], { stdio: ["ignore", "pipe", "pipe"] })
  childStarted(child.pid)
  let stderr = ""
  child.stderr.on("data", data => { stderr = (stderr + data).slice(-4000) })
  child.stdout.resume()
  const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs)
  child.once("error", error => { clearTimeout(timer); reject(error) })
  child.once("close", (code, signal) => {
    clearTimeout(timer)
    if (code === 0) resolve()
    else reject(new Error("Pinned reference install failed: exit=" + code + " signal=" + signal + "\n" + stderr))
  })
})

// Acceptance cases run in parallel. Hold one lock until npm has completed;
// package.json appearing early in an install is not a readiness signal.
export async function ensurePinnedReference(cache, { install = npmInstall, timeoutMs = 240000 } = {}) {
  fs.mkdirSync(path.dirname(cache), { recursive: true })
  const lock = cache + ".install-lock"
  const ownerFile = path.join(lock, "owner.json")
  const started = Date.now()
  for (;;) {
    try { fs.mkdirSync(lock); break } catch (error) {
      if (error.code !== "EEXIST") throw error
      try {
        const owner = JSON.parse(fs.readFileSync(ownerFile, "utf8"))
        if (!alive(owner.pid) && !alive(owner.child)) { fs.rmSync(lock, { recursive: true, force: true }); continue }
      } catch (readError) {
        if (!["ENOENT", undefined].includes(readError.code)) throw readError
        if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs > timeoutMs)
          fs.rmSync(lock, { recursive: true, force: true })
      }
      if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for the pinned reference install lock")
      await delay(25)
    }
  }
  const owner = { pid: process.pid, child: null }
  const saveOwner = () => fs.writeFileSync(ownerFile, JSON.stringify(owner))
  saveOwner()
  try {
    if (valid(cache)) return
    fs.mkdirSync(cache, { recursive: true })
    fs.writeFileSync(path.join(cache, "package.json"), JSON.stringify({ private: true, type: "module" }))
    await install(cache, referenceVersions, pid => { owner.child = pid; saveOwner() }, timeoutMs)
    for (const [name, version] of Object.entries(referenceVersions)) {
      const actual = JSON.parse(fs.readFileSync(path.join(cache, "node_modules", name, "package.json"), "utf8")).version
      if (actual !== version) throw new Error("Expected pinned " + name + "@" + version + ", received " + actual)
    }
    fs.writeFileSync(path.join(cache, "reference-ready.json"), JSON.stringify(referenceVersions))
  } finally { fs.rmSync(lock, { recursive: true, force: true }) }
}
