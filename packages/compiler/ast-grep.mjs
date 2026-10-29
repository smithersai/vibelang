// Build the canonical, shipped tree-sitter grammar for ast-grep.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
export function buildAstGrep(output) {
  const shipped = fileURLToPath(new URL("./tree-sitter", import.meta.url))
  const source = existsSync(shipped) ? shipped : fileURLToPath(new URL("../../editors/tree-sitter-vibelang/src", import.meta.url))
  if (process.platform === "win32") throw new Error("Build the ast-grep grammar with a C compiler under WSL.")
  const library = resolve(output ?? (process.platform === "darwin" ? "vibelang.dylib" : "vibelang.so"))
  mkdirSync(dirname(library), { recursive: true })
  const result = spawnSync(process.env.CC ?? "cc", [
    process.platform === "darwin" ? "-dynamiclib" : "-shared", "-fPIC", "-O1",
    "-I", source, join(source, "parser.c"), join(source, "scanner.c"), "-o", library
  ], { encoding: "utf8" })
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr)
  return library
}
