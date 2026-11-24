import { checkedOverride, executablePath } from "./compiler-override.mjs"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// Supported native compiler platforms; Windows uses @smthrs/cli-<platform>.
const platforms = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]
const executable = process.platform === "win32" ? "vibelang.exe" : "vibelang"

// resolveNativeBinary locates the native compiler executable without exiting:
// VIBELANG_BINARY (resolved from PATH or cwd), else native/<exe> beside the
// package, else the installed platform package, or undefined if none exists.
export function resolveNativeBinary({
  from = import.meta.url,
  packageDir = fileURLToPath(new URL(".", import.meta.url)),
  launcher = fileURLToPath(new URL("./bin/vibelang", import.meta.url))
} = {}) {
  if (process.env.VIBELANG_BINARY) {
    return executablePath(checkedOverride(process.env.VIBELANG_BINARY, launcher))
  }
  const local = join(packageDir, "native", executable)
  if (existsSync(local)) return local
  const target = `${process.platform}-${process.arch}`
  const name = process.platform === "win32" ? `@smthrs/cli-${target}` : `vibelang-${target}`
  try {
    const manifest = createRequire(from).resolve(`${name}/package.json`)
    return join(dirname(manifest), "bin", executable)
  } catch {
    return undefined
  }
}

// findBinary returns the native compiler: VIBELANG_BINARY, else native/vibelang
// beside this package (a checkout build), else the installed platform package.
export function findBinary() {
  const found = resolveNativeBinary()
  if (found !== undefined) return found
  const target = `${process.platform}-${process.arch}`
  const name = process.platform === "win32" ? `@smthrs/cli-${target}` : `vibelang-${target}`
  const lines = [
    `vibelang: no native compiler is installed for ${target}.`,
    `vibelang ships native compilers for ${platforms.join(", ")}.`
  ]
  if (platforms.includes(target)) {
    lines.push(`Reinstall without omitting optional dependencies so ${name} installs.`)
  }
  lines.push("In a VibeLang checkout, run sh scripts/build-vibelang.sh, or set VIBELANG_BINARY.")
  throw Object.assign(new Error(lines.join("\n")), { code: "ERR_VIBELANG_BINARY" })
}
