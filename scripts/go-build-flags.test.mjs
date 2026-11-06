// Every Go build and test VibeLang's scripts run compiles with the flags the
// build graph uses (`-trimpath`, no `-gcflags`), so they share one set of
// entries in the Go cache.
//
// Go keys a package's compile on its flags. `-gcflags=all=-dwarf=false` gave
// smoke.sh, lsp-smoke.sh and the plugin and mapper tests a second copy of all
// 113 compiler packages: on 2026-11-01, 82 of them were stale for that flag set
// while 1 was stale for `-trimpath`, so a lane that ran scripts/build-vibelang.sh
// and then lsp-smoke.sh compiled the compiler twice. Without `-trimpath` the key
// also holds the checkout's absolute path, so no two workspaces share it.
//
// typescript/Herebyfile.mjs and typescript/tsc/ are upstream TypeScript's and
// keep their own flags.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const scripts = [
  "scripts/build-vibelang.sh",
  "typescript/PACKAGE.ts",
  "PACKAGE.ts",
  "typescript/vibelang/smoke.sh",
  "typescript/vibelang/lsp-smoke.sh",
  "packages/vite/test/run.sh",
  "packages/unplugin/test/run.sh",
  "packages/compiler/test/eslint/run.sh",
  "packages/ts-mapper/test/e2e.sh",
  "packages/ts-mapper/test/parity/run.sh",
  "packages/ts-mapper/test/parity/parity.ts",
  "typescript/VIBELANG.md",
]
const read = (file) => readFileSync(root + file, "utf8")

test("no build or test script passes -gcflags", () => {
  const found = scripts.flatMap((file) =>
    read(file).split("\n").flatMap((line, i) => (/-gcflags[= ]/.test(line) ? [`${file}:${i + 1}`] : [])))
  assert.deepEqual(found, [])
})

