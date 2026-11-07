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
    write: (file, text) => fs.writeFileSync(path.join(dir, file), text),
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

// refusal returns the line of a vibelang --fix report that refuses the
// startup of file at line, with the imports and the runner call its reason
// names, or undefined.
export function refusal(output, file, line) {
  const found = output.split("\n").find((text) => text.startsWith(`vibelang --fix: ${file}:${line}: EK2601 not fixed: `))
  if (found === undefined) return undefined
  const quoted = [...found.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  return { line: found, imports: quoted.filter((text) => text.startsWith("import ")), runner: quoted.find((text) => /\.runMain\(/.test(text)) }
}

// following is source as its owner writes it from a refusal's advice: the
// named imports first, the marker gone, and the runner call last.
export const following = (source, advice) => [...advice.imports, unmarked(source).replace(/\n*$/, ""), advice.runner].join("\n") + "\n"

// importer is a module that imports file and prints nothing itself, to see
// whether importing file starts anything.
export const importer = (file) => `await import(${JSON.stringify(file)})\n`

// migrated copies a case's inputs/ into a fresh project, each file under its
// name without .txt, with the case's package.json, hooks.mjs and stubs; runs
// vibelang --fix, which keeps each refused marker while other repairs may
// apply; and applies each refusal as the program's owner would: an
// entry module, which the host starts, gets the advised imports and runner,
// and a module that is only imported loses its marker alone. It returns the
// advice by file, the build after it, and a way to run commands there.
export function migrated(caseURL, entries) {
  const base = path.dirname(fileURLToPath(caseURL))
  const dir = path.join(base, "out", "migrated")
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  for (const name of fs.readdirSync(path.join(base, "inputs"))) fs.copyFileSync(path.join(base, "inputs", name), path.join(dir, name.replace(/\.txt$/, "")))
  for (const name of ["package.json", "hooks.mjs"]) if (fs.existsSync(path.join(base, name))) fs.copyFileSync(path.join(base, name), path.join(dir, name))
  if (fs.existsSync(path.join(base, "stubs"))) fs.cpSync(path.join(base, "stubs"), path.join(dir, "stubs"), { recursive: true })
  fs.symlinkSync(path.join(base, "node_modules"), path.join(dir, "node_modules"), "dir")
  const sources = fs.readdirSync(dir).filter((name) => /\.vibex?$/.test(name))
  const fix = run(compiler, ["--pretty", "false", "--fix", "-p", "tsconfig.json"], dir)
  const advice = {}
  for (const name of sources) {
    const text = fs.readFileSync(path.join(dir, name), "utf8")
    if (!marked(text)) continue
    const line = text.split("\n").findIndex((source) => marked(source)) + 1
    const found = refusal(fix.output, name, line)
    if (found === undefined) throw new Error(`${name}: a kept marker has no refusal at line ${line}\n${fix.output}`)
    advice[name] = found
    fs.writeFileSync(path.join(dir, name), entries.includes(name) ? following(text, found) : unmarked(text))
  }
  const build = run(compiler, ["--pretty", "false", "-p", "tsconfig.json"], dir)
  return {
    dir, fix, advice, build,
    runners: () => Object.fromEntries(Object.entries(advice).map(([name, found]) => [name, found.runner])),
    read: (file) => fs.readFileSync(path.join(dir, file), "utf8"),
    run: (command, args) => run(command, args, dir),
  }
}
