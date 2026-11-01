// Wire Oxlint commands, including runners launched by package scripts.
// Parse scripts to avoid rewriting comments or unrelated files.
import { readFileSync } from "node:fs"
import { posix } from "node:path"

const command = /(?:^|[\s;&|(])(?:bunx\s+|npx\s+|pnpm\s+(?:exec\s+)?|yarn\s+)?oxlint(?:$|[\s;&|)])/m
const runnerCommand = /(?:^|[;&|(])\s*(?:bunx\s+|npx\s+|pnpm\s+(?:exec\s+)?|yarn\s+)?oxlint(?:$|[\s;&|)])/m
const scriptFile = /(?:^|[\s"'=])((?:\.?\.?\/)?[\w@./-]+\.(?:[cm]?[jt]sx?))(?=$|[\s"'])/g

// An all-Vibe directory leaves no native files. Let the subsequent ESLint
// pass own that case, including when setup is rerun on an older wrapped script.
export function allowEmptyOxlint(text) {
  return text.replace(/((?:^|[\s;&|(])(?:(?:bunx|npx|pnpm(?:\s+exec)?|yarn)\s+)?oxlint)([^;&|)]*)/gm,
    (all, invocation, flags) => flags.includes("--no-error-on-unmatched-pattern") ? all : invocation + " --no-error-on-unmatched-pattern" + flags)
}

function editsOf(text, edits) {
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
  return text
}

function regexWithVibe(text) {
  if (text.includes("vibe")) return text
  // Only extension suffixes: preserve preceding directory constraints,
  // capturing groups and flags.
  return text.replace(/\\\.\((\?:)?((?:[cm]?tsx?\|?)+)\)\$/, (all, noncapture = "", extensions) =>
    "\\.(" + noncapture + extensions + "|vibe)$")
    .replace(/\\\.([cm]?tsx?\??)\$/, "\\.(?:$1|vibe)$")
}

export function addOxlintSelectors(text, ts) {
  const source = ts.createSourceFile("lint.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const edits = [], warnings = []
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "filter") {
      const callback = node.arguments[0]
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        const body = callback.body
        const local = []
        const selector = child => {
          if (child !== body && (ts.isArrowFunction(child) || ts.isFunctionExpression(child))) return
          if (ts.isRegularExpressionLiteral(child) && ts.isPropertyAccessExpression(child.parent) && child.parent.name.text === "test") {
            const before = child.getText(source), after = regexWithVibe(before)
            if (before !== after) local.push({ start: child.getStart(source), end: child.end, text: after })
          }
          if (ts.isCallExpression(child) && ts.isPropertyAccessExpression(child.expression)) {
            const receiver = child.expression.expression
            const argument = child.arguments[0]
            if (child.expression.name.text === "endsWith" && argument && ts.isStringLiteral(argument) && /^\.[cm]?tsx?$/.test(argument.text)) {
              if (ts.isBinaryExpression(child.parent) && child.parent.operatorToken.kind === ts.SyntaxKind.BarBarToken && child.parent.getText(source).includes('.endsWith(".vibe")')) return
              const value = child.getText(source)
              local.push({ start: child.getStart(source), end: child.end, text: "(" + value + " || " + receiver.getText(source) + '.endsWith(".vibe"))' })
              return
            }
            if (child.expression.name.text === "includes" && ts.isArrayLiteralExpression(receiver)) {
              const extensions = receiver.elements.filter(ts.isStringLiteral).map(value => value.text)
              if (extensions.some(value => /^\.?[cm]?tsx?$/.test(value)) && !extensions.some(value => value === "vibe" || value === ".vibe")) {
                const extension = extensions.some(value => value.startsWith(".")) ? ".vibe" : "vibe"
                local.push({ start: receiver.end - 1, end: receiver.end - 1, text: ", " + JSON.stringify(extension) })
                return
              }
            }
          }
          ts.forEachChild(child, selector)
        }
        selector(body)
        if (!local.length && !body.getText(source).includes("vibe") && /\.tsx?/.test(body.getText(source))) {
          warnings.push("could not extend Oxlint's extension filter; add .vibe and exclude .d.vibe.ts by hand")
        }
        if (local.length) {
          const parameter = callback.parameters[0]?.name
          if (!parameter || !ts.isIdentifier(parameter) || ts.isBlock(body)) {
            warnings.push("Oxlint's extension filter has a block body or destructured parameter; add .vibe and exclude .d.vibe.ts by hand")
          } else {
            const start = body.getStart(source)
            const replacement = editsOf(body.getText(source), local.map(edit => ({ ...edit, start: edit.start - start, end: edit.end - start })))
            edits.push({ start, end: body.end, text: "(" + replacement + ') && !' + parameter.text + '.endsWith(".d.vibe.ts")' })
          }
        }
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { text: editsOf(text, edits), warnings }
}

// A package name in metadata is not an executable. Follow local command
// bindings only from known process APIs and shell tags, never every literal.
function commandLiterals(source, ts) {
  const bindings = new Map(), literals = new Set(), seen = new Set()
  const collect = node => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
      const immutable = ts.isVariableDeclaration(node) && (node.parent.flags & ts.NodeFlags.Const)
      bindings.set(node.name.text, bindings.has(node.name.text) || !immutable ? null : node.initializer)
    }
    ts.forEachChild(node, collect)
  }
  collect(source)
  const expression = node => {
    if (!node || seen.has(node)) return
    seen.add(node)
    if (ts.isIdentifier(node)) return expression(bindings.get(node.text))
    if (ts.isArrayLiteralExpression(node)) return expression(node.elements[0])
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { literals.add(node); return }
    if (ts.isTemplateExpression(node)) {
      literals.add(node.head)
      for (const span of node.templateSpans) literals.add(span.literal)
      return
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return expression(node.expression)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) { expression(node.left); expression(node.right) }
  }
  const visit = node => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ""
      if (/^(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|execa|execaSync|execaCommand|execaCommandSync|Command)$/.test(name)) expression(node.arguments?.[0])
    }
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = node.tag
      if ((ts.isIdentifier(tag) && (tag.text === "$" || tag.text === "sh")) ||
          (ts.isPropertyAccessExpression(tag) && tag.name.text === "$")) expression(node.template)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return literals
}

