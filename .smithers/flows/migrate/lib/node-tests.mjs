// Node's own test runner and Smithers' Node runtime (@smthrs/targets). Plain
// `node --test` loads a .vibe module only through vibelang/register: without
// it the run fails with ERR_UNKNOWN_FILE_EXTENSION ".vibe" (Smithers'
// ci-repository: codingHostSize, egress and repository, 2026-11-03). Setup
// preloads the loader in each package script that runs `node --test`, and in
// each literal `Runtime.Node({ ... })` a PACKAGE.ts declares, through the
// runtime's `imports` list, which Smithers turns into `--import` flags before
// every program the runtime runs. Both only where the package reaches
// migrated sources.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { preloadRegister } from "./oxlint-plugins.mjs"
import { packagesReaching } from "./wire.mjs"
import { localPackageDependencies } from "./workspace-dependencies.mjs"

const registration = "vibelang/register"

/** A command that runs Node's own test runner. */
export const runsNodeTest = (words) => words[0] === "node" && words.includes("--test")

// `Runtime.Node`, `Smithers.Runtime.Node`, `S.Runtime.Node`.
const runtimeNode = (ts, node) => ts.isPropertyAccessExpression(node) && node.name.text === "Node" &&
  ((ts.isIdentifier(node.expression) && node.expression.text === "Runtime") ||
    (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "Runtime"))
const propertyName = (ts, p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) ? p.name.text : undefined

/**
 * text, a PACKAGE.ts, with vibelang/register last in the `imports` of each
 * literal `Runtime.Node({ ... })`: added to the list, or the list added.
 * A declaration whose options or list is not a literal is left as written
 * and returned in refusals with its line.
 */
