import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
// opencode-42: packages/http-recorder's script/build.ts runs
// $`bunx tsc --emitDeclarationOnly` and then reads dist/index.d.ts; stock tsc
// reads no .vibe file, so once src/index.ts became .vibe the build failed.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { addEffectExitOptions, effectExitOptions, effectPatchesCompiler, replaceTscInScript, wireBunBuilds, ownedExtendedTsconfigs } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")

test("opencode-42: the build script's Bun shell runs vibelang where it ran tsc, and setup writes it", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-http-recorder-build.json", import.meta.url), "utf8"))
  assert.equal(replaceTscInScript(corpus.before, ts), corpus.after)
  assert.equal(replaceTscInScript(corpus.after, ts), corpus.after)
  const root = mkdtempSync(join(tmpdir(), "migrate-tsc-scripts-"))
  try {
    const files = {
      "package.json": JSON.stringify({ name: "opencode", private: true, workspaces: ["packages/*"] }),
      "packages/http-recorder/package.json": JSON.stringify({ name: "@opencode/http-recorder", scripts: { build: "bun ./script/build.ts" }, devDependencies: { "vibelang-unplugin": "x", vibelang: "x" } }),
      "packages/http-recorder/script/build.ts": corpus.before,
      "packages/http-recorder/src/index.vibe": "export const a = 1\n"
    }
    for (const [file, text] of Object.entries(files)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
    const wired = wireBunBuilds({ root, packages: [{ dir: "packages/http-recorder" }], ts, specsFor: () => ({ vibelang: "x", "vibelang-unplugin": "x" }) })
    assert.ok(wired.changed.includes("packages/http-recorder/script/build.ts"), JSON.stringify(wired))
    assert.equal(readFileSync(join(root, "packages/http-recorder/script/build.ts"), "utf8"), corpus.afterSetup)
    assert.deepEqual(wireBunBuilds({ root, packages: [{ dir: "packages/http-recorder" }], ts, specsFor: () => ({ vibelang: "x", "vibelang-unplugin": "x" }) }).changed, [], "full setup is idempotent")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// The command-only stage preserves entry spelling; complete setup also follows
// a converted entry, while retaining an existing native source when both exist.
test("tsc and literal Bun entrypoints: setup composes both rewrites and preserves native precedence", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-http-recorder-build.json", import.meta.url), "utf8"))
  fc.assert(fc.property(
    fc.constantFrom("migrated", "native", "both", "missing"), fc.boolean(),
    fc.constantFrom("bunx ", "pnpm exec ", "bun x "), fc.integer({ min: 0, max: 3 }),
    (state, jsx, runner, depth) => {
      const root = mkdtempSync(join(tmpdir(), "migrate-tsc-bun-compose-"))
      const entry = "./src/" + "nested/".repeat(depth) + "index" + (jsx ? ".tsx" : ".ts")
      const converted = entry.replace(/\.tsx?$/, jsx ? ".vibex" : ".vibe")
      const render = (text, selected) => text.replace("bunx ", runner).replace("./src/index.ts", selected).replace("./src/index.vibe", selected)
      const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
      try {
        put("package.json", JSON.stringify({ name: "composition", private: true, workspaces: ["packages/*"] }))
        put("packages/lib/package.json", JSON.stringify({ name: "@fixture/lib", scripts: { build: "bun ./script/build.ts" }, devDependencies: { "vibelang-unplugin": "x", vibelang: "x" } }))
        const source = render(corpus.before, entry)
        put("packages/lib/script/build.ts", source)
        put("packages/lib/src/other.vibe", "export const other = 1\n")
        if (state === "native" || state === "both") put("packages/lib/" + entry, "export const value = 1\n")
        if (state === "migrated" || state === "both") put("packages/lib/" + converted, "export const value = 2\n")
        assert.equal(replaceTscInScript(source, ts), render(corpus.after, entry), "the command stage leaves the written entry alone")
        const wire = () => wireBunBuilds({ root, packages: [{ dir: "packages/lib" }], ts, specsFor: () => ({ vibelang: "x", "vibelang-unplugin": "x" }) })
        assert.deepEqual(wire().warnings, [])
        assert.equal(readFileSync(join(root, "packages/lib/script/build.ts"), "utf8"), render(corpus.afterSetup, state === "migrated" ? converted : entry))
        assert.deepEqual(wire().changed, [], "a second complete setup changes nothing")
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  ), { seed: 420161, numRuns: 240 })
})

test("TestBunSetupCompositionQuoted", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-http-recorder-build.json", import.meta.url), "utf8"))
  assert.ok(readFileSync(SpecPath(corpus.spec), "utf8").includes(corpus.quote))
})

test("opencode-47: a build script that only runs tsc runs vibelang, and its package gets vibelang", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-codemode-build.json", import.meta.url), "utf8"))
  assert.equal(replaceTscInScript(corpus.before, ts), corpus.after)
  const root = mkdtempSync(join(tmpdir(), "migrate-tsc-scripts-"))
  try {
    const files = {
      "package.json": JSON.stringify({ name: "opencode", private: true, workspaces: ["packages/*"] }),
      "packages/codemode/package.json": JSON.stringify({ name: "@opencode/codemode", files: ["dist"], scripts: { build: "bun run script/build.ts" } }),
      "packages/codemode/script/build.ts": corpus.before,
      "packages/codemode/script/notes.ts": 'const help = "run tsc by hand"\n',
      "packages/codemode/src/codemode.vibe": "export const a = 1\n"
    }
    for (const [file, text] of Object.entries(files)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
    const wire = () => wireBunBuilds({ root, packages: [{ dir: "packages/codemode" }], ts, specsFor: () => ({ vibelang: "file:vibelang.tgz" }) })
    const wired = wire()
    assert.deepEqual(wired.changed.sort(), ["packages/codemode/package.json", "packages/codemode/script/build.ts"], JSON.stringify(wired))
    assert.deepEqual(wired.builds, [])
    assert.equal(readFileSync(join(root, "packages/codemode/script/build.ts"), "utf8"), corpus.after)
    assert.equal(readFileSync(join(root, "packages/codemode/script/notes.ts"), "utf8"), files["packages/codemode/script/notes.ts"])
    assert.deepEqual(JSON.parse(readFileSync(join(root, "packages/codemode/package.json"), "utf8")).devDependencies, { vibelang: "file:vibelang.tgz" })
    assert.deepEqual(wire().changed, [], "a second setup changes nothing")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// Generated build scripts: tsc in command position in $ templates (alone,
// through a runner, after a separator, beside an interpolation), and decoys
// that must stay: tsconfig words, tscx, tsc in an ordinary string, a comment,
// an interpolated value, another tag.
const runner = fc.constantFrom("", "bunx ", "npx ", "pnpm exec ", "bun x ", "bun ", "yarn ")
const flags = fc.constantFrom("", " --emitDeclarationOnly", " -p tsconfig.build.json", " -b")
const command = fc.tuple(runner, flags).map(([r, f]) => `${r}tsc${f}`)
const site = fc.constantFrom(
  (c) => [`await $\`${c}\``, true],
  (c) => [`await $\`rm -rf dist && ${c}\``, true],
  (c) => [`await $\`${c} --outDir \${out}\``, true],
  (c) => [`const x = "${c}"`, false],
  (c) => [`// ${c}`, false],
  (c) => [`await sh\`${c}\``, false],
  (c) => [`await $\`echo tsconfig.json tscx\``, false]
)
test("tsc-in-scripts: only tsc in command position of a $ template becomes vibelang", () => {
  fc.assert(fc.property(fc.array(fc.tuple(command, site), { minLength: 1, maxLength: 5 }), (lines) => {
    const built = lines.map(([c, s]) => s(c))
    const text = 'import { $ } from "bun"\nconst out = "dist"\n' + built.map(([line]) => line).join("\n") + "\n"
    const expected = 'import { $ } from "bun"\nconst out = "dist"\n' + built.map(([line, changes], i) => changes ? line.replace(/((?:bunx|npx|pnpm exec|bun x|bun|yarn) )?tsc(?=[\s`])/, "$1vibelang") : line).join("\n") + "\n"
    const result = replaceTscInScript(text, ts)
    assert.equal(result, expected)
    assert.equal(replaceTscInScript(result, ts), result)
  }), { seed: 42042, numRuns: 300 })
})

// Generated packages whose build scripts have no Bun.build: setup rewrites a
// script exactly when its Bun shell runs tsc, to replaceTscInScript's text,
// gives the package vibelang once, and a second setup changes nothing.
test("tsc-only-scripts: setup rewrites exactly the build scripts whose Bun shell runs tsc (opencode-47)", () => {
  fc.assert(fc.property(fc.array(fc.array(fc.tuple(command, site), { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 3 }), fc.boolean(), (scripts, hasVibelang) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-tsc-only-"))
    try {
      const texts = scripts.map((lines) => 'import { $ } from "bun"\nconst out = "dist"\n' + lines.map(([c, s]) => s(c)[0]).join("\n") + "\n")
      const manifest = { name: "@demo/lib", ...(hasVibelang ? { devDependencies: { vibelang: "mine" } } : {}) }
      const files = {
        "package.json": JSON.stringify({ name: "demo", private: true, workspaces: ["packages/*"] }),
        "packages/lib/package.json": JSON.stringify(manifest),
        "packages/lib/src/a.vibe": "export const a = 1\n",
        ...Object.fromEntries(texts.map((text, i) => [`packages/lib/script/build${i}.ts`, text]))
      }
      for (const [file, text] of Object.entries(files)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
      const wire = () => wireBunBuilds({ root, packages: [{ dir: "packages/lib" }], ts, specsFor: () => ({ vibelang: "file:vibelang.tgz" }) })
      const wired = wire()
      const rewritten = texts.map((text, i) => [`packages/lib/script/build${i}.ts`, replaceTscInScript(text, ts)]).filter(([, after], i) => after !== texts[i])
      for (const [file, after] of rewritten) assert.equal(readFileSync(join(root, file), "utf8"), after)
      texts.forEach((text, i) => { if (!rewritten.some(([f]) => f === `packages/lib/script/build${i}.ts`)) assert.equal(readFileSync(join(root, `packages/lib/script/build${i}.ts`), "utf8"), text) })
      const manifestChanged = rewritten.length > 0 && !hasVibelang
      assert.deepEqual(wired.changed.sort(), [...rewritten.map(([f]) => f), ...(manifestChanged ? ["packages/lib/package.json"] : [])].sort())
      assert.deepEqual(JSON.parse(readFileSync(join(root, "packages/lib/package.json"), "utf8")).devDependencies, hasVibelang ? { vibelang: "mine" } : manifestChanged ? { vibelang: "file:vibelang.tgz" } : undefined)
      assert.deepEqual(wired.builds, [])
      assert.deepEqual(wire().changed, [], "a second setup changes nothing")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { seed: 47047, numRuns: 150 })
})

// opencode http-recorder publish: script/build.ts ran stock `bunx tsc
// --emitDeclarationOnly` (TypeScript 6, no Effect patch anywhere in the
// repository), which ignores the tsconfig's @effect/language-service entry and
// exited 0. vibelang runs the entry's rules and exited 2 on unstableApiUsage
// warnings, so script/pack.ts failed. Setup now writes the plugin's own exit
// options into the entry (VIP-38 R3) when nothing patches the compiler.
test("opencode-tsc-warnings-exit: setup writes the plugin's exit options into the entry", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-tsc-warnings-exit.json", import.meta.url), "utf8"))
  assert.equal(addEffectExitOptions(corpus.before, ts), corpus.after)
  assert.equal(addEffectExitOptions(corpus.after, ts), corpus.after, "a second setup changes nothing")
  const plugin = ts.parseConfigFileTextToJson("tsconfig.json", corpus.after).config.compilerOptions.plugins[0]
  assert.deepEqual(plugin, { name: "@effect/language-service", transform: "@effect/language-service/transform", namespaceImportPackages: ["effect", "@effect/*"], ...effectExitOptions })
})

// Generated repositories: Effect patches the compiler exactly when some
// package script runs effect-tsgo or effect-language-service in command
// position (decoys: another word, a path segment that is not the command, a
// dependency name, a dependency's own script).
const effectCommand = fc.constantFrom("effect-tsgo patch", "effect-language-service patch", "bunx effect-tsgo --noEmit", "node_modules/.bin/effect-tsgo patch")
const effectDecoy = fc.constantFrom("my-effect-tsgo-helper", "echo effect-tsgoish", "bun add @effect/tsgo-x", "husky")
test("effect-patched-compiler: setup finds a script that patches the compiler", () => {
  fc.assert(fc.property(fc.array(fc.tuple(fc.boolean(), effectCommand, effectDecoy), { minLength: 1, maxLength: 4 }), (packages) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-effect-patch-"))
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "demo", private: true, workspaces: ["packages/*"] }))
      packages.forEach(([real, command, decoy], i) => {
        mkdirSync(join(root, `packages/p${i}`), { recursive: true })
        writeFileSync(join(root, `packages/p${i}/package.json`), JSON.stringify({ name: `p${i}`, scripts: { setup: real ? `${decoy} && ${command}` : decoy } }))
      })
      mkdirSync(join(root, "node_modules/x"), { recursive: true })
      writeFileSync(join(root, "node_modules/x/package.json"), JSON.stringify({ scripts: { postinstall: "effect-tsgo patch" } }))
      assert.equal(effectPatchesCompiler(root), packages.some(([real]) => real))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { seed: 38130, numRuns: 120 })
})

// Generated tsconfigs (JSONC: comments, trailing commas, one-line and
// multi-line entries): every @effect/language-service entry ends with both
// exit options, an author's own value for either stays as written, other
// plugins and options are untouched, comments survive, and a second pass is
// a no-op.
const authorValue = fc.constantFrom(undefined, true, false)
const effectEntry = fc.record({ warnings: authorValue, errors: authorValue, extra: fc.boolean(), multiline: fc.boolean() }).map((e) => ({ effect: true, ...e }))
const otherEntry = fc.constantFrom({ name: "next" }, { name: "typescript-plugin-css-modules", options: {} })
test("effect-exit-options: each Effect entry gains the options it lacks, nothing else moves", () => {
  fc.assert(fc.property(fc.array(fc.oneof(effectEntry, otherEntry), { maxLength: 4 }), fc.boolean(), fc.boolean(), fc.dictionary(fc.constantFrom("EK3801", "EK38100"), fc.constantFrom("error", "warning", "suggestion", "off")), (entries, comments, trailing, severities) => {
    const render = (e) => {
      if (!e.effect) return JSON.stringify(e)
      const props = [["name", "@effect/language-service"]]
      if (e.extra) props.push(["namespaceImportPackages", ["effect"]])
      if (e.warnings !== undefined) props.push(["ignoreEffectWarningsInTscExitCode", e.warnings])
      if (e.errors !== undefined) props.push(["ignoreEffectErrorsInTscExitCode", e.errors])
      const parts = props.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
      return e.multiline ? `{\n        ${parts.join(",\n        ")}${comments ? " // the author's" : ""}\n      }` : `{ ${parts.join(", ")} }`
    }
    const text = `{\n  ${comments ? "// a comment\n  " : ""}"compilerOptions": {\n    "strict": true,\n    "plugins": [\n      ${entries.map(render).join(",\n      ")}${trailing && entries.length ? "," : ""}\n    ]\n  },\n  "vibe": {"severities": ${JSON.stringify(severities)}}\n}\n`
    const next = addEffectExitOptions(text, ts)
    const parsed = ts.parseConfigFileTextToJson("tsconfig.json", next)
    assert.equal(parsed.error, undefined, next)
    const plugins = parsed.config.compilerOptions.plugins
    assert.equal(plugins.length, entries.length, next)
    entries.forEach((e, i) => {
      if (!e.effect) return assert.deepEqual(plugins[i], e, next)
      assert.equal(plugins[i].ignoreEffectWarningsInTscExitCode, e.warnings ?? true, next)
      assert.equal(plugins[i].ignoreEffectErrorsInTscExitCode, e.errors ?? true, next)
      assert.equal(plugins[i].namespaceImportPackages?.[0], e.extra ? "effect" : undefined, next)
    })
    assert.deepEqual(parsed.config.vibe.severities, { ...severities }, "authored diagnostic severities")
    assert.equal(parsed.config.compilerOptions.strict, true)
    if (comments) assert.ok(next.includes("// a comment"), next)
    assert.equal(next.split("// the author's").length, text.split("// the author's").length, next)
    if (entries.every((e) => !e.effect || (e.warnings !== undefined && e.errors !== undefined))) assert.equal(next, text)
    assert.equal(addEffectExitOptions(next, ts), next, "idempotent")
  }), { seed: 38131, numRuns: 300 })
})


test("effect-exit-options: native plugin corpus retains modern severities", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/native-plugin-exit-policy.json", import.meta.url), "utf8"))
  const source = JSON.stringify(corpus)
  const result = JSON.parse(addEffectExitOptions(source, ts))
  assert.deepEqual(result.vibe, corpus.vibe)
  assert.deepEqual(result.compilerOptions.plugins[0].diagnosticSeverity, corpus.compilerOptions.plugins[0].diagnosticSeverity)
  assert.equal(result.compilerOptions.plugins[0].ignoreEffectErrorsInTscExitCode, true)
  assert.equal(result.compilerOptions.plugins[0].ignoreEffectWarningsInTscExitCode, true)
})

test("effect-exit-extends: TypeScript resolves owned shared bases without tsconfig names", () => {
  fc.assert(fc.property(fc.integer({min:1,max:3}), fc.boolean(), authorValue, (depth, comments, authored) => {
    const root = mkdtempSync(join(tmpdir(), "effect-exit-extends-"))
    try {
      writeFileSync(join(root,"package.json"),'{"private":true}')
      writeFileSync(join(root,"main.ts"),"export {}")
      writeFileSync(join(root,"tsconfig.json"),JSON.stringify({extends:"./base0.json",files:["main.ts"]}))
      for(let n=0;n<depth;n++) {
        const value=n+1<depth?{extends:"./base"+(n+1)+".json"}:{compilerOptions:{plugins:[{name:"@effect/language-service",...(authored===undefined?{}:{ignoreEffectWarningsInTscExitCode:authored,ignoreEffectErrorsInTscExitCode:authored})}]}}
        writeFileSync(join(root,"base"+n+".json"),(comments?"// retained shared config\n":"")+JSON.stringify(value))
      }
      const paths=ownedExtendedTsconfigs(root,ts,["tsconfig.json"])
      assert.deepEqual(paths,["tsconfig.json",...Array.from({length:depth},(_,n)=>"base"+n+".json")].sort())
      for(const file of paths) {
        const original=readFileSync(join(root,file),"utf8")
        const fixed=addEffectExitOptions(original,ts)
        writeFileSync(join(root,file),fixed)
        assert.equal(addEffectExitOptions(fixed,ts),fixed)
        if(comments&&file.startsWith("base")) assert.ok(fixed.startsWith("// retained shared config"))
      }
      const resolved=ts.getParsedCommandLineOfConfigFile(join(root,"tsconfig.json"),{}, {...ts.sys,onUnRecoverableConfigFileDiagnostic(d){throw Error(String(d.code))}})
      assert.equal(resolved.options.plugins[0].ignoreEffectErrorsInTscExitCode,authored??true)
      assert.equal(resolved.options.plugins[0].ignoreEffectWarningsInTscExitCode,authored??true)
    }finally{rmSync(root,{recursive:true,force:true})}
  }),{seed:38132,numRuns:80})
})

test("effect-exit-extends: external, fixture and vendored bases remain untouched", () => {
  const parent=mkdtempSync(join(tmpdir(),"effect-exit-boundary-"))
  const root=join(parent,"project")
  try {
    mkdirSync(root);mkdirSync(join(root,"tests"));mkdirSync(join(root,"vendor"))
    writeFileSync(join(root,"package.json"),'{"private":true}')
    writeFileSync(join(root,"main.ts"),"export {}")
    writeFileSync(join(root,"vendor/package.json"),'{"name":"foreign"}')
    const original='{"compilerOptions":{"plugins":[{"name":"@effect/language-service"}]}}'
    for(const base of ["../shared.json","./tests/base.json","./vendor/base.json"]) {
      const target=join(root,base)
      writeFileSync(target,original)
      writeFileSync(join(root,"tsconfig.json"),JSON.stringify({extends:base,files:["main.ts"]}))
      const skipped=[]
      const paths=ownedExtendedTsconfigs(root,ts,["tsconfig.json"],{onSkipped:value=>skipped.push(value)})
      assert.deepEqual(paths,["tsconfig.json"])
      assert.equal(skipped.length,1)
      assert.equal(readFileSync(target,"utf8"),original)
    }
  }finally{rmSync(parent,{recursive:true,force:true})}
})
