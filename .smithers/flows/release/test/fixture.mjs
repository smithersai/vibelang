// A checkout the release flow can run end to end with no network: the real
// publish.sh, stand-ins for provenance checks, repacking, docs deployment, build,
// rehearsal and app checks, and an npm on PATH that records every call,
// refuses every one-time password but the fixture's, and never publishes.
import { execFileSync } from "node:child_process"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))

export const OTP = "246810"
export const NAMES = ["vibelang-linux-x64", "vibelang-win32-x64", "vibelang"]

const write = (file, text, mode = 0o644) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  chmodSync(file, mode)
}

export function fixture(t, { version = "0.0.1" } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-release-flow-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "scripts/release"), { recursive: true })
  for (const file of ["publish.sh"]) cpSync(join(repo, "scripts/release", file), join(root, "scripts/release", file))
  write(join(root, "scripts/release/repack.mjs"), "")
  write(join(root, "scripts/release/revision.mjs"), "")
  write(join(root, "typescript/tsc/internal/vibelang/identity.go"), 'const Version = "0.0.1"')
  write(join(root, "packages/compiler/package.json"), JSON.stringify({ name: "vibelang", version: "0.0.1" }))
  const calls = join(root, "calls.jsonl")
  writeFileSync(calls, "")
  const record = (name) => `printf '%s\\n' "$(node -e 'console.log(JSON.stringify(process.argv.slice(1)))' ${name} "$@")" >> ${JSON.stringify(calls)}`
  write(join(root, "docs/tools/release-changes.mjs"), "")
  write(join(root, "scripts/e2e.sh"), record("e2e"))
  write(join(root, "scripts/release/deploy-site.sh"), record("deploy"))
  write(join(root, "scripts/release/verify-published.sh"), record("live"))
  write(join(root, "bin/bun"), "#!/bin/sh\n" + record("bun"), 0o755)
  write(join(root, "docs/tools/release-docs.test.mjs"), `import { test } from "node:test"
import { appendFileSync } from "node:fs"
test("notes", () => appendFileSync(${JSON.stringify(calls)}, JSON.stringify(["notes", process.env.VIBELANG_RELEASE_NOTES_FINAL, process.env.VIBELANG_LAST_PUBLISHED_VERSION]) + "\\n"))
`)
  write(join(root, "scripts/release/build-binaries.sh"), `${record("build-binaries")}\necho "build-binaries: six platforms"\n`)
  write(join(root, "scripts/release/make-packages.mjs"), `import { execFileSync } from "node:child_process"
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(["make-packages"]) + "\\n")
const tarballs = "dist-npm/tarballs"
const packages = []
for (const name of ${JSON.stringify(NAMES)}) {
  const dir = join("dist-npm/stage", name, "package")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: ${JSON.stringify(version)} }))
  mkdirSync(tarballs, { recursive: true })
  const file = name + "-" + ${JSON.stringify(version)} + ".tgz"
  execFileSync("tar", ["-czf", join(tarballs, file), "-C", join("dist-npm/stage", name), "package"])
  packages.push({ name, version: ${JSON.stringify(version)}, file })
}
writeFileSync(join(tarballs, "manifest.json"), JSON.stringify({ version: ${JSON.stringify(version)}, packages }))
console.log("make-packages: " + packages.length + " packages")
`)
  write(join(root, "scripts/release/rehearse.sh"), `${record("rehearse")}\necho "rehearse: PASS"\n`)
  write(join(root, "scripts/release/check-app.sh"), `${record("check-app")}\necho "check-app: PASS"\n`)
  const bin = join(root, "bin")
  write(join(bin, "npm"), `#!${process.execPath}
import { appendFileSync } from "node:fs"
const args = process.argv.slice(2)
appendFileSync(${JSON.stringify(calls)}, JSON.stringify(["npm", ...args]) + "\\n")
if (args[0] === "whoami") { if (process.env.TEST_LOGGED_OUT) process.exit(1); console.log("releaser"); process.exit(0) }
if (args[0] === "view" && args[1] === "vibelang") { console.log("0.0.0"); process.exit(0) }
if (args[0] === "view") process.exit(1)
if (args[0] === "--version") { console.log("11.0.0"); process.exit(0) }
if (args[0] === "publish") {
  if (args.includes("--dry-run")) process.exit(0)
  const otp = process.env.npm_config_otp || ""
  if (otp !== (process.env.TEST_NO_OTP ? "" : ${JSON.stringify(OTP)})) { console.error("npm error code EOTP"); process.exit(1) }
  process.exit(0)
}
console.error("unexpected npm command"); process.exit(98)
`, 0o755)
  return {
    root,
    bin,
    calls: () => readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)),
    tamper: () => execFileSync("sh", ["-c", "printf x >> dist-npm/tarballs/vibelang-0.0.1.tgz"], { cwd: root })
  }
}
