// Chapter 001/005 coverage runners use the stock compiler pinned by docs/tools.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

export const repo = fileURLToPath(new URL("../../../", import.meta.url))
export const compiler = fileURLToPath(new URL("../../built/local/tsc", import.meta.url))
export const stock = fileURLToPath(new URL("../../../docs/tools/node_modules/typescript/bin/tsc", import.meta.url))
assert.equal(JSON.parse(fs.readFileSync(path.resolve(path.dirname(stock), "../package.json"), "utf8")).version, "5.9.3")

export function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024, ...options })
  if (result.error) throw result.error
  return { ...result, output: (result.stdout ?? "") + (result.stderr ?? "") }
}
export function check(project, args = []) {
  return run(compiler, ["--pretty", "false", ...args, "-p", project.dir], project.dir)
}
export function nativeCheck(project, config = "tsconfig.json") {
  return run(process.execPath, [stock, "--pretty", "false", "-p", path.join(project.dir, config)], project.dir)
}
export function project(caseURL, name, files, options = {}) {
  assert.match(name, /^[a-z0-9-]+$/)
  const base = path.dirname(fileURLToPath(caseURL))
  const dir = path.join(base, "out", "probes", name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@coverage/" + name, type: "module", private: true }))
  fs.symlinkSync(path.join(base, "node_modules"), path.join(dir, "node_modules"), "dir")
  for (const [name, source] of Object.entries(files)) {
    const target = path.join(dir, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, source)
  }
  const config = {
    compilerOptions: { strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", skipLibCheck: true, types: [], outDir: "build", noEmit: true, ...options.compilerOptions },
    files: options.files ?? Object.keys(files).filter(name => /\.(?:vibe|vibex|ts|tsx)$/.test(name) && !/\.d\./.test(name)),
    ...(options.vibe ? { vibe: options.vibe } : {})
  }
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(config))
  return { dir, config, read: name => fs.readFileSync(path.join(dir, name), "utf8"), write: (name, text) => fs.writeFileSync(path.join(dir, name), text) }
}
export const codes = output => [...new Set([...output.matchAll(/error ((?:TS|EK)\d+):/g)].map(m => m[1]))].sort()
