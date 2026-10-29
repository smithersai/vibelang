// Runs inside the VS Code that test/run.mjs starts. It checks the VibeLang
// extension installed from vibelang.vsix on a copy of the language server
// fixture (typescript/vibelang/lsp-fixture), whose node_modules/.bin/vibelang
// is the compiler under test. run() throws when any check fails.
const fs = require("node:fs")
const path = require("node:path")
const { spawnSync } = require("node:child_process")
const { pathToFileURL } = require("node:url")
const vscode = require("vscode")

const workspace = process.env.VIBELANG_TEST_WORKSPACE
const extensionsDir = process.env.VIBELANG_TEST_EXTENSIONS
const timeoutMs = Number(process.env.VIBELANG_TEST_TIMEOUT ?? 90_000)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function waitFor(what, probe, limit = timeoutMs) {
  const deadline = Date.now() + limit
  for (;;) {
    const value = await probe()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function open(relative) {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace, relative)))
  await vscode.window.showTextDocument(document, { preview: false })
  return document
}

function positionOf(document, needle, offset = 0) {
  const index = document.getText().indexOf(needle)
  if (index < 0) throw new Error(`${path.basename(document.uri.fsPath)} has no ${JSON.stringify(needle)}`)
  return document.positionAt(index + offset)
}

async function hoverText(document, needle) {
  const hovers = await vscode.commands.executeCommand("vscode.executeHoverProvider", document.uri, positionOf(document, needle))
  return hovers.flatMap((hover) => hover.contents.map((part) => (typeof part === "string" ? part : part.value))).join("\n")
}

