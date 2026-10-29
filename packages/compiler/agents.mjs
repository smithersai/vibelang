// `vibelang agents`: wires a repository's coding agents to VibeLang, each
// through its own extension points, and runs the post-edit check they call.
//
//   vibelang agents init [dir]    write the skill, instructions, LSP and hooks
//   vibelang agents check <file>  apply `vibelang --fix`, print what is left
//   vibelang agents hook          the same check as a PostToolUse hook
//
// docs/maintainers/coding-agents.md cites each agent's documentation.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageDirectory = dirname(fileURLToPath(import.meta.url))
const skillSource = join(packageDirectory, "skills/vibelang/SKILL.md")
const hookTag = "vibelang agents hook"
const sectionStart = "<!-- vibelang agents: start. `npx vibelang agents init` writes this section; rerun it to update. -->"
const sectionEnd = "<!-- vibelang agents: end -->"
const header = "Written by `npx vibelang agents init`; rerun it to update."

export async function main(args, findBinary) {
  const [command, ...rest] = args
  if (command === "init") return init(realpathSync(resolve(rest[0] ?? ".")))
  if (command === "check") return check(rest, findBinary)
  if (command === "hook") return hook(findBinary)
  console.error(command === undefined || command === "--help" ? usage : `vibelang agents: unknown command ${command}.\n${usage}`)
  return command === "--help" ? 0 : 2
}

const usage = `Usage:
  vibelang agents init [dir]    Set up Claude Code, Codex, opencode, Cursor and VS Code for .vibe files
  vibelang agents check <file>  Apply vibelang --fix to each file's project, then print its diagnostics
  vibelang agents hook          Run check for the files a PostToolUse hook event names (stdin JSON)`

// ---- init

// init writes every agent's configuration under root and prints what it
// wrote. Each file it merges keeps the keys it doesn't own.
export function init(root) {
  if (!existsSync(join(root, "package.json"))) {
    console.error(`vibelang agents init: ${root} has no package.json; run it at the repository root.`)
    return 1
  }
  const run = invocation(root)
  if (run === "npx --no -- vibelang" && !existsSync(join(root, "node_modules/.bin/vibelang"))) {
    console.log("vibelang agents init: vibelang is not installed here yet; the commands below run once it is.")
  }
  const written = []
  const write = (path, text) => {
    const file = join(root, path)
    if (existsSync(file) && readFileSync(file, "utf8") === text) return
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
    written.push(path)
  }
  const skipped = []

  // Skills: Codex, opencode, Cursor and VS Code read .agents/skills; Claude Code reads .claude/skills.
  const skill = readFileSync(skillSource, "utf8")
  write(".agents/skills/vibelang/SKILL.md", skill)
  write(".claude/skills/vibelang/SKILL.md", skill)

  // Instructions: every agent reads AGENTS.md; Claude Code reads CLAUDE.md instead when one exists.
  write("AGENTS.md", withSection(read(join(root, "AGENTS.md")), section(run)))
  for (const path of ["CLAUDE.md", ".claude/CLAUDE.md"]) {
    if (existsSync(join(root, path))) write(path, withSection(read(join(root, path)), section(run)))
  }

  // Claude Code (and Cursor and VS Code, which load its hooks): a PostToolUse hook after each edit.
  const hookCommand = `${run} agents hook`
  write(".claude/settings.json", json(withHook(readJson(root, ".claude/settings.json"), "Edit|Write|MultiEdit", hookCommand)))
  // Claude Code's language servers come from plugins; a plugin under .claude/skills is the repository's.
  write(".claude/skills/vibelang-lsp/.claude-plugin/plugin.json", json(claudePlugin(run)))

  // Codex: the same hook after apply_patch, from the project's .codex layer.
  write(".codex/hooks.json", json(withHook(readJson(root, ".codex/hooks.json"), "apply_patch", hookCommand)))

  // opencode: the language server, whose diagnostics its edit tools report, and a plugin that runs check.
  if (existsSync(join(root, "opencode.jsonc")) && !existsSync(join(root, "opencode.json"))) {
    skipped.push(`opencode.jsonc: add "lsp": ${JSON.stringify(opencodeLsp(run))} by hand`)
  } else {
    const config = readJson(root, "opencode.json")
    if (config.lsp !== false) {
      config.$schema ??= "https://opencode.ai/config.json"
      config.lsp = { ...(typeof config.lsp === "object" ? config.lsp : {}), ...opencodeLsp(run) }
      write("opencode.json", json(config))
    } else skipped.push(`opencode.json turns LSP off ("lsp": false); left it`)
  }
  write(".opencode/plugins/vibelang.js", opencodePlugin(run))

  for (const path of written) console.log(`vibelang agents init: wrote ${path}`)
  for (const note of skipped) console.log(`vibelang agents init: skipped ${note}`)
  if (written.length === 0) console.log("vibelang agents init: every agent is already set up.")
  console.log("Claude Code loads the language server plugin, and Codex runs the hook, once you trust this folder (in Codex, review the hook in /hooks).")
  console.log("VS Code and Cursor: install the VibeLang extension, code --install-extension node_modules/vibelang/editor/vibelang.vsix.")
  return 0
}

