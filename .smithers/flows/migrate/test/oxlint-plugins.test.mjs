import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { preloadRegister, wireOxlintPlugins } from "../lib/oxlint-plugins.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-oxlint-jsplugin-loader.json", import.meta.url), "utf8"))
const register = "--import=vibelang/register"

function repo(t, files) {
  const root = mkdtempSync(join(tmpdir(), "migrate-oxlint-plugins-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, posix.dirname(file)), { recursive: true })
    writeFileSync(join(root, file), typeof text === "string" ? text : JSON.stringify(text, null, 2) + "\n")
  }
  return root
}
const scripts = (root, file) => JSON.parse(readFileSync(join(root, file), "utf8")).scripts

// t3code (drive-t3code 01:58Z, 02:50Z): .oxlintrc.json names
// oxlint-plugin-t3code in jsPlugins; once its 16 modules were .vibe, `vp lint`
// failed with ERR_UNKNOWN_FILE_EXTENSION ".vibe" until NODE_OPTIONS loaded
// vibelang/register, and the plugin's RuleTester suites passed 379/379 with it.
test("corpus: t3code's lint and its plugin's tests load vibelang/register once the plugin is migrated", (t) => {
  const root = repo(t, corpus.files)
  assert.deepEqual(wireOxlintPlugins({ root, migrated: corpus.migrated, ts }).sort(), Object.keys(corpus.after).sort())
  for (const [file, expected] of Object.entries(corpus.after)) assert.deepEqual(scripts(root, file), expected, file)
  assert.deepEqual(wireOxlintPlugins({ root, migrated: corpus.migrated, ts }), [], "a second setup changes nothing")
})

test("a plugin package the migration does not move keeps every script as written", (t) => {
  const root = repo(t, corpus.files)
  assert.deepEqual(wireOxlintPlugins({ root, migrated: ["packages/other"], ts }), [])
  assert.deepEqual(scripts(root, "package.json"), corpus.files["package.json"].scripts)
})

test("preloadRegister adds to a NODE_OPTIONS the command sets, keeps one that loads it, and touches only the commands it names", () => {
  const oxlint = (words) => words[0] === "oxlint"
  assert.equal(preloadRegister("oxlint . && eslint .", oxlint), `NODE_OPTIONS="\${NODE_OPTIONS:+$NODE_OPTIONS }${register}" oxlint . && eslint .`)
  assert.equal(preloadRegister("NODE_OPTIONS=--max-old-space-size=4096 oxlint .", oxlint), `NODE_OPTIONS="--max-old-space-size=4096 ${register}" oxlint .`)
  assert.equal(preloadRegister(`(NODE_OPTIONS=${register} oxlint .) && eslint .`, oxlint), `(NODE_OPTIONS=${register} oxlint .) && eslint .`)
  assert.equal(preloadRegister("eslint . | tee lint.log", oxlint), "eslint . | tee lint.log")
})

test("property: each Oxlint command loads vibelang/register once, every other command stays, and a second pass changes nothing", () => {
  const command = fc.constantFrom("oxlint .", "vp lint --fix", "eslint .", "tsc -b", "vp test run", "NODE_OPTIONS=--trace-warnings oxlint src", "(vp lint)")
  fc.assert(fc.property(fc.array(command, { minLength: 1, maxLength: 4 }), fc.constantFrom(" && ", " ; ", " || "), (parts, joiner) => {
    const script = parts.join(joiner)
    const runs = (words) => words[0] === "oxlint" || (words[0] === "vp" && words[1] === "lint")
    const once = preloadRegister(script, runs)
    assert.equal(preloadRegister(once, runs), once)
    const out = once.split(joiner)
    parts.forEach((part, i) => {
      const lints = /(^|\s|\()oxlint\b|vp lint/.test(part)
      if (lints) assert.equal(out[i].split("vibelang/register").length - 1, 1, out[i])
      else assert.equal(out[i], part)
    })
  }), { numRuns: 300 })
})

test("corpus: t3code's generated ESLint process registers migrated plugin modules separately from Oxlint", (t) => {
  const witness = JSON.parse(readFileSync(new URL("./corpus/t3code-eslint-jsplugin-loader.json", import.meta.url), "utf8"))
  const root = repo(t, witness.files)
  wireOxlintPlugins({ root, migrated: witness.migrated, ts })
  const actual = scripts(root, "package.json")
  const eslint = actual.lint.split(" && ")[1]
  assert.match(eslint, /^NODE_OPTIONS=.*--import=vibelang\/register.* eslint --config /)
  assert.equal(actual.other, witness.files["package.json"].scripts.other)
  assert.deepEqual(wireOxlintPlugins({ root, migrated: witness.migrated, ts }), [])
})

test("generated ESLint registration survives first setup and repeated tooling refreshes", async (t) => {
  const { wireDeveloperTools } = await import("../lib/tooling.mjs")
  const witness = JSON.parse(readFileSync(new URL("./corpus/t3code-eslint-jsplugin-loader.json", import.meta.url), "utf8"))
  const files = structuredClone(witness.files)
  files["package.json"].scripts.lint = "vp lint --report-unused-disable-directives"
  const root = repo(t, files)
  const setup = () => {
    wireOxlintPlugins({ root, migrated: witness.migrated, ts })
    wireDeveloperTools({ root, ts, specsFor: () => ({ vibelang: "file:compiler.tgz" }) })
    return scripts(root, "package.json")
  }
  const first = setup()
  assert.match(first.lint.split(" && ")[1], /^NODE_OPTIONS=.*--import=vibelang\/register.* eslint --config /)
  assert.deepEqual(setup(), first)
  assert.deepEqual(setup(), first)
})

test("property: each generated ESLint invocation gets its own registration without changing other commands", (t) => {
  fc.assert(fc.property(
    fc.constantFrom("vp lint", "(vp lint --report-unused-disable-directives)", "NODE_OPTIONS=--trace-warnings oxlint src"),
    fc.constantFrom(".vibelang/eslint.config.mjs", ".vibelang/eslint.effect.config.mjs", "../../.vibelang/eslint.app.config.mjs"),
    fc.constantFrom("", "NODE_OPTIONS=--enable-source-maps ", "NODE_OPTIONS='--no-warnings' "),
    fc.constantFrom(" && ", " ; ", " || "),
    (native, config, env, separator) => {
      const command = native + separator + env + "eslint --config " + config + ' "**/*.vibe" --no-error-on-unmatched-pattern'
      const files = structuredClone(corpus.files)
      files["package.json"].scripts = { lint: command, own: "eslint src && tsc -b" }
      const root = repo(t, files)
      wireOxlintPlugins({ root, migrated: corpus.migrated, ts })
      const actual = scripts(root, "package.json")
      const parts = actual.lint.split(separator)
      for (const part of parts) assert.equal(part.split("vibelang/register").length - 1, 1, part)
      if (env) assert.ok(parts[1].includes(env.includes("enable") ? "--enable-source-maps" : "--no-warnings"))
      assert.equal(actual.own, "eslint src && tsc -b")
      assert.deepEqual(wireOxlintPlugins({ root, migrated: corpus.migrated, ts }), [])
    }
  ), { numRuns: 120 })
})

test("the generated ESLint child loads a plugin source through the registered Node hook", (t) => {
  const witness = JSON.parse(readFileSync(new URL("./corpus/t3code-eslint-jsplugin-loader.json", import.meta.url), "utf8"))
  const files = structuredClone(witness.files)
  files["node_modules/vibelang/package.json"] = { name: "vibelang", type: "module", exports: { "./register": "./register.mjs" } }
  files["node_modules/vibelang/register.mjs"] = `import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
registerHooks({ load(url, context, next) {
  if (url.endsWith(".vibe")) return { format: "module", source: readFileSync(new URL(url), "utf8"), shortCircuit: true };
  return next(url, context);
} });`
  files[".vibelang/eslint.config.mjs"] = 'import "../oxlint-plugin-t3code/rule.vibe"; console.log("plugin loaded");'
  files["oxlint-plugin-t3code/rule.vibe"] = "export default {};"
  files["bin/vp"] = "#!/bin/sh\nexit 0\n"
  files["bin/eslint"] = '#!/bin/sh\nexec "' + process.execPath + '" "$2"\n'
  const root = repo(t, files)
  chmodSync(join(root, "bin/vp"), 0o755)
  chmodSync(join(root, "bin/eslint"), 0o755)
  wireOxlintPlugins({ root, migrated: witness.migrated, ts })
  const child = spawnSync("sh", ["-c", scripts(root, "package.json").lint], {
    cwd: root, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "--trace-warnings", PATH: join(root, "bin") + ":" + process.env.PATH },
  })
  assert.equal(child.status, 0, child.stderr)
  assert.match(child.stdout, /plugin loaded/)
})
