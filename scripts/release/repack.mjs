#!/usr/bin/env node
// Derive vibelang's tarball for the platforms VIBELANG_SKIP leaves in.
// No build or staging tree is used. The first run keeps the assembled tarball
// as vibelang-<version>.full.tgz with its manifest entry beside it, and every
// run derives the published tarball from that copy, so the result depends only
// on the current VIBELANG_SKIP: a run without it restores every platform.
// All payloads except package.json and the dprint plugin manifest, which lose
// the skipped platforms, stay byte-identical, including the launcher and the
// packaged editor extension. The run fails unless the full tarball lists
// exactly the platform packages of manifest.json.
//
//   VIBELANG_SKIP=win32 node scripts/release/repack.mjs [tarball-directory]
import { deepStrictEqual } from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

function payload(dir) {
  return readdirSync(dir, { recursive: true }).sort().flatMap((path) => {
    const file = join(dir, path)
    const stat = lstatSync(file)
    if (stat.isDirectory()) return []
    return [{ path, mode: stat.mode & 0o777, content: stat.isSymbolicLink() ? readlinkSync(file) : readFileSync(file) }]
  })
}

const platformPackage = /^(?:vibelang|@smthrs\/cli)-(?:darwin|linux|win32)-(?:arm64|x64)$/
const same = (left, right) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
// Write through the destination filesystem so TMPDIR can be another mount.
function replace(path, content) {
  const next = `${path}.repack`
  try {
    writeFileSync(next, content)
    renameSync(next, path)
  } finally {
    rmSync(next, { force: true })
  }
}

export function repack(tarballs, skip = process.env.VIBELANG_SKIP ?? "") {
  tarballs = resolve(tarballs)
  const manifestPath = join(tarballs, "manifest.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const entry = manifest.packages.find((pkg) => pkg.name === "vibelang")
  if (!entry) throw new Error("repack: manifest.json has no vibelang package")
  const tarball = join(tarballs, entry.file)
  const full = tarball.replace(/\.tgz$/, ".full.tgz")
  const fullEntry = tarball.replace(/\.tgz$/, ".full.json")
  const kept = existsSync(full)
  if (kept !== existsSync(fullEntry)) throw new Error(`repack: ${basename(full)} and ${basename(fullEntry)} must both exist; run make-packages.mjs again`)
  const source = kept ? full : tarball
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-repack-"))
  try {
    execFileSync("tar", ["-xzf", source, "-C", scratch])
    const dir = join(scratch, "package")
    const packagePath = join(dir, "package.json")
    const pkg = JSON.parse(readFileSync(packagePath, "utf8"))
    if (pkg.name !== "vibelang" || pkg.version !== manifest.version || pkg.version !== entry.version) {
      throw new Error(`repack: expected vibelang@${manifest.version}, got ${pkg.name}@${pkg.version}`)
    }
    // A tarball an earlier skip run stripped in place has no full copy to
    // restore from; publishing it would leave those platforms without a compiler.
    const platforms = manifest.packages.map((item) => item.name).filter((name) => platformPackage.test(name))
    const optional = Object.keys(pkg.optionalDependencies ?? {})
    if (!same(optional, platforms)) {
      throw new Error(`repack: ${basename(source)} lists optionalDependencies [${optional.join(", ")}], but manifest.json has the platform packages [${platforms.join(", ")}]; run make-packages.mjs again`)
    }
    const pluginPath = join(dir, "dprint-plugin.json")
    if (!existsSync(pluginPath)) throw new Error(`repack: ${basename(source)} is missing dprint-plugin.json; run make-packages.mjs again`)
    const plugin = JSON.parse(readFileSync(pluginPath, "utf8"))
    const pluginPackage = (key) => /^npm:(.+)@[^@]+$/.exec(plugin[key]?.reference?.split("/bin/")[0] ?? "")?.[1]
    if (plugin) {
      const referenced = Object.keys(plugin).map(pluginPackage).filter(Boolean)
      if (!same(referenced, platforms)) {
        throw new Error(`repack: ${basename(source)}'s dprint-plugin.json references [${referenced.join(", ")}], but manifest.json has the platform packages [${platforms.join(", ")}]; run make-packages.mjs again`)
      }
    }
    const original = kept ? JSON.parse(readFileSync(fullEntry, "utf8")) : { ...entry }
    if (!kept) {
      writeFileSync(fullEntry, JSON.stringify(original, null, 2) + "\n")
      replace(full, readFileSync(tarball))
    }
    const patterns = skip.split(/[,\s]+/).filter(Boolean)
    const removed = optional.filter((name) => patterns.some((pattern) => name.includes(pattern)))
    let content = readFileSync(full)
    let next = original
    if (removed.length) {
      for (const name of removed) delete pkg.optionalDependencies[name]
      writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n")
      if (plugin) {
        // dprint must not fetch a platform package that is not published.
        for (const key of Object.keys(plugin)) if (removed.includes(pluginPackage(key))) delete plugin[key]
        writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + "\n")
      }
      const expected = payload(dir)
      const packedDir = join(scratch, "packed")
      mkdirSync(packedDir)
      const [packed] = JSON.parse(execFileSync("npm", ["pack", dir, "--pack-destination", packedDir, "--ignore-scripts", "--json", "--silent"], { encoding: "utf8" }))
      if (packed.name !== pkg.name || packed.version !== pkg.version || packed.filename !== entry.file) {
        throw new Error("repack: npm pack changed the package identity")
      }
      const repacked = join(packedDir, packed.filename)
      const check = join(scratch, "check")
      mkdirSync(check)
      execFileSync("tar", ["-xzf", repacked, "-C", check])
      deepStrictEqual(payload(join(check, "package")), expected, "repack: npm pack changed package files or permissions")
      content = readFileSync(repacked)
      const sha256 = createHash("sha256").update(content).digest("hex")
      next = { ...original, size: packed.size, unpackedSize: packed.unpackedSize, files: packed.files.length, sha256 }
    }
    // Replace the tarball and its manifest entry only after packing and validation.
    if (!readFileSync(tarball).equals(content)) replace(tarball, content)
    if (JSON.stringify(entry) !== JSON.stringify(next)) {
      manifest.packages[manifest.packages.indexOf(entry)] = next
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
    }
    if (removed.length) console.log(`repack: removed ${removed.join(", ")} from vibelang@${pkg.version}`)
    console.log(`repack: vibelang@${pkg.version} optionalDependencies: ${JSON.stringify(pkg.optionalDependencies ?? {})}`)
    console.log(`repack: ${entry.file} sha256 ${createHash("sha256").update(content).digest("hex")}`)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  repack(process.argv[2] ?? fileURLToPath(new URL("../../dist-npm/tarballs/", import.meta.url)))
}