// invocation is the command that runs vibelang from root: npx finds it in
// root's node_modules, or through --prefix in the nearest package above the
// current directory that has it, as in a workspace that doesn't hoist it.
// `--` keeps npx from reading vibelang's flags as its own.
export function invocation(root, cwd = process.cwd()) {
  const has = (directory) => existsSync(join(directory, "node_modules/.bin/vibelang"))
  if (!has(root)) {
    for (let directory = resolve(cwd); directory.startsWith(`${root}/`); directory = dirname(directory)) {
      if (has(directory)) return `npx --no --prefix ${relative(root, directory)} -- vibelang`
    }
  }
  return "npx --no -- vibelang"
}

// prose is invocation as a person types it.
function prose(run) {
  return run.replace(/ --no\b/, "").replace(/ -- /, " ")
}

function section(command) {
  const run = prose(command)
  return `${sectionStart}
## VibeLang

\`.vibe\` files are VibeLang: Effect programs in TypeScript syntax. Load the \`vibelang\` skill (\`.agents/skills/vibelang/SKILL.md\`) before you write or review one.

- After you edit \`.vibe\` files, run \`${run} agents check <file>...\`. It applies \`vibelang --fix\` and prints each diagnostic left; fix every error before you finish. Claude Code, Codex and opencode run it for you after each edit and show you the result.
- \`${run} --noEmit\` checks the whole project. Each \`EKxxxx\` diagnostic says how to fix it.
${sectionEnd}`
}

// withSection replaces the section between the markers, or appends it.
export function withSection(text, block) {
  const start = text.indexOf(sectionStart.slice(0, 27))
  const end = text.indexOf(sectionEnd)
  if (start >= 0 && end > start) return text.slice(0, start) + block + text.slice(end + sectionEnd.length)
  if (text.trim() === "") return `${block}\n`
  return `${text.replace(/\n*$/, "")}\n\n${block}\n`
}

// withHook puts one PostToolUse matcher group running command in a Claude
// Code or Codex hooks document, replacing the group an earlier init wrote.
export function withHook(config, matcher, command) {
  const hooks = { ...config.hooks }
  const groups = (hooks.PostToolUse ?? []).filter((group) => !group.hooks?.some((h) => String(h.command).includes(hookTag)))
  hooks.PostToolUse = [...groups, { matcher, hooks: [{ type: "command", command, timeout: 300, statusMessage: "Checking .vibe files" }] }]
  return { ...config, hooks }
}

function claudePlugin(run) {
  const [command, ...args] = run.split(" ")
  return {
    name: "vibelang-lsp",
    description: `VibeLang language server for .vibe files: diagnostics and hover. ${header}`,
    lspServers: {
      vibelang: { command, args: [...args, "--lsp", "--stdio"], extensionToLanguage: { ".vibe": "vibe" } }
    }
  }
}

function opencodeLsp(run) {
  return { vibelang: { command: [...run.split(" "), "--lsp", "--stdio"], extensions: [".vibe"] } }
}

