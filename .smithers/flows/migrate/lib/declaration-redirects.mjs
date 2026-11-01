// VIP-27/Chapter 7: language-service consumers read native source sidecars.
// Output-only project redirects cannot map an emitted leaf.d.ts back to the
// foreign .vibe input; keep the project's source redirect for typed tooling.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

export const redirectOption = "disableSourceOfProjectReferenceRedirect"
const property = (ts, object, name) => object.properties.findLast(p =>
  ts.isPropertyAssignment(p) && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name)) && p.name.text === name)

export function enableSourceRedirect(text, ts, { inherited = false } = {}) {
  const source = ts.parseJsonText("tsconfig.json", text)
  const root = source.statements[0]?.expression
  if (source.parseDiagnostics.length || !root || !ts.isObjectLiteralExpression(root)) return text
  const options = property(ts, root, "compilerOptions")
  if (options && !ts.isObjectLiteralExpression(options.initializer)) return text
  const value = options && property(ts, options.initializer, redirectOption)
  if (value) return value.initializer.kind === ts.SyntaxKind.TrueKeyword
    ? text.slice(0, value.initializer.getStart(source)) + "false" + text.slice(value.initializer.end)
    : text
  if (!inherited) return text
  if (options) {
    const object = options.initializer, at = object.getStart(source) + 1
    return text.slice(0, at) + ' "' + redirectOption + '": false' + (object.properties.length ? "," : " ") + text.slice(at)
  }
  const at = root.getStart(source) + 1
  return text.slice(0, at) + ' "compilerOptions": { "' + redirectOption + '": false }' +
    (root.properties.length ? "," : " ") + text.slice(at)
}

/** configs is the caller's owned, non-fixture config inventory. */
export function wireDeclarationRedirects({ root, ts, configs }) {
  const changed = [], edits = []
  const write = (file, before, after, inherited) => {
    if (before === after) return
    writeFileSync(join(root, file), after)
    if (!changed.includes(file)) changed.push(file)
    edits.push({ file, option: redirectOption, from: true, to: false, inherited,
      reason: "typed project consumers must resolve native source declaration sidecars" })
  }
  // First update each owned explicit setting. Children then inherit false
  // without redundant overrides for a shared base we also own.
  for (const file of configs) {
    const text = readFileSync(join(root, file), "utf8")
    write(file, text, enableSourceRedirect(text, ts), false)
  }
  // External presets stay untouched; override only their inheriting config.
  for (const file of [...configs].sort((a, b) => a.split("/").length - b.split("/").length)) {
    const path = resolve(root, file), text = readFileSync(path, "utf8")
    const parsed = ts.parseConfigFileTextToJson(path, text)
    if (parsed.error) continue
    const config = ts.parseJsonConfigFileContent(parsed.config, { ...ts.sys, readDirectory: () => [] }, dirname(path), {}, path)
    if (config.options[redirectOption] === true) write(file, text, enableSourceRedirect(text, ts, { inherited: true }), true)
  }
  return { changed, edits }
}