// The tokens VS Code's grammars give text, written to grammar/<name> in the
// project, outside the program (tsconfig.json includes only src/). Each token
// is its text, c, and its scopes, t, such as "source.vibe meta.import.ts ...".
async function syntaxTokens(name, text) {
  const file = path.join(workspace, "grammar", name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  const tokens = await vscode.commands.executeCommand("_workbench.captureSyntaxTokens", vscode.Uri.file(file))
  return tokens.map(({ c, t }) => ({ c, t }))
}

// The first token where a .vibe file's tokens differ from a .ts file's, with
// the root scopes source.vibe and source.ts counted as the same, else "".
function firstDifference(vibe, ts) {
  const index = ts.findIndex((token, i) => !vibe[i] || token.c !== vibe[i].c || token.t !== vibe[i].t.replace(/^source\.vibe\b/, "source.ts"))
  return index < 0 ? "" : `token ${index} is ${JSON.stringify(vibe[index])}, TypeScript's is ${JSON.stringify(ts[index])}`
}

function codeOf(diagnostic) {
  return typeof diagnostic.code === "object" ? diagnostic.code.value : diagnostic.code
}

async function editProperties(typescript) {
  const fc = require("fast-check")
  const shared = name => pathToFileURL(path.resolve(__dirname, "../../../../scripts/testing", name)).href
  const { checkProperty } = await import(shared("property.mjs"))
  const { projectArbitrary, projectFiles } = await import(shared("projects.mjs"))
  const extension = typescript ? "ts" : "vibe"
  const name = `editor-edits-${extension}`
  let trace = "", failureTrace = "", sample = 0
  const edits = input => [...input.edits, { broken: true, padding: 0 }, { broken: false, padding: 1 }]
  const sourceFor = (input, edit, version) => {
    let source = "\n".repeat(version * 8 + edit.padding) + `/* 😀 ${input.project.modules[0].text} */ export const revision = __E1_version_${version}\n`
    source += `export const count: number = ${edit.broken ? '"wrong"' : "1"}\nexport { result } from "./n0.vibe"\n`
    if (edit.syntax === "incomplete") source += "export const unfinished = (\n"
    if (edit.syntax === "async") source += "export async function pending() { return 1 }\n"
    return input.crlf ? source.replaceAll("\n", "\r\n") : source
  }
  // D32/D61, Chapter 28 The editor/Diagnostics: the editor uses the compiler
  // and reports its codes at source positions. Fresh CLI output is the oracle;
  // edit/repair equivalence is metamorphic. Astral text and CRLF exercise UTF-16.
  await checkProperty(fc, { name, numRuns: 2, generatorVersion: 2,
    rule: "docs/design/history/src/428-part4-ch28-tooling.md: The editor (D32), Diagnostics (D61); metamorphic edit/repair equivalence",
    command: "bun run test", regressions: pathToFileURL(path.resolve(__dirname, "../property-regressions") + path.sep),
    arbitrary: fc.record({ project: projectArbitrary(fc), crlf: fc.boolean(),
      edits: fc.array(fc.record({ broken: fc.boolean(), syntax: fc.constantFrom("complete", "incomplete", "async"), padding: fc.integer({ min: 0, max: 3 }),
        dependency: fc.boolean() }), { minLength: 1, maxLength: 4 }) }),
    diagnostics: () => failureTrace,
    artifacts: input => ({ ...projectFiles(input.project).files,
      ...Object.fromEntries(Object.entries(projectFiles(input.project, true).files).map(([file, source]) => [`edited/${file}`, source])),
      ...Object.fromEntries(edits(input).map((edit, step) => [`revisions/${step}/editor.${extension}`, sourceFor(input, edit, step + 2)])) }),
    check: async (input) => {
      const root = path.join(workspace, `property-${extension}-${sample++}`)
      const generated = projectFiles(input.project)
      trace = `E1 ${name}: setup\n`
      for (const [file, source] of Object.entries(generated.files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
        fs.writeFileSync(path.join(root, file), source)
      }
      const target = `${input.project.directory}/editor.${extension}`
      fs.writeFileSync(path.join(root, target), "export {}\n")
      const document = await open(path.relative(workspace, path.join(root, target)))
      try {
        // Always check an invalid revision followed by a repair, in addition to
        // the generated edits; an empty old diagnostic collection cannot pass.
        for (const [step, edit] of edits(input).entries()) {
          if (edit.dependency) {
            for (const [file, source] of Object.entries(projectFiles(input.project, step % 2 === 0).files)) {
              if (!file.endsWith(".vibe") && !file.endsWith(".ts")) continue
              const dependency = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(root, file)))
              const change = new vscode.WorkspaceEdit()
              change.replace(dependency.uri, new vscode.Range(dependency.positionAt(0), dependency.positionAt(dependency.getText().length)), source)
              assert(await vscode.workspace.applyEdit(change), `dependency edit ${file} rejected`)
              await dependency.save()
            }
          }
          const version = document.version + 1, marker = `__E1_version_${version}`
          console.log(`E1 ${name}: step=${step} version=${version} broken=${edit.broken}`)
          const source = sourceFor(input, edit, version)
          const change = new vscode.WorkspaceEdit()
          change.replace(document.uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), source)
          assert(await vscode.workspace.applyEdit(change), "document edit rejected")
          assert(document.version === version, `version barrier: expected ${version}, got ${document.version}`)
          await document.save()
          const cli = spawnSync(process.env.VIBELANG_TEST_COMPILER, ["--project", root, "--noEmit", "--pretty", "false", "--incremental", "false"],
            { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 2 << 20 })
          assert(!cli.error && cli.signal === null && [0, 1, 2].includes(cli.status), `CLI: ${cli.error ?? cli.signal ?? cli.status}`)
          const output = cli.stdout + cli.stderr
          trace = `E1 ${name} step=${step} version=${version}\nCLI:\n${output}`
          const expected = []
          let previous
          for (const line of output.split(/\r?\n/)) {
            const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+((?:TS|EK)\d+):\s?(.*)$/)
            if (match) {
              previous = path.resolve(root, match[1]) === document.uri.fsPath
                ? { line: +match[2] - 1, character: +match[3] - 1, severity: match[4] === "error" ? 0 : 1,
                  code: match[5], message: match[6] } : undefined
              if (previous) expected.push(previous)
            } else if (/^\s/.test(line) && previous) previous.message += "\n" + line
          }
          // Specification gap: Chapter 28 does not require CLI and LSP to run
          // the same semantic phases after syntax errors. Compare syntax codes
          // and positions here, then full sets after repair; do not prescribe
          // whether the editor additionally reports semantic errors.
          const syntaxOnly = edit.syntax === "incomplete" || !typescript && edit.syntax === "async"
          assert(syntaxOnly ? expected.length > 0 : expected.some(d => d.message.includes(marker)), `CLI omitted revision diagnostics: ${output}`)
          const sort = items => items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
          sort(expected)
          // getDiagnostics carries no version. Each document.version has a
          // unique unresolved name and disjoint source lines, so stale semantic
          // or syntax results cannot satisfy this publication barrier.
          let lastObserved = ""
          await waitFor(`${name} step=${step} version=${version}`, () => {
            const actual = sort(vscode.languages.getDiagnostics(document.uri).map(d => ({
              line: d.range.start.line, character: d.range.start.character, severity: d.severity,
              code: `${d.source === "EK" ? "EK" : "TS"}${codeOf(d)}`, message: d.message
            })))
            trace = `E1 ${name} step=${step} expectedVersion=${version} documentVersion=${document.version}\nCLI:\n${output}\nexpected=${JSON.stringify(expected)}\npublished=${JSON.stringify(actual)}`
            const observed = JSON.stringify(actual)
            const matches = document.version === version && (syntaxOnly
              ? expected.every(want => actual.some(found => JSON.stringify(found) === JSON.stringify(want)))
              : actual.some(d => d.message.includes(marker)) && observed === JSON.stringify(expected))
            if (!matches && observed !== lastObserved) {
              console.log(`E1 ${name}: waiting step=${step} version=${version} published=${JSON.stringify(actual.map(({ code, line, character }) => ({ code, line, character })))}`)
              lastObserved = observed
            }
            return matches
          }, Math.min(timeoutMs, 15000))
        }
      } catch (error) {
        failureTrace = trace
        throw error
      } finally {
        // Closed documents must not leak across generated samples or shrinking.
        await vscode.commands.executeCommand("workbench.action.closeAllEditors")
        fs.rmSync(root, { recursive: true, force: true })
      }
    }
  })
}

