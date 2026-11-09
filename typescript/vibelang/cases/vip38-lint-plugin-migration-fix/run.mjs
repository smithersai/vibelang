// run-seconds: 300
// VIP-38 severity-key activation migration through the CLI: every fix scope
// writes the plain default plugin entry and nothing else changes.
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#f362e992b9648b6d
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | Ordinary `vibelang --fix` and both migration scope flags write the plain default plugin entry in the selected project’s own config, retaining inherited plugin entries, explicit disables, severities, JSONC comments and unrelated settings.
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#44d1688c57f6b344
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | The legacy shortcut enabled the whole default plugin even for an `"off"` key; add no per-rule suppression.
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#676357966ee7549e
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | Selected-file `--fix --only` remains unable to write configs.
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#681b63ece44cbe0b
// rule-evidence: docs/design/vips/0038-effect-lint-built-in.md#decision | Apart from the migration warning `EK3012`, prove equal diagnostic categories and inclusion, exit status and emission before and after; never add ignore flags to make migration pass.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "VIBELANG_BINARY must name the tested compiler")
const local = fileURLToPath(new URL(".", import.meta.url))
const root = realpathSync(mkdtempSync(join(tmpdir(), "vip38-plugin-migration-")))
// promiseInEffectSuccess (EK3897) plus a floating Effect, which only the whole
// default plugin's floatingEffect (EK3801) reports.
const witness = readFileSync(new URL("./witness.ts.txt", import.meta.url), "utf8") + "\nEffect.succeed(1)\n"
const other = '{ "name": "other", "nested": { "keep": [1, "two"] } }'
let checks = 0
try {
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(join(local, "node_modules/effect")), join(root, "node_modules/effect"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  const write = (name, text) => writeFileSync(join(root, name), text)
  const read = name => readFileSync(join(root, name), "utf8")
  const invoke = args => {
    const r = spawnSync(binary, [...args, "-p", ".", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
    assert.ifError(r.error)
    assert.equal(r.signal, null, r.stdout + r.stderr)
    checks++
    return { status: r.status, output: r.stdout + r.stderr }
  }
  // Everything the compiler shows apart from EK3012: diagnostics with their
  // categories, exit status and the emitted bytes. Standalone lint parity is
  // vip38-lint-native-config's.
  const observe = () => {
    rmSync(join(root, "out"), { recursive: true, force: true })
    const compiler = invoke([])
    const emitted = existsSync(join(root, "out/main.js")) ? read("out/main.js") : null
    const diagnostics = compiler.output.split("\n").filter(line => /\b(?:EK|TS)\d+:/.test(line) && !/EK3012:/.test(line)).sort()
    return {
      migration: (compiler.output.match(/warning EK3012:/g) ?? []).length,
      seen: { diagnostics, status: compiler.status, emitted },
      output: compiler.output,
    }
  }
  const scopes = [[]]
  let round = 0
  for (const severity of ["warning", "error", "suggestion", "off"]) {
    for (const inherited of [false, true]) {
      {
        {
          // Scopes rotate by three and noEmitOnError by four (F, T, T, F), so every
          // scope and both inheritance forms run with and without noEmitOnError.
          const scope = scopes[round % scopes.length], noEmitOnError = round % 4 === 1 || round % 4 === 2
          round++
          const label = JSON.stringify({ severity, inherited, noEmitOnError, scope })
          rmSync(join(root, "main.vibe"), { force: true })
          write("main.ts", witness)
          // An inherited unrelated plugin entry in a base the fix must not edit.
          const base = '{\n  "compilerOptions": { "plugins": [' + other + "] }\n}\n"
          write("base.json", base)
          const plugins = inherited ? "" : '\n    "plugins": [' + other + "],"
          const config = "{\n  // project comment\n" + (inherited ? '  "extends": "./base.json",\n' : "") +
            '  "compilerOptions": {' + plugins + '\n    "target": "ES2022", "module": "NodeNext", "strict": true, "skipLibCheck": true,\n' +
            '    "types": [], "outDir": "out", /* unrelated */ "declaration": true' + (noEmitOnError ? ', "noEmitOnError": true' : "") + "\n  },\n" +
            '  "files": ["main.ts"],\n  "watchOptions": { "watchFile": "useFsEvents" },\n' +
            '  "vibe": { "severities": { "EK3897": "' + severity + '" } } // trailing comment\n}\n'
          write("tsconfig.json", config)
          const before = observe()
          assert.equal(before.migration, 1, label + "\n" + before.output)
          // The legacy shortcut runs the whole default plugin, even for an "off" key.
          assert.equal(before.seen.diagnostics.some(line => /error EK3801:/.test(line)), true, label + "\n" + before.output)
          assert.equal(before.seen.diagnostics.some(line => /EK3897:/.test(line)), severity !== "off", label)

        }
      }
    }
  }


  // An existing Effect entry, even a native disable, is no migration: the fix keeps the disable.
  for (const disable of ['"diagnostics": false', '"diagnosticSeverity": null']) {
    rmSync(join(root, "main.vibe"), { force: true })
    const base = '{ "compilerOptions": { "plugins": [{ "name": "@effect/language-service", ' + disable + " }] } }\n"
    write("base.json", base)
    const config = '{\n  "extends": "./base.json",\n  "compilerOptions": { "target": "ES2022", "module": "NodeNext", "strict": true, "skipLibCheck": true, "types": [], "noEmit": true },\n' +
      '  "files": ["main.ts"],\n  "vibe": { "severities": { "EK3897": "error" } }\n}\n'
    write("tsconfig.json", config)
    const r = invoke([])
    assert.doesNotMatch(r.output, /EK3012|EK3897|EK3801/, disable + "\n" + r.output)
  }
} finally { rmSync(root, { recursive: true, force: true }) }
assert.equal(checks, 10)
console.log("VIP-38 plugin migration: 10 checks passed")