export function addRuntimeImport(text, ts, file = "PACKAGE.ts") {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const edits = [], refusals = []
  const line = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
  const entry = JSON.stringify(registration)
  // After the last element of a list: `, x`, or on its own line where the list is one per line.
  const append = (list, open, item) => {
    const last = list.at(-1)
    if (!last) return { at: open.getStart(source) + 1, text: open.kind === ts.SyntaxKind.ObjectLiteralExpression ? ` ${item} ` : item, end: open.getEnd() - 1, replace: true }
    const multiline = source.getLineAndCharacterOfPosition(last.getStart(source)).line !== source.getLineAndCharacterOfPosition(open.getStart(source)).line
    const indent = multiline ? /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", last.getStart(source)) + 1))[0] : ""
    if (list.hasTrailingComma) {
      const comma = text.indexOf(",", last.getEnd()) + 1
      return { at: comma, text: multiline ? `\n${indent}${item},` : ` ${item},` }
    }
    return { at: last.getEnd(), text: multiline ? `,\n${indent}${item}` : `, ${item}` }
  }
  const visit = (node) => {
    if (ts.isCallExpression(node) && runtimeNode(ts, node.expression)) {
      const options = node.arguments[0]
      if (node.arguments.length !== 1 || !ts.isObjectLiteralExpression(options)) {
        refusals.push({ line: line(node), reason: `add "${registration}" to this Node runtime's imports by hand` })
      } else {
        const imports = options.properties.find((p) => propertyName(ts, p) === "imports")
        if (!imports) edits.push(append(options.properties, options, `imports: [${entry}]`))
        else if (!ts.isPropertyAssignment(imports) || !ts.isArrayLiteralExpression(imports.initializer) ||
            !imports.initializer.elements.every((e) => ts.isStringLiteralLike(e))) {
          refusals.push({ line: line(imports), reason: `add "${registration}" to this Node runtime's imports by hand` })
        } else if (!imports.initializer.elements.some((e) => e.text === registration)) {
          edits.push(append(imports.initializer.elements, imports.initializer, entry))
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  let out = text
  for (const edit of edits.sort((a, b) => b.at - a.at)) out = out.slice(0, edit.at) + edit.text + out.slice(edit.replace ? edit.end : edit.at)
  return { text: out, refusals }
}

// Directories the PACKAGE.ts walk skips: dependencies, version control, emitted
// output, and the fixtures, templates and tests a package ships rather than builds.
const skipped = (name) => name === "node_modules" || name === ".git" || name === ".jj" || name === ".vibelang" ||
  /fixture/i.test(name) || name === "templates" || name === "test" || name === "tests" || name === "__tests__"

function packageFiles(root) {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = dir ? posix.join(dir, entry.name) : entry.name
      if (entry.isDirectory()) { if (!skipped(entry.name)) walk(path) }
      else if (entry.name === "PACKAGE.ts") found.push(path)
    }
  }
  walk("")
  return found
}

/**
 * Preloads vibelang/register for Node's test runner where it reaches
 * migrated sources (packages holds the migrated packages' directories):
 * each `node --test` package script, and each Node runtime a PACKAGE.ts
 * declares. A package that gains a preload and lists no compiler gets
 * vibelang as a dev dependency, since `--import` resolves it from there.
 */
export function wireNodeTests({ root, packages, ts, specsFor }) {
  const changed = [], warnings = []
  const write = (file, before, after) => {
    if (before === after) return
    writeFileSync(join(root, file), after)
    changed.push(file)
  }
  const reaching = packagesReaching(root, packages.map((pkg) => pkg.dir))
  const reached = new Set(reaching.map((pkg) => pkg.dir))
  const localDependencies = localPackageDependencies(root, new Map(reaching.filter(pkg => pkg.manifest.name).map(pkg => [pkg.manifest.name, pkg])))
  const manifests = new Map(reaching.map((pkg) => [pkg.dir, pkg.manifest]))
  // A PACKAGE.ts belongs to its nearest package.json. A hidden directory's
  // package (.smithers/flows) is outside the workspace walk: it reaches
  // migrated sources when it depends on a package that does.
  const owner = (file) => {
    for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
      if (existsSync(join(root, dir, "package.json"))) {
        if (reached.has(dir)) return dir
        try {
          const manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"))
          if (localDependencies({ dir, manifest }).length) {
            manifests.set(dir, manifest)
            return dir
          }
        } catch {}
        return undefined
      }
      if (dir === ".") return undefined
    }
  }
  const preloaded = new Set()
  for (const pkg of reaching) {
    const scripts = pkg.manifest.scripts
    if (!scripts || typeof scripts !== "object") continue
    const next = Object.fromEntries(Object.entries(scripts).map(([name, command]) => [name, typeof command === "string" ? preloadRegister(command, runsNodeTest) : command]))
    if (JSON.stringify(next) === JSON.stringify(scripts)) continue
    pkg.manifest = { ...pkg.manifest, scripts: next }
    manifests.set(pkg.dir, pkg.manifest)
    preloaded.add(pkg.dir)
  }
  for (const file of packageFiles(root)) {
    const dir = owner(file)
    if (dir === undefined) continue
    const before = readFileSync(join(root, file), "utf8")
    if (!/\bRuntime\.Node\s*\(/.test(before)) continue
    const { text, refusals } = addRuntimeImport(before, ts, file)
    for (const refusal of refusals) warnings.push(`${file}:${refusal.line}: ${refusal.reason}`)
    if (text !== before) { write(file, before, text); preloaded.add(dir) }
  }
  for (const dir of preloaded) {
    const file = posix.join(dir, "package.json")
    let manifest = manifests.get(dir)
    if (!manifest.dependencies?.vibelang && !manifest.devDependencies?.vibelang) {
      manifest = { ...manifest, devDependencies: { ...manifest.devDependencies, vibelang: specsFor(dir).vibelang } }
    }
    const before = readFileSync(join(root, file), "utf8")
    if (JSON.stringify(manifest) !== JSON.stringify(JSON.parse(before))) write(file, before, JSON.stringify(manifest, null, 2) + "\n")
  }
  return { changed, warnings }
}
