// Probe projects for the legacy entry-dispatch migration cases
// (docs/design/src/007-tooling.md#legacy-entry-dispatch-migration). Each probe
// is a fresh project under the case's out/probes that resolves packages
// through the case's node_modules, so stubs/ stands in for platform packages.
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const compiler = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../built/local/tsc", import.meta.url))

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 })
  if (result.error) throw result.error
  return { status: result.status, stdout: result.stdout ?? "", output: (result.stdout ?? "") + (result.stderr ?? "") }
}

// probe writes files into a new project named name and returns its commands.
export function probe(caseURL, name, files, { compilerOptions = {}, type = "module" } = {}) {
  const base = path.dirname(fileURLToPath(caseURL))
  const dir = path.join(base, "out", "probes", name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: `@entry-migration/${name}`, private: true, type }))
  fs.symlinkSync(path.join(base, "node_modules"), path.join(dir, "node_modules"), "dir")
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text)
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "es2022", lib: ["esnext"], module: "nodenext", moduleResolution: "nodenext", strict: true, types: [],
      skipLibCheck: true, declaration: true, rewriteRelativeImportExtensions: true, outDir: "build", ...compilerOptions,
    },
    include: ["*.vibe"],
  }))
  return {
    dir,
    read: (file) => fs.readFileSync(path.join(dir, file), "utf8"),
    compile: (...args) => run(compiler, ["--pretty", "false", ...args, "-p", "tsconfig.json"], dir),
    node: (file) => run(process.execPath, [file], dir),
  }
}

// codes lists the distinct error codes in compiler output.
export const codes = (output) => [...new Set([...output.matchAll(/error ((?:TS|EK)\d+):/g)].map((m) => m[1]))].sort()

// marked reports whether source still imports a retired platform entry marker.
export const marked = (text) => /["']vibelang\/platform\/(?:node|bun|browser)["']/.test(text)

// unmarked is source without its marker line, for comparing a marker-only removal.
export const unmarked = (text) => text.split("\n").filter((line) => !marked(line)).join("\n").replace(/^\n+/, "")

// sameLines compares two sources ignoring blank lines.
export const sameLines = (text) => text.split("\n").filter((line) => line.trim() !== "")
