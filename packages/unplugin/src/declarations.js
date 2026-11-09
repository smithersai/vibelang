import { execFile } from "node:child_process"
import { existsSync, mkdtempSync, realpathSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, parse, relative, resolve } from "node:path"

// Declaration bundlers follow a different graph from the JavaScript graph.
// Keep the compiler's declarations private and let its ordinary declaration
// emitter resolve their types and relative imports, including module bodies.
export function declarationEmitter({ backend, compiler, debug }) {
  const projects = new Map()
  const children = new Set()
  const modules = new Map()
  function run(file, args, root) {
    return new Promise((done) => {
      const child = execFile(file, args, {
        cwd: root, encoding: "utf8", maxBuffer: 1 << 30,
        env: { ...process.env, VIBELANG_COMPILER_PARENT_PID: String(process.pid) }
      }, (error, stdout, stderr) => {
        children.delete(child)
        done({ status: error?.code ?? 0, signal: error?.signal, output: stdout + stderr })
      })
      children.add(child)
    })
  }
  async function emit(project) {
    const api = backend()
    const root = api.packageRoot(project)
    let parent = tmpdir()
    while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent)
    const directory = mkdtempSync(join(parent, "vibelang-declarations-"))
    const filesystemRoot = parse(resolve(root)).root
    const started = Date.now()
    debug(`declaration compile start: ${project}`)
    try {
      const [file, args] = api.compilerCommand(compiler(), [
        "--project", project, "--project-emit", "--loader-root", root, "--pretty", "false",
        "--rootDir", filesystemRoot, "--outDir", directory, "--declarationDir", directory,
        "--declaration", "true", "--declarationMap", "false", "--emitDeclarationOnly", "true",
        "--noEmit", "false", "--noEmitOnError", "false", "--composite", "false", "--incremental", "false",
        "--rewriteRelativeImportExtensions", "true"
      ])
      const result = await run(file, args, root)
      debug(`declaration compile finish: ${project}; status=${result.status}; ms=${Date.now() - started}`)
      return { directory, filesystemRoot, result, root }
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }
  return {
    async resolve(source, project, inputs = []) {
      let entry = projects.get(project)
      if (!entry) {
        entry = emit(project)
        projects.set(project, entry)
      }
      const { directory, filesystemRoot, result, root } = await entry
      const api = backend()
      const parsed = api.parseOutput(result.output, root)
      const canonical = path => { try { return realpathSync(path) } catch { return resolve(path) } }
      const errors = parsed.diagnostics.filter(d => d.category === "error" && (!d.file || canonical(d.file) === canonical(source)))
      if (errors.length) throw new Error(errors.map(api.formatDiagnostic).join("\n"))
      for (const file of new Set([resolve(source), canonical(source)])) {
        const output = join(directory, relative(filesystemRoot, file.replace(/\.vibex?$/, ".d.ts")))
        if (existsSync(output)) {
          const id = resolve(source) + ".d.ts"
          modules.set(id, { output, source, inputs: [...new Set([project, source, ...inputs])] })
          debug(`declaration import: ${source} -> ${id}`)
          return id
        }
      }
      throw new Error(`VibeLang declaration compile did not emit ${source} (status ${result.signal || result.status})`)
    },
    has(id) { return modules.has(id) },
    sourceOf(id) { return modules.get(id)?.source },
    async load(id) {
      const module = modules.get(id)
      return module && { code: await readFile(module.output, "utf8"), inputs: module.inputs }
    },
    async close() {
      modules.clear()
      const pending = [...projects.values()]
      projects.clear()
      for (const child of children) child.kill()
      const finished = await Promise.allSettled(pending)
      await Promise.all(finished.filter(r => r.status === "fulfilled").map(r => rm(r.value.directory, { recursive: true, force: true })))
    }
  }
}
