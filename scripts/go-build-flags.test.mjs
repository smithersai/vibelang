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

const hasTrimpath = value => /(?:^|[\s}])-trimpath(?:=true)?(?:\s|$)/.test(value)
const valueFlags = new Set(["-run", "-bench", "-fuzz", "-gcflags", "-ldflags", "-tags",
  "-o", "-p", "-timeout", "-count", "-cpu", "-coverpkg", "-mod", "-modfile", "-overlay"])

function hasExplicitTrimpath(words) {
  for (let i = 0; i < words.length; i++) {
    if (/^-trimpath(?:=true)?$/.test(words[i])) return true
    if (valueFlags.has(words[i])) i++
  }
  return false
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
        const go = words[program] === "go" && /^(build|test)$/.test(words[program + 1] ?? "")
        const nativeProgram = program + (words[program] === "sh" ? 1 : 0)
        const native = /(?:^|\/)native-output\.sh$/.test(words[nativeProgram] ?? "") &&
          words[nativeProgram + 1] === "build"
        const flags = words.slice(native ? nativeProgram + 3 : program + 2)
        if (go || native) {
          invocation++
          if (!inline && !hasExplicitTrimpath(flags)) {
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
  ["forms generator", "build ../built/local/vibelang-forms -p 8 -trimpath"],
  ["mapper", "go build -p 8 -trimpath -o ../built/local/vibelang-mapper"],
]) test("trimpath audit rejects a missing flag in the " + name, t => {
  assert.equal(nativeSource.split(entry).length, 2, "the real native command must be unique")
  const changed = nativeSource.replace(entry, entry.replace(" -trimpath", ""))
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
  const changed = source.slice(0, start) + entry.replace(" -trimpath", "") + source.slice(witness)
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
  const result = auditNativeSource(t, source.replace(entry, entry.replace(" -trimpath", "")), "PACKAGE.ts")
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout, /go test invocation 1 requires -trimpath/)
})