function opencodePlugin(run) {
  return `// ${header}
// After opencode edits a .vibe file, applies \`vibelang --fix\` to its project and
// appends the diagnostics left to the tool's result, which the agent reads.
import { execFile } from "node:child_process"

const command = ${JSON.stringify([...run.split(" "), "agents", "check"])}
const patchFiles = (patch) =>
  [...patch.matchAll(/^\\*\\*\\* (?:Add File|Update File|Move to): (.+)$/gm)].map((match) => match[1].trim())

export const VibeLang = async ({ directory }) => ({
  "tool.execute.after": async (input, output) => {
    if (!["edit", "write", "multiedit", "apply_patch", "patch"].includes(input.tool)) return
    const args = input.args ?? {}
    const files = [args.filePath, ...(typeof args.patchText === "string" ? patchFiles(args.patchText) : [])]
      .filter((file) => typeof file === "string" && file.endsWith(".vibe"))
    if (files.length === 0) return
    const report = await new Promise((done) =>
      execFile(command[0], [...command.slice(1), ...files], { cwd: directory, maxBuffer: 1 << 24 }, (_, stdout, stderr) =>
        done(\`\${stdout ?? ""}\${stderr ?? ""}\`.trim())))
    if (report) output.output = \`\${output.output}\\n\\n\${report}\`
  },
})
`
}

// ---- check

// check applies --fix to each file's project and prints the result; it exits
// 1 when an error is left in one of the files.
function check(files, findBinary) {
  if (files.length === 0) {
    console.error("vibelang agents check: name the .vibe files to check.")
    return 2
  }
  const result = checkFiles(files.map((file) => resolve(file)).filter((file) => existsSync(file)), findBinary(), process.cwd())
  const text = report(result, process.cwd(), true)
  if (text) console.log(text)
  return result.errors.length > 0 ? 1 : 0
}