// File-list runners use the repository adapter: upstream Oxlint keeps TS,
// while ESLint runs the same JS plugins against the original VibeLang AST.
export function wireOxlint({ root, all, manifests, ts, write }) {
  const warnings = [], packages = []
  const allowed = new Set(all)
  const parse = file => {
    const text = readFileSync(posix.join(root, file), "utf8")
    return { text, source: ts?.createSourceFile(file, text, ts.ScriptTarget.Latest, true) }
  }
  for (const manifest of manifests) {
    const pkg = JSON.parse(readFileSync(posix.join(root, manifest), "utf8"))
    const dir = posix.dirname(manifest)
    const runners = new Map()
    const explore = file => {
      if (!allowed.has(file) || runners.has(file)) return
      const parsed = parse(file)
      runners.set(file, parsed)
      if (!parsed.source) return
      const imports = node => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith(".")) {
          const name = posix.normalize(posix.join(posix.dirname(file), node.moduleSpecifier.text))
          const candidates = [name, ...[".ts", ".mts", ".js", ".mjs", "/index.ts", "/index.js"].map(ext => name + ext)]
          if (name.endsWith(".js")) candidates.push(name.slice(0, -3) + ".ts")
          const resolved = candidates.find(candidate => allowed.has(candidate))
          if (resolved) explore(resolved)
        }
        ts.forEachChild(node, imports)
      }
      imports(parsed.source)
    }
    for (const script of Object.values(pkg.scripts ?? {})) {
      for (const match of script.matchAll(scriptFile)) explore(posix.normalize(posix.join(dir, match[1])))
    }
    let found = Object.values(pkg.scripts ?? {}).some(script => command.test(script) || script.includes(".vibelang/oxlint.mjs"))
    let runnerRunsOxlint = false
    for (const [file, { text, source }] of runners) {
      let runs = false
      if (!source) {
        if (/\boxlint\b/.test(text)) warnings.push(file + ": a TypeScript API is required to wire this Oxlint runner")
        continue
      }
      for (const node of commandLiterals(source, ts)) {
        if (runnerCommand.test(node.text) || node.text.includes(".vibelang/oxlint.mjs")) runs = true
      }
      if (!runs) continue
      runnerRunsOxlint = true
    }
    found ||= runnerRunsOxlint
    if (runnerRunsOxlint) for (const [file, { text, source }] of runners) {
      if (!source) continue
      const next = addOxlintSelectors(text, ts)
      const up = dir === "." ? "./" : "../".repeat(dir.split("/").length)
      // Runners run from the package-script directory, independent of where an
      // imported helper lives. Preserve template interpolation and shell flags.
      const adapter = up + ".vibelang/oxlint.mjs"
      const parsed = ts.createSourceFile(file, next.text, ts.ScriptTarget.Latest, true)
      const edits = []
      const commands = commandLiterals(parsed, ts)
      const redirect = node => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
        if (commands.has(node)) {
          const before = node.getText(parsed)
          const after = before.replace(/(^["\'`]|[;&|(])([ \t]*)(?:(?:bunx|npx|pnpm(?:\s+exec)?|yarn)\s+)?oxlint(?=$|["\'`\s;&|)])/g, (_all, boundary, space) => boundary + space + adapter)
          if (after !== before) edits.push({ start: node.getStart(parsed), end: node.end, text: after })
        }
        ts.forEachChild(node, redirect)
      }
      redirect(parsed)
      write(file, editsOf(next.text, edits))
      warnings.push(...next.warnings.map(warning => file + ": " + warning))
    }
    if (!found) continue
    for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
      const next = allowEmptyOxlint(script)
      if (next !== script) pkg.scripts[name] = next
    }
    write(manifest, JSON.stringify(pkg, null, 2) + "\n")
    packages.push(dir)
  }
  return { warnings, packages }
}
