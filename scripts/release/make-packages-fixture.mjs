// Local release assembly only: npm pack runs, npm publish never does.

import { execFileSync, spawnSync } from "node:child_process"

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { crc32 } from "node:zlib"
import { dirname, join } from "node:path"

import { fileURLToPath } from "node:url"
import { fixtureCheckout, fixtureRevision } from "./fixture-checkout.mjs"

export const repo = fileURLToPath(new URL("../../", import.meta.url))

export const platformPackage = (platform) => platform.startsWith("win32-") ? `@smthrs/cli-${platform}` : `vibelang-${platform}`

export const platforms = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]

export const json = (file) => JSON.parse(readFileSync(file, "utf8"))

// The compiler package's own files; make-packages writes the others.
export const compilerSources = json(join(repo, "packages/compiler/package.json")).files
  .filter((file) => !["editor", "dprint-plugin.json", "README.md", "LICENSE", "NOTICE"].includes(file))
  .map((file) => `packages/compiler/${file}`)

// A stored zip whose entries carry one modification time, in the DOS header
// fields and in an extended-timestamp field, the way vsce writes a VSIX.
export const vsixFiles = { "extension.vsixmanifest": "<PackageManifest/>\n", "extension/readme.md": "# VibeLang\n" }

export function zipAt(when, files) {
  const dosTime = (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1)
  const dosDate = ((when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate()
  const stamp = Buffer.alloc(9)
  stamp.writeUInt16LE(0x5455, 0); stamp.writeUInt16LE(5, 2); stamp.writeUInt8(1, 4); stamp.writeUInt32LE(Math.floor(when.getTime() / 1000), 5)
  const locals = [], centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), path = Buffer.from(name)
    const fields = (header) => {
      header.writeUInt16LE(dosTime, 0); header.writeUInt16LE(dosDate, 2); header.writeUInt32LE(crc32(data), 4)
      header.writeUInt32LE(data.length, 8); header.writeUInt32LE(data.length, 12); header.writeUInt16LE(path.length, 16); header.writeUInt16LE(stamp.length, 18)
      return header
    }
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0]), fields(Buffer.alloc(20)), path, stamp, data])
    const tail = Buffer.alloc(14); tail.writeUInt32LE(offset, 10)
    centrals.push(Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0, 0, 0, 0]), fields(Buffer.alloc(20)), tail, path, stamp]))
    locals.push(local)
    offset += local.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(centrals.length, 8); end.writeUInt16LE(centrals.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

// Build output, which no revision tracks.
export const buildOutput = ["packages/runtime/dist", "editors/vscode/vibelang.vsix"]

export const checkouts = new Map()

export function fixture(t, checkout = {}) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-release-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const path of ["scripts/release/make-packages.mjs", "scripts/release/zip-times.mjs", "scripts/release/packed-hygiene.mjs", "scripts/release/revision.mjs", "scripts/template-files.mjs", "docs/tools/release-docs.mjs", "LICENSE", "typescript/LICENSE.txt", "typescript/NOTICE.txt", "typescript/tsc/internal/vibelang/identity.go",
    ...["compiler", "runtime", "vite", "create-vibelang", "unplugin", "typescript-shim"].flatMap((name) => [`packages/${name}/package.json`, `packages/${name}/README.md`]),
    ...["bin", "lib", "launcher.mjs", "tsc"].map((name) => `packages/typescript-shim/${name}`),
    ...compilerSources, "editors/tree-sitter-vibelang/tree-sitter.json",
    ...json(join(repo, "editors/tree-sitter-vibelang/tree-sitter.json")).grammars.map(grammar => join("editors/tree-sitter-vibelang", grammar.path ?? ".", "src")), "packages/vite/src", "packages/create-vibelang/bin", "packages/unplugin/src", "templates/app"]) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    cpSync(join(repo, path), join(root, path), { recursive: true, filter: (file) => !["node_modules", "dist", ".prototype"].includes(file.split("/").at(-1)) })
  }
  for (const path of ["packages/runtime/dist/index.js", "packages/runtime/dist/index.d.ts", "packages/runtime/dist/kernel/kernel.js"]) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), `fixture ${path}\n`)
  }
  mkdirSync(join(root, "editors/vscode"), { recursive: true })
  writeFileSync(join(root, "editors/vscode/vibelang.vsix"), zipAt(new Date("2026-11-08T05:04:40Z"), vsixFiles))
  for (const platform of platforms) {
    const binary = join(root, "dist-npm/bin", platform, platform.startsWith("win32") ? "vibelang.exe" : "vibelang")
    mkdirSync(dirname(binary), { recursive: true })
    writeFileSync(binary, Buffer.from(`binary ${platform}\0\xff revision ${fixtureRevision}`))
    writeFileSync(join(root, "dist-npm/bin", platform + ".status"), `platform=${platform}\ncompleted=2026-11-08T05:00:00Z\nexit=0\n`)
  }
  writeFileSync(join(root, "dist-npm/bin/revision"), `revision=${fixtureRevision}\nclean=true\n`)
  checkouts.set(root, fixtureCheckout(root, { ...checkout, untracked: [...buildOutput, ...(checkout.untracked ?? [])] }))
  return root
}

