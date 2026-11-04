import { readFileSync, realpathSync, statSync } from "node:fs"
import { isAbsolute, join, resolve, sep } from "node:path"

// Only the external-module operand of these declaration diagnostics may vary.
// Every other message byte, including the exported and inaccessible names, stays.
const operand = / from external module (["'])([^"'\r\n]+)\1 but cannot be named\.$/

function installedReference(reference, cwd) {
  // A pnpm store entry spells the installed version. Retain the entire store
  // prefix, peer suffix, package name and module path in its comparison key.
  const match = /^(.*node_modules\/\.pnpm\/)([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)\/(.+)$/.exec(reference)
  if (!match || (!isAbsolute(reference) && !cwd)) return null
  const [, prefix, entry, name, module] = match
  const encoded = name.replace("/", "+") + "@"
  if (!entry.startsWith(encoded) || module.split("/").some(p => p === "." || p === "..")) return null
  const version = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(.*)$/.exec(entry.slice(encoded.length))
  if (!version || (version[2] && !/^[_()]/.test(version[2]))) return null
  const packageDir = resolve(cwd ?? ".", prefix + entry + "/node_modules/" + name)
  try {
    const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))
    if (manifest.name !== name || manifest.version !== version[1]) return null
    const root = realpathSync(packageDir) + sep
    const file = resolve(packageDir, module)
    const candidates = /\.d\.[cm]?ts$/.test(file) ? [file] : [file + ".d.ts", file + ".d.mts", file + ".d.cts"]
    if (!candidates.some(candidate => {
      try { return statSync(candidate).isFile() && realpathSync(candidate).startsWith(root) }
      catch { return false }
    })) return null
  } catch { return null }
  return {
    key: prefix + encoded + "<version>" + version[2] + "/node_modules/" + name + "/" + module,
    package: name, version: version[1], module
  }
}

/** Prove a path-only package-version change without changing either diagnostic. */
export function dependencyEmitPathSubstitution(before, after, { cwd } = {}) {
  if (!["TS4023", "TS4058"].includes(before.code) || before.code !== after.code) return null
  const a = operand.exec(before.message), b = operand.exec(after.message)
  if (!a || !b || a[2] === b[2]) return null
  const left = installedReference(a[2], cwd), right = installedReference(b[2], cwd)
  if (!left || !right || left.version === right.version || left.key !== right.key) return null
  // Compare outside the proved operand literally, including its quote style.
  const without = (message, match) => message.slice(0, match.index) + " from external module " + match[1] + "<module>" + match[1] + " but cannot be named."
  if (without(before.message, a) !== without(after.message, b)) return null
  return {
    file: after.file, code: after.code, package: left.package, module: left.module,
    before: { path: a[2], version: left.version }, after: { path: b[2], version: right.version }
  }
}
