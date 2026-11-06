import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// Supported native compiler platforms; Windows uses @smthrs/cli-<platform>.
const platforms = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]
const executable = process.platform === "win32" ? "vibelang.exe" : "vibelang"

// findBinary returns the native compiler: VIBELANG_BINARY, else native/vibelang
// beside this package (a checkout build), else the installed platform package.
export function findBinary() {
  if (process.env.VIBELANG_BINARY) return process.env.VIBELANG_BINARY
  const local = fileURLToPath(new URL(`./native/${executable}`, import.meta.url))
  if (existsSync(local)) return local
  const target = `${process.platform}-${process.arch}`
  const name = process.platform === "win32" ? `@smthrs/cli-${target}` : `vibelang-${target}`
  try {
    const manifest = createRequire(import.meta.url).resolve(`${name}/package.json`)
    return join(dirname(manifest), "bin", executable)
  } catch {
    console.error(`vibelang: no native compiler is installed for ${target}.`)
    console.error(`vibelang ships native compilers for ${platforms.join(", ")}.`)
    if (platforms.includes(target)) {
      console.error(`Reinstall without omitting optional dependencies so ${name} installs.`)
    }
    console.error("In a VibeLang checkout, run sh scripts/build-vibelang.sh, or set VIBELANG_BINARY.")
    process.exit(1)
  }
}