async function run() {
  if (process.env.VIBELANG_TEST_PASS === "untrusted") {
    // D79; docs/user/src/setup/vscode.md §3. Let VS Code gate activation;
    // calling activate() on a mock cannot test this security boundary.
    assert(!vscode.workspace.isTrusted, "VS Code did not enter Restricted Mode")
    const document = await open("main.vibe")
    await vscode.commands.executeCommand("vscode.executeHoverProvider", document.uri, document.positionAt(0))
    const extension = vscode.extensions.getExtension("vibelang.vibelang")
    assert(!extension?.isActive, "VibeLang activated in an untrusted workspace")
    assert(!(await vscode.commands.getCommands(true)).includes("vibelang.restartServer"), "server command registered in Restricted Mode")
    assert(!fs.existsSync(process.env.VIBELANG_TEST_SERVER_MARKER), "untrusted workspace executed its compiler")
    console.log("ok   trust: Restricted Mode prevents activation and compiler execution")
    return
  }
  let failures = 0
  const check = async (name, body) => {
    try {
      await body()
      console.log(`ok   ${name}`)
    } catch (error) {
      failures++
      console.log(`FAIL ${name}: ${error.message}`)
    }
  }

  await check("extension: vibelang.vibelang comes from the .vsix and activates", async () => {
    const extension = vscode.extensions.getExtension("vibelang.vibelang")
    assert(extension, "the extension is not installed")
    assert(extension.extensionPath.startsWith(extensionsDir), `loaded from ${extension.extensionPath}, not ${extensionsDir}`)
    await extension.activate()
  })

  if (process.env.VIBELANG_TEST_PASS === "typescript-off") {
    // test/run.mjs disabled the built-in TypeScript extension, so only
    // VibeLang's server can report this .ts file's diagnostics.
    await check("typescript: with VS Code's TypeScript off, VibeLang reports .ts diagnostics", async () => {
      assert(vscode.extensions.getExtension("vscode.typescript-language-features") === undefined, "the built-in TypeScript extension is enabled")
      fs.writeFileSync(path.join(workspace, "src", "typed.ts"), 'export const count: number = "three"\n')
      const typed = await open("src/typed.ts")
      await waitFor("TS2322 in typed.ts", () => vscode.languages.getDiagnostics(typed.uri).find((d) => codeOf(d) === 2322))
    })
    await check("property: TypeScript document edits agree with fresh CLI diagnostics", () => editProperties(true))
    if (failures > 0) throw new Error(`${failures} check(s) failed`)
    return
  }

  const main = await open("src/main.vibe")

  await check("language: a .vibe file opens as vibe", () => {
    assert(main.languageId === "vibe", `language ${main.languageId}`)
  })

  await check("grammar: the VibeLang grammar colors .vibe files", async () => {
    const tokens = await vscode.commands.executeCommand("_workbench.captureSyntaxTokens", main.uri)
    const keyword = tokens.find((token) => token.c.trim() === "function")
    assert(keyword, `no function token in ${tokens.length} tokens`)
    assert(keyword.t.startsWith("source.vibe") && keyword.t.includes("storage.type.function"), `scopes ${keyword.t}`)
  })

  await check("grammar: the catch of a catch expression is a keyword", async () => {
    const file = await open("src/catch-expression.vibe")
    const tokens = await vscode.commands.executeCommand("_workbench.captureSyntaxTokens", file.uri)
    const keywords = tokens.filter((token) => token.c.trim() === "catch")
    assert(keywords.length === 2, `catch tokens ${JSON.stringify(keywords)}`)
    for (const keyword of keywords) assert(keyword.t.includes("keyword.control.trycatch"), `scopes ${keyword.t}`)
  })

  await check("grammar: a module declaration's body is colored as TypeScript colors it", async () => {
    // Braces in the body's strings, templates, regular expression and
    // comments do not end it. VibeLang's own forms, such as the error
    // declaration that the compiler rejects there (D283), are TypeScript's.
    const body = [
      '  import { Effect } from "effect"',
      "",
      '  export const close = "}"',
      "  export const braces = /[{}]/g",
      '  export const label = (name: string) => `{${name}${"}"}}`',
      "  export const page = `",
      "    <main>{ } }</main>",
      "  `",
      "  // a } in a comment",
      "  /* a { and",
      "     a } in a comment */",
      "",
      "  export function clean(value: string): string {",
      "    const trimmed = value.trim()",
      '    if (trimmed === "") throw new Error("empty")',
      "    return trimmed",
      "  }",
      "",
      "  export const greet = (name: string) => Effect.succeed({ greeting: `hello, ${name}` })",
      "",
      "  error Bad { reason: string }"
    ]
    const vibe = await syntaxTokens("module.vibe", ["module text {", ...body, "}", "", "error NotFound { id: string }", ""].join("\n"))
    const ts = await syntaxTokens("namespace.ts", ["namespace text {", ...body, "}", ""].join("\n"))
    assert(vibe[0].c === "module" && ts[0].c === "namespace", `first tokens ${JSON.stringify([vibe[0], ts[0]])}`)
    const difference = firstDifference([{ ...vibe[0], c: "namespace" }, ...vibe.slice(1)], ts)
    assert(difference === "", difference)
    const after = vibe.slice(ts.length).find((token) => token.c === "error")
    assert(after?.t === "source.vibe meta.class.ts storage.type.class.ts", `the error after the module is ${JSON.stringify(after)}`)
  })

  await check("grammar: an identifier module specifier is a module name", async () => {
    const tokens = await syntaxTokens(
      "specifiers.vibe",
      [
        "module text {",
        "  export const clean = (value: string) => value.trim()",
        "}",
        "",
        "import { clean } from text",
        "import text",
        "export { clean as tidy } from text",
        "export * from text",
        ""
      ].join("\n")
    )
    const names = tokens.filter((token) => token.c === "text")
    assert(names.length === 5, `text tokens ${JSON.stringify(names)}`)
    for (const name of names) assert(name.t.endsWith(" entity.name.type.module.ts"), `scopes ${name.t}`)
    const exports = tokens.filter((token) => token.c === "export")
    assert(exports.length === 3, `export tokens ${JSON.stringify(exports)}`)
    for (const keyword of exports) assert(keyword.t.endsWith(" keyword.control.export.ts"), `scopes ${keyword.t}`)
  })

  await check("grammar: namespace and declare module keep TypeScript's scopes", async () => {
    const text = ["namespace tools {", "  export const version = 1", "}", "", 'declare module "effect-extra" {', "  export const extra: number", "}", ""].join("\n")
    const vibe = await syntaxTokens("namespaces.vibe", text)
    const ts = await syntaxTokens("namespaces.ts", text)
    const difference = firstDifference(vibe, ts)
    assert(difference === "" && vibe.length === ts.length, difference || `${vibe.length} tokens, TypeScript's ${ts.length}`)
  })

  await check("diagnostics: TypeScript's TS2322 appears on broken.vibe", async () => {
    const broken = await open("src/broken.vibe")
    const found = await waitFor("TS2322", () => vscode.languages.getDiagnostics(broken.uri).find((d) => codeOf(d) === 2322))
    assert(found.range.start.line === 1, `line ${found.range.start.line}`)
  })

  await check("diagnostics: EK1003 appears on wait.vibe with source EK", async () => {
    const wait = await open("src/wait.vibe")
    const found = await waitFor("EK1003", () => vscode.languages.getDiagnostics(wait.uri).find((d) => codeOf(d) === 1003))
    assert(found.source === "EK", `source ${found.source}`)
  })

  await check("hover: a .vibe function shows its inferred contract", async () => {
    const shown = await hoverText(main, "lookup(id")
    assert(shown.includes("function lookup(id: number): string!NotFound!"), `hover ${JSON.stringify(shown)}`)
  })

  await check("hover: a call that runs shows its success value", async () => {
    const shown = await hoverText(main, "lookup(1)")
    assert(shown.includes("Runs here and returns `string`"), `hover ${JSON.stringify(shown)}`)
  })

  await check("definition: a .ts function called from .vibe goes to users.ts", async () => {
    const locations = await vscode.commands.executeCommand("vscode.executeDefinitionProvider", main.uri, positionOf(main, "findName(id)"))
    const uris = locations.map((l) => (l.targetUri ?? l.uri).fsPath)
    assert(uris.some((uri) => uri.endsWith(path.join("src", "users.ts"))), `went to ${JSON.stringify(uris)}`)
  })

  await check("completion: prelude names and a service's members in services.vibe", async () => {
    const services = await open("src/services.vibe")
    const labels = async (needle, offset) => {
      const list = await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", services.uri, positionOf(services, needle, offset))
      return list.items.map((item) => (typeof item.label === "string" ? item.label : item.label.label))
    }
    const scope = await labels("Users.find", 0)
    for (const label of ["TaggedError", "wire", "Users", "double"]) assert(scope.includes(label), `no ${label} in completions`)
    assert((await labels("Users.find", 6)).includes("find"), "no find after Users.")
  })

  await check("hover: a plain function shows the signature VibeLang calls", async () => {
    const services = await open("src/services.vibe")
    const shown = await hoverText(services, "double(n")
    assert(shown.includes("function double(n: number): number"), `hover ${JSON.stringify(shown)}`)
  })

  await check("diagnostics: main.vibe has none", () => {
    const items = vscode.languages.getDiagnostics(main.uri)
    assert(items.length === 0, JSON.stringify(items.map((d) => d.message)))
  })

  await check("property: VibeLang document edits agree with fresh CLI diagnostics", () => editProperties(false))

  if (failures > 0) throw new Error(`${failures} check(s) failed`)
}

module.exports = { run }
