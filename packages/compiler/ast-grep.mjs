// Build all canonical, shipped tree-sitter grammars into ast-grep's library.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
export function buildAstGrep(output) {
  const shipped = fileURLToPath(new URL("./tree-sitter", import.meta.url))
  const root = existsSync(shipped) ? shipped : fileURLToPath(new URL("../../editors/tree-sitter-vibelang", import.meta.url))
  const manifest = join(root, "tree-sitter.json")
  const sources = existsSync(manifest)
    ? JSON.parse(readFileSync(manifest, "utf8")).grammars.map(grammar => join(root, grammar.path ?? ".", "src"))
    : [existsSync(join(root, "parser.c")) ? root : join(root, "src")]
  if (process.platform === "win32") throw new Error("Build the ast-grep grammar with a C compiler under WSL.")
  const library = resolve(output ?? (process.platform === "darwin" ? "vibelang.dylib" : "vibelang.so"))
  mkdirSync(dirname(library), { recursive: true })
  const result = spawnSync(process.env.CC ?? "cc", [
    process.platform === "darwin" ? "-dynamiclib" : "-shared", "-fPIC", "-O1",
    ...sources.flatMap(source => ["-I", source, join(source, "parser.c"),
      ...(existsSync(join(source, "scanner.c")) ? [join(source, "scanner.c")] : [])]),
    "-o", library
  ], { encoding: "utf8" })
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr)
  return library
}
