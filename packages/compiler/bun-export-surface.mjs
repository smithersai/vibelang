// Keep Bun export inspection separate from module registration and resolution.
// Reading an emitted alias must preserve the native source namespace without executing it.
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

export function exportsDefault(file, emitted, loaderOf) {
  const vibe = /\.vibex?$/.test(file)
  const code = vibe ? emitted(file).code : readFileSync(file, "utf8")
  const transpiler = new Bun.Transpiler({ loader: vibe ? (file.endsWith(".vibex") ? "jsx" : "js") : loaderOf(file) })
  const { exports } = transpiler.scan(transpiler.transformSync(code))
  if (exports.includes("default")) return true
  if (vibe || exports.length > 0) return false
  // For an ambiguous native script, Bun decides CommonJS interop without
  // executing the module. Keep this synchronous for require() callers.
  const built = spawnSync(process.execPath, ["build", file, "--format=esm", "--target=bun", "--external=*"], { encoding: "utf8" })
  if (built.status !== 0) throw new Error("vibelang/bun: cannot inspect exports of " + file + "\n" + built.stderr)
  return new Bun.Transpiler({ loader: "js" }).scan(built.stdout).exports.includes("default")
}
