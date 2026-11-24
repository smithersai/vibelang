import { randomBytes } from "node:crypto"
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
//
// The harness kills a runner's process group at its deadline, which leaves a
// lock whose owner is dead. A waiter never removes such a lock: two waiters
// that both saw the dead owner would each remove and re-create it, the second
// removing the first's new lock, and both would install into one cache. A
// waiter takes the lock over in place by creating a directory inside it named
// for the dead owner. mkdir is atomic, so one waiter succeeds per dead owner
// and the others keep waiting for the new one. `staleOwnerSeen` is a test
// seam: it runs after a waiter has judged the owner dead and before it acts.
export async function ensurePinnedReference(cache, { install = npmInstall, timeoutMs = 240000, staleOwnerSeen } = {}) {
  fs.mkdirSync(path.dirname(cache), { recursive: true })
  const lock = cache + ".install-lock"
  const ownerFile = path.join(lock, "owner.json")
  const started = Date.now()
  for (;;) {
    try { fs.mkdirSync(lock); break } catch (error) {
      if (error.code !== "EEXIST") throw error
      try {
        const owner = JSON.parse(fs.readFileSync(ownerFile, "utf8"))
        if (!alive(owner.pid) && !alive(owner.child)) {
          await staleOwnerSeen?.(owner)
          try {
            fs.mkdirSync(path.join(lock, "takeover-" + owner.pid + "-" + (owner.token ?? "0")))
            break
          } catch (takeoverError) {
            // EEXIST: another waiter took this owner's lock over. ENOENT: its new owner has already released it.
            if (!["EEXIST", "ENOENT"].includes(takeoverError.code)) throw takeoverError
          }
        }
      } catch (readError) {
        if (!["ENOENT", undefined].includes(readError.code)) throw readError
        if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs > timeoutMs)
          fs.rmSync(lock, { recursive: true, force: true })
      }
      if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for the pinned reference install lock")
      await delay(25)
    }
  }
  // The token tells one owner from a later process that reuses its pid.
  const owner = { pid: process.pid, child: null, token: randomBytes(8).toString("hex") }
  // Replace the file in one step: a waiter never reads a half-written owner.
  const saveOwner = () => {
    const next = ownerFile + "." + owner.token
    fs.writeFileSync(next, JSON.stringify(owner))
    fs.renameSync(next, ownerFile)
  }
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
