// vibelang/emit: a .vibe module's JavaScript, for a tool that reads one file.
//
// Metro's Babel transformer, a Babel preset and the React Compiler's Oxc
// transform each read a module's text and parse it as JavaScript or
// TypeScript, which a .vibe module is not. toolSource hands such a tool the
// module's JavaScript from its project's compile (vibelang/project), and
// remapLocations points the syntax tree the tool parses from it back at the
// .vibe source, so the diagnostics and source maps the tool writes name .vibe
// lines. A module's JavaScript comes from one whole-project compile, since
// emit is type-directed; the compile cache (cache.mjs) serves every later
// module of the same project while its inputs are unchanged.
import { readFileSync } from "node:fs"
import { SourceMap } from "node:module"
import { dirname, resolve } from "node:path"
import { diagnosticsForFile } from "./diagnostics.mjs"
import { compileProjectSync, formatDiagnostic, nearestProject, workspaceProject } from "./project.mjs"

/**
 * The project that compiles `file`: VIBELANG_PROJECT for a module in its
 * directory, else the nearest tsconfig.json above the module, as for
 * vibelang/register and vibelang/bun.
 */
export function projectOf(file) {
  if (process.env.VIBELANG_PROJECT) {
    const named = resolve(process.env.VIBELANG_PROJECT)
    return workspaceProject(file, dirname(named), named)
  }
  const project = nearestProject(file)
  if (project === undefined) throw Object.assign(new Error(`vibelang: no tsconfig.json above ${file}`), { code: "ERR_VIBELANG_PROJECT" })
  return project
}

/**
 * The JavaScript and source map that `file`'s project compile emits for the
 * .vibe module `file`. Throws an Error with code ERR_VIBELANG_COMPILE and the
 * module's diagnostics when it has errors, and one with code
 * ERR_VIBELANG_PROJECT when the project does not include it.
 */
export function emitModule(file) {
  file = resolve(file)
  const project = projectOf(file)
  const result = compileProjectSync({ project })
  const errors = diagnosticsForFile(result.errors, file, result.files)
  if (errors.length) {
    throw Object.assign(new Error(`vibelang: ${project} did not compile\n${errors.map(formatDiagnostic).join("\n")}`), { code: "ERR_VIBELANG_COMPILE" })
  }
  const output = result.outputs.get(file)
  if (output === undefined) {
    throw Object.assign(new Error(`vibelang: ${project} does not include ${file}; set VIBELANG_PROJECT to a tsconfig that does`), { code: "ERR_VIBELANG_PROJECT" })
  }
  return output
}

/**
 * What a tool should parse for `file` when it holds `text`: the module's
 * emitted { code, map } when `file` is a .vibe module and `text` is its source
 * as on disk (or omitted), else undefined. A .vibe path with other text holds
 * JavaScript a bundler plugin already compiled, as vibelang-vite hands it to
 * the plugins after it, so the tool parses that text as it is.
 */
export function toolSource(file, text) {
  if (typeof file !== "string" || !file.endsWith(".vibe")) return undefined
  if (text !== undefined && String(text) !== readFileSync(file, "utf8")) return undefined
  return emitModule(file)
}

/**
 * The arguments for a tool called as `tool(filename, text, options)`, such as
 * the transforms of oxc-transform and oxc-transform-react, with a .vibe
 * module's source text replaced by its emitted JavaScript, which the tool
 * parses as JavaScript with JSX (`lang: "jsx"`). Other arguments are returned
 * as they are.
 */
export function toolArguments(filename, text, options) {
  const source = toolSource(filename, text)
  return source === undefined ? [filename, text, options] : [filename, source.code, { ...options, lang: "jsx" }]
}

const isPosition = (value) => typeof value?.line === "number" && typeof value?.column === "number"

/**
 * Moves every location in a Babel or ESTree syntax tree parsed from emitted
 * JavaScript to the .vibe source position `map` gives it, in place: `loc`
 * lines are 1-based and columns 0-based, as Babel writes them. A position
 * between mappings takes the nearest mapping before it; one before the first
 * takes the start of the source. Returns `ast`.
 */
export function remapLocations(ast, map) {
  const sourceMap = new SourceMap(map)
  const moved = new Map() // "line:column" of the emitted JavaScript to the .vibe position
  // Babel shares one position object among nodes that end at the same token.
  const done = new WeakSet()
  const move = (position) => {
    if (done.has(position)) return
    done.add(position)
    const key = `${position.line}:${position.column}`
    let original = moved.get(key)
    if (original === undefined) {
      const entry = sourceMap.findEntry(position.line - 1, position.column)
      original = entry.originalLine === undefined
        ? { line: 1, column: 0 }
        : {
            line: entry.originalLine + 1,
            // Within one mapped segment the text is the source's.
            column: entry.originalColumn + (entry.generatedLine === position.line - 1 ? position.column - entry.generatedColumn : 0)
          }
      moved.set(key, original)
    }
    position.line = original.line
    position.column = original.column
  }
  const seen = new Set()
  const stack = [ast]
  while (stack.length) {
    const value = stack.pop()
    if (typeof value !== "object" || value === null || seen.has(value)) continue
    seen.add(value)
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item)
      continue
    }
    const loc = value.loc
    if (isPosition(loc?.start) && isPosition(loc?.end)) {
      move(loc.start)
      move(loc.end)
    }
    for (const key in value) if (key !== "loc") stack.push(value[key])
  }
  return ast
}
