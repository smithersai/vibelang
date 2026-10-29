import { diagnosticsForFile } from "./diagnostics.mjs"
// bun --preload vibelang/bun: Bun loads .vibe modules from source.
//
// The Bun counterpart of vibelang/register, for `bun run`, `bun test`, and a
// bunfig.toml `preload`. A .vibe module's JavaScript comes from one
// whole-project compile per tsconfig per process: emit is type-directed, so no
// module compiles alone. The project is the nearest tsconfig.json above the
// module, or VIBELANG_PROJECT for the modules in its directory (a module of
// another workspace package compiles with its own tsconfig.json). A compile's result is cached on disk
// (vibelang/project), so a later process reuses it while the project's inputs
// are unchanged. A module declaration of a .vibe module is a module of its
// own, main.vibe.text.js beside main.vibe for module text (D403), which is not
// on disk; its JavaScript comes from the same compile.
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { compileProjectSync, formatDiagnostic, moduleDeclarationSource, nearestProject, workspaceProject } from "./project.mjs"

if (typeof Bun === "undefined") {
  throw new Error("vibelang/bun is a Bun preload; under Node, use node --import vibelang/register")
}

const results = new Map()

function projectOf(file) {
  if (process.env.VIBELANG_PROJECT) {
    const named = resolve(process.env.VIBELANG_PROJECT)
    return workspaceProject(file, dirname(named), named)
  }
  const project = nearestProject(file)
  if (project === undefined) throw new Error(`vibelang/bun: no tsconfig.json above ${file}`)
  return project
}

function emitted(file) {
  file = resolve(file)
  const project = projectOf(file)
  let result = results.get(project)
  if (result === undefined) {
    result = compileProjectSync({ project })
    results.set(project, result)
  }
  const errors = diagnosticsForFile(result.errors, file, result.files)
  if (errors.length) {
    throw new Error(`vibelang: ${project} did not compile\n${errors.map(formatDiagnostic).join("\n")}`)
  }
  const output = result.outputs.get(file)
  if (output === undefined) {
    throw new Error(`vibelang/bun: ${project} does not include ${file}; set VIBELANG_PROJECT to a tsconfig that does`)
  }
  return output
}

// A module declaration's output that is not on disk: the compile serves it.
function isModuleOutput(path) {
  const source = path === undefined ? undefined : moduleDeclarationSource(path)
  return source !== undefined && !existsSync(path) && existsSync(source)
}

// Bun loads a file that is not on disk only from a namespace of the plugin's
// own; an importer in it names it before its path.
const moduleNamespace = "vibelang-module"
const pathOf = (importer) => importer?.startsWith(`${moduleNamespace}:`) ? importer.slice(moduleNamespace.length + 1) : importer

Bun.plugin({
  name: "vibelang",
  setup(build) {
    // vibelang rewrites a .vibe module's relative imports to the emitted .js
    // names, and a TypeScript module imports a .vibe module that replaced its
    // .ts file by the same .js name. From source, a missing ./x.js is the .vibe
    // file beside it, or a module declaration's output. Bun maps a missing .js
    // to its .ts or .tsx file itself, except from a module declaration's output.
    build.onResolve({ filter: /^\.\.?\/.*\.js$/ }, ({ path, importer }) => {
      const fromModule = importer?.startsWith(`${moduleNamespace}:`)
      importer = pathOf(importer)
      if (importer === undefined || /[\\/]node_modules[\\/]/.test(importer)) return undefined
      const target = resolve(dirname(importer), path)
      if (existsSync(target)) return fromModule ? { path: target } : undefined
      if (isModuleOutput(target)) return { path: target, namespace: moduleNamespace }
      // A TypeScript module's own .ts or .tsx file still wins, as without vibelang.
      if (!importer.endsWith(".vibe") && !fromModule && [".ts", ".tsx"].some((extension) => existsSync(target.slice(0, -".js".length) + extension))) return undefined
      for (const extension of fromModule ? [".vibe", ".ts", ".tsx"] : [".vibe"]) {
        const source = target.slice(0, -".js".length) + extension
        if (existsSync(source)) return { path: source }
      }
      return undefined
    })
    // Bun 1.4.2 ignores a plugin's source maps, so the module is its JavaScript alone.
    build.onLoad({ filter: /\.vibe$/ }, ({ path }) => ({ contents: emitted(path).code, loader: "js" }))
    build.onLoad({ filter: /\.js$/, namespace: moduleNamespace }, ({ path }) => ({ contents: emitted(path).code, loader: "js" }))
  }
})