// hook reads a PostToolUse event from Claude Code, Codex, Cursor or VS Code
// on stdin. An error left in an edited file goes to stderr with exit status
// 2, which each of them returns to the model; anything else to say goes back
// as additionalContext.
function hook(findBinary) {
  let event
  try {
    event = JSON.parse(readFileSync(0, "utf8"))
  } catch {
    return 0
  }
  const cwd = typeof event.cwd === "string" ? event.cwd : process.cwd()
  const files = editedFiles(event, cwd).filter((file) => file.endsWith(".vibe") && existsSync(file))
  if (files.length === 0) return 0
  const result = checkFiles(files, findBinary(), cwd)
  if (result.errors.length > 0) {
    process.stderr.write(`${report(result, cwd, false)}\n`)
    return 2
  }
  const text = report(result, cwd, false)
  if (text) {
    const hookEventName = typeof event.hook_event_name === "string" ? event.hook_event_name : "PostToolUse"
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text } })}\n`)
  }
  return 0
}

// editedFiles returns the absolute paths a tool event names: Claude Code's
// tool_input.file_path, Cursor's file_path, a path argument, or the files of
// an apply_patch patch (Codex's tool_input.command).
export function editedFiles(event, cwd) {
  const input = event.tool_input ?? event.toolArgs ?? {}
  const paths = [event.file_path, input.file_path, input.filePath, input.path]
  for (const value of [input.command, input.patch, input.input, typeof input === "string" ? input : undefined]) {
    const text = Array.isArray(value) ? value.join("\n") : value
    if (typeof text !== "string") continue
    for (const match of text.matchAll(/^\*\*\* (?:Add File|Update File|Move to): (.+)$/gm)) paths.push(match[1].trim())
  }
  return [...new Set(paths.filter((path) => typeof path === "string" && path !== "").map((path) => resolve(cwd, path)))]
}

// checkFiles runs `vibelang -p <project> --fix --noEmit` once for each
// project the files belong to and sorts what it prints.
export function checkFiles(files, binary, cwd) {
  const result = { fixes: [], errors: [], warnings: [], otherErrors: 0, missing: [] }
  const projects = new Map()
  for (const file of files.map((file) => realpathSync(file))) {
    const project = projectOf(file, binary)
    if (!project) {
      result.missing.push(file)
      continue
    }
    projects.set(project, [...(projects.get(project) ?? []), file])
  }
  for (const [project, members] of projects) {
    const directory = realpathSync(dirname(project))
    const run = spawnSync(binary, ["-p", project, "--fix", "--noEmit", "--pretty", "false"], {
      cwd: directory, encoding: "utf8", maxBuffer: 1 << 26
    })
    const output = `${run.stdout ?? ""}${run.stderr ?? ""}`
    for (const fix of output.matchAll(/^vibelang --fix: (.+?): (\d+ fix(?:es)? \(.*\))$/gm)) {
      result.fixes.push({ file: resolve(directory, fix[1]), summary: fix[2] })
    }
    for (const diagnostic of parseDiagnostics(output, directory)) {
      if (!members.includes(diagnostic.file)) {
        if (diagnostic.severity === "error") result.otherErrors++
      } else if (diagnostic.severity === "error") result.errors.push(diagnostic)
      else result.warnings.push(diagnostic)
    }
  }
  return result
}

// parseDiagnostics reads `file(line,col): error CODE: message` lines and the
// indented lines that continue them.
export function parseDiagnostics(output, directory) {
  const diagnostics = []
  for (const line of output.split("\n")) {
    const match = /^(.+?)\((\d+),(\d+)\): (error|warning|message) ([A-Z]+\d+): (.*)$/.exec(line)
    if (match) {
      diagnostics.push({ file: resolve(directory, match[1]), line: Number(match[2]), column: Number(match[3]), severity: match[4], code: match[5], message: match[6] })
    } else if (line.startsWith("  ") && diagnostics.length > 0) {
      diagnostics.at(-1).message += `\n${line}`
    }
  }
  return diagnostics
}

// projectOf returns the tsconfig that compiles file: the nearest directory
// above it with a tsconfig*.json, choosing tsconfig.json first when it
// includes the file, then the others whose file list has it.
function projectOf(file, binary) {
  for (let directory = dirname(file); ; directory = dirname(directory)) {
    const configs = readdirSync(directory).filter((name) => /^tsconfig(\..+)?\.json$/.test(name))
      .sort((a, b) => (a === "tsconfig.json" ? -1 : b === "tsconfig.json" ? 1 : a.localeCompare(b)))
    if (configs.length === 1) return join(directory, configs[0])
    for (const config of configs) {
      const listed = spawnSync(binary, ["-p", join(directory, config), "--listFilesOnly"], { encoding: "utf8", maxBuffer: 1 << 26 })
      if ((listed.stdout ?? "").split("\n").some((line) => line.trim() === file)) return join(directory, config)
    }
    if (configs.length > 0) return join(directory, configs[0])
    if (dirname(directory) === directory || existsSync(join(directory, ".git")) || existsSync(join(directory, ".jj"))) return undefined
  }
}

function report(result, cwd, clean) {
  const name = (file) => relative(cwd, file) || file
  const lines = []
  for (const fix of result.fixes) lines.push(`vibelang --fix rewrote ${name(fix.file)}: ${fix.summary}. Read it again before you edit it.`)
  for (const d of [...result.errors, ...result.warnings]) {
    lines.push(`${name(d.file)}(${d.line},${d.column}): ${d.severity} ${d.code}: ${d.message}`)
  }
  for (const file of result.missing) lines.push(`vibelang: no tsconfig.json above ${name(file)}; it was not checked.`)
  if (result.errors.length > 0) {
    lines.push(`vibelang: ${result.errors.length} error${result.errors.length === 1 ? "" : "s"} left in the files you edited. Fix ${result.errors.length === 1 ? "it" : "them"} before you finish.`)
  }
  if (result.otherErrors > 0) {
    lines.push(`vibelang: ${result.otherErrors} error${result.otherErrors === 1 ? "" : "s"} in other files of the project; \`npx vibelang --noEmit\` lists them.`)
  }
  if (lines.length === 0 && clean) lines.push("vibelang: no errors.")
  return lines.join("\n")
}

// ---- files

function read(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : ""
}

function readJson(root, path) {
  const text = read(join(root, path))
  if (text.trim() === "") return {}
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`vibelang agents init: ${path} is not JSON (${error.message}); fix it, then rerun.`)
  }
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}