// Decode declaration strings before reading their shell quotes. In particular,
// escaped selector quotes must not turn a selector's && into a command boundary.
function shellSource(text, file) {
  if (!file.endsWith(".ts")) return text
  return [...text.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60(?:\\.|[^\x60\\])*\x60/g)]
    .map(([literal]) => literal.slice(1, -1).replace(/\\(["'\x60\\])/g, "$1").replace(/\\n/g, "\n"))
    .join("")
}

// A parameter expansion is part of its surrounding shell word. Its fallback
// can contain spaces, separators, quotes and nested expansions without ending
// an assignment or introducing another command.
function parameterEnd(source, start) {
  let depth = 1, quote = ""
  for (let i = start + 2; i < source.length; i++) {
    const char = source[i]
    if (char === "\\" && quote !== "'") { i++; continue }
    if (quote) {
      if (char === quote) quote = ""
      continue
    }
    if (char === "'" || char === '"') { quote = char; continue }
    if (char === "$" && source[i + 1] === "{") { depth++; i++; continue }
    if (char === "}" && --depth === 0) return i + 1
  }
  return source.length
}

function shellCommands(source) {
  const commands = []
  let words = [], word = "", quote = ""
  const finishWord = () => {
    if (word) words.push(word)
    word = ""
  }
  const finishCommand = () => {
    finishWord()
    if (words.length) commands.push(words)
    words = []
  }
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (char === "\\" && quote !== "'") {
      word += source[++i] ?? ""
    } else if (char === "$" && source[i + 1] === "{" && quote !== "'") {
      const end = parameterEnd(source, i)
      word += source.slice(i, end)
      i = end - 1
    } else if (quote) {
      if (char === quote) quote = ""
      else word += char
    } else if (char === "'" || char === '"') {
      quote = char
    } else if (";&|\n()".includes(char)) {
      finishCommand()
      if (char === "(" || char === ")") commands.push([char])
    } else if (/\s/.test(char)) {
      finishWord()
    } else if (char === "#" && !word) {
      break
    } else {
      word += char
    }
  }
  finishCommand()
  return commands
}

function trimpathSetting(word) {
  const flag = word.match(/^--?trimpath(?:=(.*))?$/)
  if (!flag) return undefined
  return flag[1] === undefined || /^(?:1|t|T|true|TRUE|True)$/.test(flag[1])
}

// GOFLAGS supplies defaults in order. Its quotes surround whole arguments;
// quoted linker payloads cannot change a compilation flag. The inherited
// GOFLAGS expansion supplies no proof; its appended literal setting does.
function hasTrimpath(value) {
  let enabled = false
  const literal = value.replace(/\$\{GOFLAGS:\+\$GOFLAGS \}/g, "")
  for (const [word] of literal.matchAll(/'[^']*'|"[^"]*"|[^\t\n\r ]+/g)) {
    const field = /^['"]/.test(word) ? word.slice(1, -1) : word
    enabled = trimpathSetting(field) ?? enabled
  }
  return enabled
}
const valueFlags = new Set(["-run", "-bench", "-fuzz", "-gcflags", "-ldflags", "-tags",
  "-o", "-p", "-timeout", "-count", "-cpu", "-coverpkg", "-mod", "-modfile", "-overlay"])

function explicitTrimpath(words) {
  let enabled
  for (let i = 0; i < words.length; i++) {
    if (words[i] === "--" || words[i] === "-args" || words[i] === "--args") break
    enabled = trimpathSetting(words[i]) ?? enabled
    if (valueFlags.has(words[i].replace(/^--/, "-"))) i++
  }
  return enabled
}

test("every go build or go test line compiles with -trimpath", () => {
  const missing = scripts.flatMap((file) => {
    const text = read(file)
    // Literal environment fragments in template commands retain their scope.
    const environments = new Map([...text.matchAll(/const\s+(\w+)\s*=\s*["']([A-Z_]\w*=[^"'\\]*)["']/g)]
      .map(([, name, assignment]) => [name, assignment]))
    let fenced = false
    let exportedGoflags = { exported: false, trimpath: false }
    let scopes = []
    let prefix = ""
    return text.split("\n").flatMap((line, i) => {
      if (line.startsWith("```")) fenced = !fenced
      if (file.endsWith(".md") && !fenced) return []
      if (/^\s*(#|\/\/)/.test(line)) return []
      const commandLine = prefix + line
      prefix = /"\s*\+\s*$|\\$/.test(line) ? commandLine.replace(/\\$/, "") : ""
      if (prefix) return []
      let environment = file.endsWith(".sh") ? { ...exportedGoflags } : { exported: false, trimpath: false }
      const failed = []
      let invocation = 0
      if (!file.endsWith(".sh")) scopes = []
      const source = shellSource(commandLine, file).replace(/\$\{(\w+)\}/g,
        (fragment, name) => environments.get(name) ?? fragment)
      for (const words of shellCommands(source)) {
        if (words[0] === "(") {
          scopes.push({ ...environment })
          continue
        }
        if (words[0] === ")") {
          environment = scopes.pop() ?? environment
          continue
        }
        if (words[0] === "export") {
          const setting = words.find(word => word.startsWith("GOFLAGS="))
          if (setting) {
            environment.trimpath = hasTrimpath(setting.slice("GOFLAGS=".length))
            environment.exported = true
          } else if (words.includes("GOFLAGS")) environment.exported = true
          continue
        }
        if (words[0] === "unset" && words.includes("GOFLAGS")) {
          environment = { exported: false, trimpath: false }
          continue
        }
        let program = words[0] === "env" || words[0] === "command" ? 1 : 0
        let inline = environment.exported && environment.trimpath
        let setting = null
        if (words[0] === "env" && words[program] === "-u" && words[program + 1] === "GOFLAGS") {
          inline = false
          program += 2
        }
        while (/^\w+=/.test(words[program] ?? "")) {
          if (words[program].startsWith("GOFLAGS=")) {
            setting = hasTrimpath(words[program].slice("GOFLAGS=".length))
            inline = setting
          }
          program++
        }
        if (program === words.length) {
          if (setting !== null) environment.trimpath = setting
          continue
        }
        // The progress observer forwards the remaining argv and environment
        // unchanged. Audit its Go child with the same command-local settings.
        if (words[program] === "node" &&
            /^(?:\.\/)?(?:\.\.\/)*scripts\/go-test-progress\.mjs$/.test(words[program + 1] ?? "")) program += 2
        const go = words[program] === "go" && /^(build|test)$/.test(words[program + 1] ?? "")
        const nativeProgram = program + (words[program] === "sh" ? 1 : 0)
        const native = /(?:^|\/)native-output\.sh$/.test(words[nativeProgram] ?? "") &&
          words[nativeProgram + 1] === "build"
        const flags = words.slice(native ? nativeProgram + 3 : program + 2)
        if (go || native) {
          invocation++
          // CLI options override GOFLAGS defaults, even when they disable a
          // setting. An omitted CLI flag retains the effective environment.
          if (!(explicitTrimpath(flags) ?? inline)) {
            const name = go ? "go " + words[program + 1] : "native-output.sh build"
            failed.push(file + ":" + (i + 1) + ": " + name + " invocation " + invocation +
              " requires -trimpath or exported GOFLAGS")
          }
        }
      }
      if (file.endsWith(".sh")) exportedGoflags = environment
      return failed
    })
  })
  assert.deepEqual(missing, [])
})

// Run the real source audit in an isolated tree. The other files contain no
// commands: a native declaration mutation must be diagnosed on its own.
function auditNativeSource(t, source, target = "typescript/PACKAGE.ts") {
  const dir = mkdtempSync(join(tmpdir(), "go-build-flags-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const file of scripts) {
    const path = join(dir, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, file === target ? source : "")
  }
  const audit = join(dir, "scripts/go-build-flags.test.mjs")
  writeFileSync(audit, readFileSync(new URL(import.meta.url)))
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const result = spawnSync(process.execPath, [
    "--test", "--test-name-pattern=^every go build or go test line", audit
  ], { encoding: "utf8", timeout: 15_000, env })
  assert.ifError(result.error)
  assert.match(result.stdout, /every go build or go test line compiles with -trimpath/)
  return result
}

const nativeSource = read("typescript/PACKAGE.ts")
test("trimpath audit accepts the current native command declarations", t => {
  const result = auditNativeSource(t, nativeSource)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
for (const [name, entry] of [
  ["compiler", "GOFLAGS=" + "$" + "{GOFLAGS:+$GOFLAGS }-trimpath "],
  ["forms generator", "build ../built/local/vibelang-forms -p 8 -trimpath"],
  ["mapper", "go build -p 8 -trimpath -o ../built/local/vibelang-mapper"],
]) test("trimpath audit rejects a missing flag in the " + name, t => {
  assert.equal(nativeSource.split(entry).length, 2, "the real native command must be unique")
  const changed = nativeSource.replace(entry, entry.replace("-trimpath", ""))
  const result = auditNativeSource(t, changed)
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /typescript\/PACKAGE\.ts:/)
})

// A neighbouring target's assignment is scoped to its own shell command,
// wherever that target is declared and whatever its name is.
test("trimpath audit rejects generated native neighbours with independent environments", t => {
  let samples = 0
  const accepted = []
  for (const position of ["before", "after"]) {
    for (const verb of ["build", "test"]) {
      for (const flag of ["", "-p 8", "-race"]) {
        const neighbour = 'const independent' + samples + ' = { shell: "go ' + verb +
          ' ' + flag + ' ./fixture" }\n'
        const source = position === "before" ? neighbour + nativeSource : nativeSource + neighbour
        const result = auditNativeSource(t, source)
        if (result.status !== 1) accepted.push({ position, verb, flag, status: result.status })
        else assert.match(result.stdout, /typescript\/PACKAGE\.ts:/)
        samples++
      }
    }
  }
  assert.equal(samples, 12)
  assert.deepEqual(accepted, [])
})

test("trimpath audit retains generated parameter expansion boundaries", t => {
  const failures = []
  let samples = 0
  for (const prefix of [
    'EXTRA=${EXTRA:-value with spaces}',
    'EXTRA=${EXTRA:-"quoted } words"}',
    'EXTRA=${EXTRA:-${FALLBACK:-nested words}}',
    'EXTRA=${EXTRA:-escaped\\} words}',
  ]) {
    for (const command of ["go build", "go test", "sh scripts/native-output.sh build out"]) {
      for (const flag of ["", " -trimpath"]) {
        const shell = prefix + " " + command + flag + " ./fixture"
        const source = "const target = { shell: " + JSON.stringify(shell) + " }\n"
        const result = auditNativeSource(t, source)
        if (result.status !== (flag ? 0 : 1)) failures.push({ prefix, command, flag, status: result.status })
        samples++
      }
    }
  }
  assert.equal(samples, 24)
  assert.deepEqual(failures, [])
})

for (const [name, shell] of [
  ["semicolon", "echo ${EXTRA:-first; go build ./data} && go test -trimpath ./fixture"],
  ["pipeline", "echo ${EXTRA:-first | go build ./data} && go test -trimpath ./fixture"],
]) test("trimpath audit keeps " + name + " inside parameter fallback data", t => {
  const source = "const target = { shell: " + JSON.stringify(shell) + " }\n"
  const result = auditNativeSource(t, source)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

for (const [name, source, status] of [
  ["preceding export", 'export GOFLAGS="$' + '{GOFLAGS:+$GOFLAGS }-trimpath"\ngo build ./fixture\n', 0],
  ["inline assignment", "GOFLAGS=-trimpath go build ./fixture\n", 0],
  ["unrelated assignment", "GOFLAGS=-trimpath go version\ngo build ./fixture\n", 1],
  ["later export", 'go build ./fixture\nexport GOFLAGS="$' + '{GOFLAGS:+$GOFLAGS }-trimpath"\n', 1],
  ["unset export", 'export GOFLAGS="$' + '{GOFLAGS:+$GOFLAGS }-trimpath"\nunset GOFLAGS\ngo build ./fixture\n', 1],
]) test("trimpath audit respects shell environment scope: " + name, t => {
  const result = auditNativeSource(t, source, "scripts/build-vibelang.sh")
  assert.equal(result.status, status, result.stdout + result.stderr)
})

for (const [name, source, status] of [
  ["unexported setting is local", "GOFLAGS=-trimpath; go test ./one", 1],
  ["export existing setting", "GOFLAGS=-trimpath; export GOFLAGS; go test ./one", 0],
  ["exported setting can change", "export GOFLAGS=-mod=readonly; GOFLAGS=-trimpath; go test ./one", 0],
  ["exported setting can drop flags", "export GOFLAGS=-trimpath; GOFLAGS=-mod=readonly; go test ./one", 1],
  ["unset removes export status", "export GOFLAGS=-trimpath; unset GOFLAGS; GOFLAGS=-trimpath; go test ./one", 1],
  ["inline override stays local", "export GOFLAGS=-trimpath; GOFLAGS= go test -trimpath ./one; go test ./two", 0],
  ["subshell exports expire", "(export GOFLAGS=-trimpath; go test ./one); go test ./two", 1],
  ["subshell inherits outer export", "export GOFLAGS=-trimpath; (go test ./one); go test ./two", 0],
  ["subshell reset stays local", "export GOFLAGS=-trimpath; (unset GOFLAGS; go test -trimpath ./one); go test ./two", 0],
  ["environment wrapper", "env GOFLAGS=-trimpath go test ./one && env go test ./two", 1],
  ["environment wrapper with flags", "env GOFLAGS=-trimpath go test ./one", 0],
  ["environment wrapper reset", "export GOFLAGS=-trimpath; env -u GOFLAGS go test ./one", 1],
  ["command wrapper", "command go test ./one && go test -trimpath ./two", 1],
  ["direct native wrapper", "scripts/native-output.sh build out ./one && go test -trimpath ./two", 1],
  ["later missing flag", "go test -trimpath ./one && go test ./two", 1],
  ["earlier missing flag", "go build ./one && go build -trimpath ./two", 1],
  ["all commands flagged", "go test -trimpath ./one && go build -trimpath ./two", 0],
  ["inline flags expire", "GOFLAGS=-trimpath go test ./one && go test ./two", 1],
  ["inline flags follow a missing flag", "go test ./one && GOFLAGS=-trimpath go test ./two", 1],
  ["inline flags on both commands", "GOFLAGS=-trimpath go test ./one && GOFLAGS=-trimpath go test ./two", 0],
  ["explicit flags override an export", "export GOFLAGS=-trimpath; GOFLAGS= go test ./one", 1],
  ["same-line export", "export GOFLAGS=-trimpath; go test ./one && go build ./two", 0],
  ["same-line reset", "export GOFLAGS=-trimpath; unset GOFLAGS; go test ./one", 1],
  ["quoted selector is not a flag", "go test -run '-trimpath' ./one", 1],
  ["flag assignment disabled", "go test -trimpath=false ./one", 1],
  ["export cannot override explicit false", "export GOFLAGS=-trimpath; go test -trimpath=false ./one", 1],
  ["inline environment cannot override explicit false", "GOFLAGS=-trimpath go test -trimpath=false ./one", 1],
  ["last explicit false wins", "go test -trimpath -trimpath=false ./one", 1],
  ["last explicit true wins", "go test -trimpath=false -trimpath ./one", 0],
  ["last explicit true assignment wins", "go test -trimpath=false -trimpath=true ./one", 0],
  ["zero disables an environment default", "GOFLAGS=-trimpath go test -trimpath=0 ./one", 1],
  ["capital false disables an environment default", "GOFLAGS=-trimpath go test -trimpath=FALSE ./one", 1],
  ["single letter false disables an environment default", "GOFLAGS=-trimpath go test -trimpath=F ./one", 1],
  ["capital true enables trimpath", "go test -trimpath=TRUE ./one", 0],
  ["single letter true enables trimpath", "go test -trimpath=T ./one", 0],
  ["one enables trimpath", "go test -trimpath=1 ./one", 0],
  ["double dash disables an environment default", "GOFLAGS=-trimpath go test --trimpath=false ./one", 1],
  ["double dash enables trimpath", "go test --trimpath ./one", 0],
  ["last environment false wins", "GOFLAGS='-trimpath -trimpath=false' go test ./one", 1],
  ["last environment true wins", "GOFLAGS='-trimpath=false -trimpath' go test ./one", 0],
  ["explicit true overrides environment false", "GOFLAGS=-trimpath=false go test -trimpath ./one", 0],
  ["selector false is data", "go test -trimpath -run '-trimpath=false' ./one", 0],
  ["double dash selector false is data", "go test -trimpath --run '-trimpath=false' ./one", 0],
  ["test binary arguments are data", "go test -trimpath ./one -args -trimpath=false", 0],
  ["double dash test binary arguments are data", "go test -trimpath ./one --args -trimpath=false", 0],
  ["end of options retains flags", "go test -trimpath ./one -- -trimpath=false", 0],
  ["linker false is data", "go test -trimpath -ldflags '-X=fixture.trimpath=false' ./one", 0],
  ["quoted separators remain selector data", "go test -trimpath -run 'one&&two;three|four' ./one", 0],
  ["quoted selector retains later omission", "go test -trimpath -run 'one&&two' ./one && go test ./two", 1],
  ["quoted flags stay in their argument", "go test -run 'name -trimpath' ./one", 1],
  ["unrelated output is not a flag", "echo -trimpath && go test ./one", 1],
  ["native wrapper has its own flags", "go test -trimpath ./one && sh scripts/native-output.sh build out ./two", 1],
  ["native wrapper flags do not leak", "sh scripts/native-output.sh build out -trimpath ./one && go test ./two", 1],
]) test("trimpath audit checks command boundaries: " + name, t => {
  const result = auditNativeSource(t, source + "\n", "scripts/build-vibelang.sh")
  assert.equal(result.status, status, result.stdout + result.stderr)
})

test("trimpath audit checks generated mixed command chains in declarations", t => {
  const accepted = []
  let samples = 0
  for (const separator of [" && ", " || ", "; ", " | "]) {
    for (const verb of ["build", "test"]) {
      for (const position of ["before", "after"]) {
        const flagged = "GOFLAGS=-trimpath go " + verb + " ./flagged"
        const missing = "go " + verb + " ./missing"
        const shell = position === "before" ? missing + separator + flagged : flagged + separator + missing
        const source = "const target = { shell: " + JSON.stringify(shell) + " }\n"
        const result = auditNativeSource(t, source)
        if (result.status !== 1) accepted.push({ separator, verb, position, status: result.status })
        else assert.match(result.stdout, /typescript\/PACKAGE\.ts:/)
        samples++
      }
    }
  }
  assert.equal(samples, 16)
  assert.deepEqual(accepted, [])
})

test("trimpath audit preserves quoted selectors in concatenated declarations", t => {
  const source = 'const target = { shell: "go test -trimpath -run \\"left&&right\\" ./one && " +\n' +
    '  "go test ./two" }\n'
  const result = auditNativeSource(t, source)
  assert.equal(result.status, 1, result.stdout + result.stderr)
})

test("trimpath audit rejects a missing flag in the later mapper helper check", t => {
  const source = read("PACKAGE.ts")
  const witness = source.indexOf("TestMapperPreludeRuntimeHelpersQuoted")
  assert.ok(witness > 0, "the later helper check must remain present")
  const start = source.lastIndexOf("go test ", witness)
  const entry = source.slice(start, witness)
  assert.match(entry, /go test -trimpath/)
  const changed = source.slice(0, start) + entry.replace("-trimpath", "") + source.slice(witness)
  const result = auditNativeSource(t, changed, "PACKAGE.ts")
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /PACKAGE\.ts:/)
  assert.match(result.stdout, /go test invocation 2 requires -trimpath/)
})

const templateEnvironment = "$" + "{effect}"
for (const [name, fragment, shell, status] of [
  ["unflagged template", "EFFECT_NODE_MODULES=./deps", templateEnvironment + " go test ./one", 1],
  ["later flag does not cover a template", "EFFECT_NODE_MODULES=./deps", templateEnvironment + " go test ./one && go test -trimpath ./two", 1],
  ["literal flags are supported", "GOFLAGS=-trimpath", templateEnvironment + " go test ./one", 0],
  ["literal flags expire", "GOFLAGS=-trimpath", templateEnvironment + " go test ./one && go test ./two", 1],
]) test("trimpath audit expands declaration environments: " + name, t => {
  const quote = String.fromCharCode(96)
  const source = "const effect = " + JSON.stringify(fragment) + "\nconst target = { shell: " + quote + shell + quote + " }\n"
  const result = auditNativeSource(t, source)
  assert.equal(result.status, status, result.stdout + result.stderr)
})

test("trimpath audit retains the real template command's flag coverage", t => {
  const source = read("PACKAGE.ts")
  const entry = "go test -p 8 -count=1 -trimpath -timeout 5m"
  assert.equal(source.split(entry).length, 2, "the template command must remain unique")
  const result = auditNativeSource(t, source.replace(entry, entry.replace("-trimpath", "")), "PACKAGE.ts")
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /go test invocation 1 requires -trimpath/)
})

// Cross environment defaults with ordered CLI overrides in independent build,
// test and native-helper commands. A later fully flagged command is a control:
// it must never rescue a disabled trimpath setting in the preceding command.
test("trimpath audit follows effective flag precedence across generated commands", t => {
  const environments = [[], [true], [false], [true, false], [false, true]]
  const overrides = [[], [true], [false], [true, false], [false, true], [true, false, true]]
  const failures = []
  let samples = 0
  for (const command of ["go build", "go test", "sh scripts/native-output.sh build out"]) {
    for (const defaults of environments) {
      for (const explicit of overrides) {
        const flags = values => values.map(value => "-trimpath=" + value).join(" ")
        const shell = "export GOFLAGS='" + flags(defaults) + "'; " + command +
          " " + flags(explicit) + " ./fixture && go build -trimpath ./control"
        const source = "const target = { shell: " + JSON.stringify(shell) + " }\n"
        const enabled = (explicit.at(-1) ?? defaults.at(-1) ?? false)
        const result = auditNativeSource(t, source)
        if (result.status !== (enabled ? 0 : 1)) failures.push({ command, defaults, explicit, status: result.status })
        samples++
      }
    }
  }
  assert.equal(samples, 90)
  assert.deepEqual(failures, [])
})

for (const [name, flags, status] of [
  ["quoted flag enables", "'-trimpath'", 0],
  ["quoted final false wins", "-trimpath '-trimpath=false'", 1],
  ["quoted final true wins", "-trimpath=false '-trimpath=true'", 0],
  ["linker payload cannot disable", "-trimpath \"-ldflags=-X 'main.value=keep -trimpath=false'\"", 0],
  ["linker payload cannot enable", "\"-ldflags=-X 'main.value=keep -trimpath'\"", 1],
]) test("trimpath audit retains Go environment argument boundaries: " + name, t => {
  const shell = "GOFLAGS=" + JSON.stringify(flags) + " go build ./fixture"
  const result = auditNativeSource(t, shell + "\n", "scripts/build-vibelang.sh")
  assert.equal(result.status, status, result.stdout + result.stderr)
})


test("trimpath audit rejects removal from the real progress-wrapped specification command", t => {
  const source = read("PACKAGE.ts")
  const entry = "node ../../scripts/go-test-progress.mjs go test -json -count=1 -trimpath"
  assert.equal(source.split(entry).length, 2, "the real progress command must be unique")
  const current = auditNativeSource(t, source, "PACKAGE.ts")
  assert.equal(current.status, 0, current.stdout + current.stderr)
  const result = auditNativeSource(t, source.replace(entry, entry.replace(" -trimpath", "")), "PACKAGE.ts")
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /PACKAGE\.ts:.*go test invocation 1 requires -trimpath/)
})

test("trimpath audit checks generated progress-wrapped commands", t => {
  const failures = []
  let samples = 0
  for (const path of ["scripts/go-test-progress.mjs", "./scripts/go-test-progress.mjs", "../../scripts/go-test-progress.mjs"]) {
    for (const environment of ["", "GOFLAGS=-trimpath "]) {
      for (const flags of ["", "-trimpath", "-trimpath=false", "-trimpath=false -trimpath"]) {
        const shell = environment + "node " + path + " go test -json " + flags +
          " -run 'one&&two;-trimpath' ./fixture && go test -trimpath ./control"
        const source = "const target = { shell: " + JSON.stringify(shell) + " }\n"
        const enabled = flags ? flags.split(" ").at(-1) === "-trimpath" : Boolean(environment)
        const result = auditNativeSource(t, source)
        if (result.status !== (enabled ? 0 : 1)) failures.push({ path, environment, flags, status: result.status })
        samples++
      }
    }
  }
  assert.equal(samples, 24)
  assert.deepEqual(failures, [])
})

for (const [name, shell, status] of [
  ["wrapper flags stay local", "node scripts/go-test-progress.mjs go test -json -trimpath ./one && go test ./two", 1],
  ["inline wrapper environment stays local", "GOFLAGS=-trimpath node scripts/go-test-progress.mjs go test -json ./one && go test ./two", 1],
  ["wrapper inherits exported flags", "export GOFLAGS=-trimpath; node scripts/go-test-progress.mjs go test -json ./one", 0],
  ["wrapper selector is data", "node scripts/go-test-progress.mjs go test -json -run '-trimpath' ./one", 1],
  ["wrapper binary arguments are data", "node scripts/go-test-progress.mjs go test -json ./one -args -trimpath", 1],
  ["different node script arguments stay data", "node scripts/report.mjs go test ./one", 0],
  ["lookalike wrapper path stays data", "node tools/go-test-progress.mjs go test ./one", 0],
]) test("trimpath audit checks progress wrapper boundaries: " + name, t => {
  const result = auditNativeSource(t, shell + "\n", "scripts/build-vibelang.sh")
  assert.equal(result.status, status, result.stdout + result.stderr)
})

// Execute the production wrapper with an argv-recording child to verify that
// the audit sees the flags and environment actually forwarded to Go.
for (const [name, environment, flags, status, childStatus] of [
  ["missing flag", "", [], 1, 0],
  ["explicit flag", "", ["-trimpath"], 0, 0],
  ["inherited flag", "-trimpath", [], 0, 0],
  ["explicit disable and child failure", "-trimpath", ["-trimpath=false"], 1, 7],
]) test("trimpath audit agrees with real progress wrapper transport: " + name,
  { skip: process.platform === "win32" && "POSIX shell executable fixture" }, t => {
    const dir = mkdtempSync(join(tmpdir(), "go-progress-flags-"))
    t.after(() => rmSync(dir, { recursive: true, force: true }))
    const capture = join(dir, "capture.json"), child = join(dir, "capture.mjs")
    writeFileSync(child, 'import { writeFileSync } from "node:fs"; ' +
      'writeFileSync(process.env.AUDIT_CAPTURE, JSON.stringify({ args: process.argv.slice(2), flags: process.env.GOFLAGS })); ' +
      'process.exitCode = Number(process.env.AUDIT_CHILD_STATUS)\n')
    writeFileSync(join(dir, "go"), '#!/bin/sh\nexec "$AUDIT_NODE" "$AUDIT_CHILD" "$@"\n', { mode: 0o755 })
    const args = ["test", "-json", ...flags, "-run", "one&&two;-trimpath", "./fixture"]
    const wrapper = fileURLToPath(new URL("go-test-progress.mjs", import.meta.url))
    const result = spawnSync(process.execPath, [wrapper, "go", ...args], {
      encoding: "utf8", timeout: 15_000, cwd: dir,
      env: { ...process.env, PATH: dir + ":" + process.env.PATH, GOFLAGS: environment,
        AUDIT_NODE: process.execPath, AUDIT_CHILD: child, AUDIT_CAPTURE: capture, AUDIT_CHILD_STATUS: String(childStatus) },
    })
    assert.ifError(result.error)
    assert.equal(result.status, childStatus, result.stdout + result.stderr)
    assert.match(result.stderr, /go-progress .*event=finish .*cause=exit/)
    assert.deepEqual(JSON.parse(readFileSync(capture, "utf8")), { args, flags: environment })
    const shell = (environment ? "GOFLAGS=" + environment + " " : "") +
      "node scripts/go-test-progress.mjs go test -json " + flags.join(" ") + " -run 'one&&two;-trimpath' ./fixture"
    const audit = auditNativeSource(t, shell + "\n", "scripts/build-vibelang.sh")
    assert.equal(audit.status, status, audit.stdout + audit.stderr)
  })