export function assemble(root, ...flags) {
  return spawnSync(process.execPath, [join(root, "scripts/release/make-packages.mjs"), "--skip-build", ...flags],
    { encoding: "utf8", timeout: 120_000, env: { ...process.env, PATH: checkouts.get(root).bin + ":" + process.env.PATH } })
}

export function listing(root, name) {
  const { file } = json(join(root, "dist-npm/tarballs/manifest.json")).packages.find((pkg) => pkg.name === name)
  return execFileSync("tar", ["-tzf", join(root, "dist-npm/tarballs", file)], { encoding: "utf8" }).split("\n").filter(Boolean)
}

export function archive(root, name, path) {
  const { file } = json(join(root, "dist-npm/tarballs/manifest.json")).packages.find((pkg) => pkg.name === name)
  return execFileSync("tar", ["-xOzf", join(root, "dist-npm/tarballs", file), `package/${path}`], { maxBuffer: 64 * 1024 * 1024 })
}

export function unzipped(root, vsix) {
  const file = join(root, "packed.vsix")
  writeFileSync(file, vsix)
  return Object.fromEntries(Object.keys(vsixFiles).map((name) => [name, execFileSync("unzip", ["-p", file, name], { encoding: "utf8" })]))
}

// Files a maintainer has lying in the source directories: a secret, lockfiles
// from a local install, an editor scratch file, test output.
export const strays = {
  "templates/app/.env": "create-vibelang",
  "templates/app/package-lock.json": "create-vibelang",
  "templates/app/pnpm-lock.yaml": "create-vibelang",
  "templates/app/src/notes.txt": "create-vibelang",
  "packages/vite/src/scratch.js": "vibelang-vite",
  "packages/unplugin/src/scratch.js": "vibelang-unplugin",
  "packages/typescript-shim/lib/output.log": "vibelang-typescript",
  "packages/create-vibelang/bin/debug.mjs": "create-vibelang",
  "packages/compiler/bin/core": "vibelang",
  "packages/compiler/skills/vibelang/draft.md": "vibelang",
  "editors/tree-sitter-vibelang/src/parser.o": "vibelang",
}

// A normal build uses a stand-in for bun, but real assembly and npm pack.
// Like tsc, this builder writes current outputs without deleting old ones.
export function buildAndAssemble(root, failure = "") {
  const bin = checkouts.get(root).bin
  const freshVsix = join(bin, "fresh.vsix")
  writeFileSync(freshVsix, zipAt(new Date("2026-11-08T05:04:40Z"), {
    ...vsixFiles, "extension/readme.md": "# Fresh build\n"
  }))
  writeFileSync(join(bin, "bun"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path")
const args = process.argv.slice(2)
if (args[0] === "install") process.exit(0)
const phase = path.basename(process.cwd()) === "runtime" ? "runtime" : "extension"
if (args[0] !== "run" || args[1] !== (phase === "runtime" ? "build" : "package")) process.exit(91)
if (phase === process.env.TEST_RELEASE_BUILD_FAILURE) process.exit(23)
if (phase === "runtime") {
  for (const file of ["index.js", "index.d.ts", "kernel/kernel.js"]) {
    const target = path.join("dist", file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, "fresh " + file)
  }
} else fs.copyFileSync(${JSON.stringify(freshVsix)}, "vibelang.vsix")
`, { mode: 0o755 })
  return spawnSync(process.execPath, [join(root, "scripts/release/make-packages.mjs")], {
    encoding: "utf8", timeout: 120_000,
    env: { ...process.env, PATH: bin + ":" + process.env.PATH, TEST_RELEASE_BUILD_FAILURE: failure }
  })
}
