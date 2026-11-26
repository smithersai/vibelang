// The release flow's steps. Each runs one of scripts/release/ in the checkout
// with stdin closed, writes the command's whole output to
// dist-npm/release/<step>.log, and returns what the run records. No step reads
// a terminal: a person answers through the flow's questions.
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createWriteStream, mkdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

export const NPM = "https://registry.npmjs.org/"

// TAIL is how much of a command's output a step's record keeps.
const TAIL = 3000

/** tail returns the last TAIL characters of text, from a line start where one is near. */
export function tail(text) {
  if (text.length <= TAIL) return text
  const cut = text.slice(-TAIL)
  const line = cut.indexOf("\n")
  return line >= 0 && line < 200 ? cut.slice(line + 1) : cut
}

/**
 * exec runs command with args in repo, stdin closed, and resolves with its
 * exit code and output (stdout and stderr in arrival order). With log set,
 * the output also goes to dist-npm/release/<log>.log, where the command line
 * shows secret as <secret>.
 */
export function exec(repo, command, args, { env = {}, log, secret = "" } = {}) {
  return new Promise((resolve, reject) => {
    let file
    if (log) {
      mkdirSync(join(repo, "dist-npm/release"), { recursive: true })
      file = createWriteStream(join(repo, "dist-npm/release", `${log}.log`), { flags: "a" })
      file.write(`$ ${[command, ...args.map((arg) => (secret && arg === secret ? "<secret>" : arg))].join(" ")}\n`)
    }
    // A node --test inherited from a calling test runner skips its files and passes.
    const { NODE_TEST_CONTEXT: _, ...inherited } = process.env
    const child = spawn(command, args, { cwd: repo, env: { ...inherited, ...env }, stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    const take = (chunk) => {
      output += chunk
      if (!secret) file?.write(chunk)
      if (!secret && output.length > 2 * TAIL) output = output.slice(-TAIL)
    }
    child.stdout.on("data", take)
    child.stderr.on("data", take)
    child.on("error", reject)
    child.on("close", (code, signal) => {
      if (secret) {
        output = output.replaceAll(secret, "<secret>")
        file?.write(output)
      }
      const done = () => resolve({ code: code ?? 128, signal, output })
      if (file) file.end(done)
      else done()
    })
  })
}

/** must runs exec and rejects with the command's tail when it exits nonzero. */
export async function must(repo, step, command, args, options = {}) {
  const result = await exec(repo, command, args, { ...options, log: step })
  if (result.code !== 0) {
    throw new Error(`${step}: ${command} ${args.join(" ")} exited ${result.code}${result.signal ? ` (${result.signal})` : ""}; dist-npm/release/${step}.log has the output\n${tail(result.output)}`)
  }
  return result.output
}

const firstLine = (text) => text.trim().split("\n")[0] ?? ""

async function toolVersion(repo, command, args) {
  try {
    const { code, output } = await exec(repo, command, args)
    return code === 0 ? firstLine(output) : `unavailable (exit ${code})`
  } catch {
    return "unavailable"
  }
}

/**
 * check refuses a release before anything is built: the checkout's compiler
 * must be at the version asked for, the registry must know who publishes, and
 * the release notes must pass their final check against the last version the
 * registry has.
 */
export async function check(repo, { version, registry }) {
  const compiler = JSON.parse(readFileSync(join(repo, "packages/compiler/package.json"), "utf8")).version
  if (compiler !== version) {
    throw new Error(`check: the checkout's compiler is ${compiler}, not ${version}. Align every package's version with typescript/tsc/internal/vibelang/identity.go first.`)
  }
  const identity = readFileSync(join(repo, "typescript/tsc/internal/vibelang/identity.go"), "utf8")
  if (identity.match(/^const Version = "([^"]+)"$/m)?.[1] !== version) throw new Error("check: compiler identity version mismatch")
  const user = await exec(repo, "npm", ["whoami", "--registry", registry])
  if (user.code !== 0) throw new Error(`check: npm is not logged in to ${registry}. Run npm login --registry ${registry}, then start a new run.\n${tail(user.output)}`)
  const last = await exec(repo, "npm", ["view", "vibelang", "version", "--registry", registry])
  if (last.code !== 0 && (new URL(registry).href === NPM || !/\bE404\b/.test(last.output))) {
    throw new Error("check: could not determine the last published version: " + tail(last.output))
  }
  const lastPublished = last.code === 0 ? firstLine(last.output) : ""
  const env = { VIBELANG_RELEASE_NOTES_FINAL: "1", ...(lastPublished ? { VIBELANG_LAST_PUBLISHED_VERSION: lastPublished } : {}) }
  await must(repo, "check", "node", ["docs/tools/release-changes.mjs", "--check-empty"])
  await must(repo, "check", "sh", ["scripts/e2e.sh"])
  await must(repo, "check", "bun", ["run", "--cwd", ".smithers", "docs:check"])
  const notes = await must(repo, "check", "node", ["--test", "docs/tools/release-docs.test.mjs"], { env })
  const toolchain = {
    node: process.version,
    npm: await toolVersion(repo, "npm", ["--version"]),
    go: await toolVersion(repo, "go", ["version"]),
    bun: await toolVersion(repo, "bun", ["--version"])
  }
  return { version, registry, publisher: firstLine(user.output), lastPublished, toolchain, notes: tail(notes) }
}

/** build cross-compiles the six platform binaries and packs every package into dist-npm/tarballs/. */
export async function build(repo, { version }) {
  const binaries = await must(repo, "build", "sh", ["scripts/release/build-binaries.sh"])
  const packages = await must(repo, "build", "node", ["scripts/release/make-packages.mjs"])
  const manifest = readManifest(repo)
  if (manifest.version !== version) throw new Error(`build: dist-npm/tarballs/manifest.json is ${manifest.version}, not ${version}`)
  return { version, binaries: tail(binaries), packages: tail(packages) }
}

/** readManifest reads dist-npm/tarballs/manifest.json. */
export function readManifest(repo) {
  return JSON.parse(readFileSync(join(repo, "dist-npm/tarballs/manifest.json"), "utf8"))
}

/**
 * candidate lists each package the run publishes with its tarball's SHA-1,
 * the digest npm records as dist.shasum. Packages whose names contain a
 * VIBELANG_SKIP pattern are left out, as publish.sh leaves them out.
 */
export function candidate(repo, skip = "") {
  const patterns = skip.split(",").map((pattern) => pattern.trim()).filter(Boolean)
  const manifest = readManifest(repo)
  return manifest.packages
    .filter((pkg) => !patterns.some((pattern) => pkg.name.includes(pattern)))
    .map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      file: pkg.file,
      shasum: createHash("sha1").update(readFileSync(join(repo, "dist-npm/tarballs", pkg.file))).digest("hex")
    }))
}

