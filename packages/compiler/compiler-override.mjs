import { accessSync, closeSync, constants, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs"
import { basename, delimiter, dirname, join, resolve, sep } from "node:path"

function executablePath(value) {
  if (value.includes(sep) || process.platform === "win32" && value.includes("/")) return resolve(value)
  const suffixes = process.platform === "win32" ? ["", ...(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";")] : [""]
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    for (const suffix of suffixes) {
      const candidate = resolve(directory, value + suffix)
      try {
        if (!statSync(candidate).isFile()) continue
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch {}
    }
  }
  return resolve(value)
}

function sameFile(left, right) {
  try {
    if (realpathSync(left) === realpathSync(right)) return true
    const a = statSync(left, { bigint: true }), b = statSync(right, { bigint: true })
    return a.ino !== 0n && a.dev === b.dev && a.ino === b.ino
  } catch { return false }
}

function packageLauncher(file) {
  let descriptor
  try {
    file = realpathSync(file)
    if (basename(file) !== "vibelang" || basename(dirname(file)) !== "bin") return false
    if (JSON.parse(readFileSync(join(dirname(file), "../package.json"), "utf8")).name !== "vibelang") return false
    descriptor = openSync(file, "r")
    const header = Buffer.alloc(4096)
    const count = readSync(descriptor, header, 0, header.length, 0)
    const text = header.subarray(0, count).toString("utf8")
    return /^#![^\r\n]*\bnode(?:\s|$)/.test(text) && /\bfindBinary\b/.test(text) && /["']\.\.\/binary\.mjs["']/.test(text)
  } catch { return false }
  finally { if (descriptor !== undefined) closeSync(descriptor) }
}

// An override is a compiler executable. The package launcher would inherit
// the same override and start itself again, including through filesystem aliases.
export function checkedOverride(value, launcher) {
  const file = executablePath(value)
  if (sameFile(file, launcher) || packageLauncher(file)) {
    throw new Error("vibelang: VIBELANG_BINARY points to a JavaScript launcher; select the native compiler executable instead.")
  }
  return value
}