/**
 * rehearse installs the tarballs from a throwaway registry with every package
 * manager, then dry-runs the publication against the real registry. It returns
 * the candidate the person approves: the exact tarballs, by digest.
 */
export async function rehearse(repo, { registry, skip }) {
  const env = { VIBELANG_SKIP: skip, VIBELANG_REGISTRY: registry }
  const rehearsal = await must(repo, "rehearse", "sh", ["scripts/release/rehearse.sh"], { env })
  const dryRun = await must(repo, "rehearse", "sh", ["scripts/release/publish.sh", "--dry-run"], { env })
  return { packages: candidate(repo, skip), rehearsal: tail(rehearsal), dryRun: tail(dryRun) }
}

/** approval is the question the person answers before anything is published. */
export function approval({ version, registry, skip }, packages) {
  const rows = packages.map((pkg) => `  ${pkg.name}@${pkg.version}  sha1 ${pkg.shasum}`).join("\n")
  return `Publish VibeLang ${version} to ${registry}? The rehearsal and the publication dry run passed for these ${packages.length} tarballs:\n${rows}` +
    (skip ? `\nLeft out (VIBELANG_SKIP=${skip}): every package whose name contains one of these patterns.` : "")
}

/** otpPrompt is the question for the one-time password of one publication round. */
export function otpPrompt(registry, round, rounds) {
  return `Confirm authentication for ${registry} (round ${round} of ${rounds}). If npm requires an OTP, update the private file named by VIBELANG_RELEASE_OTP_FILE before confirming.`

}

// npm reports a refused or expired one-time password with this code.
const EOTP = /\bEOTP\b/

/**
 * publish publishes the approved tarballs. It refuses tarballs whose bytes
 * changed since the approval. A refused one-time password is not a failure:
 * it returns published: false, and the flow asks for another one, unless this
 * is the last round. publish.sh skips every version the registry already has
 * with identical bytes, so a round resumes where the last one stopped.
 */
export async function publish(repo, { registry, skip, packages, last }) {
  const now = candidate(repo, skip)
  const changed = packages.filter((pkg) => now.find((other) => other.name === pkg.name)?.shasum !== pkg.shasum)
  if (changed.length > 0 || now.length !== packages.length) {
    throw new Error(`publish: the tarballs changed after the approval (${changed.map((pkg) => pkg.name).join(", ") || "the package list"}). Start a new run.`)
  }
  const otpFile = process.env.VIBELANG_RELEASE_OTP_FILE
  const otp = otpFile ? readFileSync(otpFile, "utf8").trim() : ""
  if (otp && !/^\d{6}$/.test(otp)) throw new Error("publish: expected a six-digit npm one-time password")
  const command = otp ? "sh" : "python3"
  const args = otp ? ["scripts/release/publish.sh"] : [fileURLToPath(new URL("./no-otp.py", import.meta.url))]
  const result = await exec(repo, command, args, { env: { VIBELANG_SKIP: skip, VIBELANG_REGISTRY: registry, NPM_OTP: otp }, log: "publish", secret: otp })
  if (result.code === 0) return { published: true, output: tail(result.output) }
  if (EOTP.test(result.output) && !last) return { published: false, output: tail(result.output) }
  throw new Error(`publish: scripts/release/publish.sh exited ${result.code}; dist-npm/release/publish.log has the output\n${tail(result.output)}`)
}

/** verify scaffolds, installs, builds, starts and tests an app from the registry the release went to. */
export async function verify(repo, { version, registry }) {
  if (new URL(registry).href !== NPM) {
    const output = await must(repo, "verify", "sh", ["scripts/release/check-app.sh", registry, version, "npm", "bun"])
    return { output: tail(output) }
  }
  const output = await must(repo, "verify", "sh", ["scripts/release/verify-published.sh", version], { env: { VIBELANG_REGISTRY: registry } })
  return { output: tail(output) }
}
