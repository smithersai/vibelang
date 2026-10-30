import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { addBunTestPreload, addCompilerOptions, addEffectLint, copyTarballs, formattable, formatterOf, addVibeLang, addVibeIncludes, addVibeLangSetting, addVitePlugin, initAgents, installCommand, packageManager, replaceTsc, rootTsconfigs, runsBunTest, setIgnoreLine, testConfigArgument, toolchainDirectory, toolchainSpecs, viteAppConfigs, wireKnip, wireVite, wireViteApps } from "../lib/wire.mjs"
import { setUpAgents } from "../lib/steps.mjs"
import { must } from "../lib/util.mjs"

// The runtime package's TypeScript (bun install in packages/runtime) has the compiler API.
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])

test("package.json edits: VibeLang packages and tsc in scripts", () => {
  const pkg = { dependencies: { parse5: "^8" }, devDependencies: { effect: "4.0.6", vitest: "^5" } }
  const added = addVibeLang(pkg, { vibelang: "file:/t/v.tgz", "vibelang-runtime": "file:/t/r.tgz", "vibelang-vite": "file:/t/p.tgz" })
  assert.equal(added.dependencies["vibelang-runtime"], "file:/t/r.tgz")
  assert.deepEqual(Object.keys(added.devDependencies), ["effect", "vitest", "vibelang"])
  assert.equal(pkg.dependencies["vibelang-runtime"], undefined)
  assert.deepEqual(replaceTsc({ build: "pnpm run clean && tsc -b tsconfig.build.json", typecheck: "tsc -p tsconfig.json --noEmit", test: "vitest run", other: "tscx" }), {
    build: "pnpm run clean && vibelang -b tsconfig.build.json", typecheck: "vibelang -p tsconfig.json --noEmit", test: "vitest run", other: "tscx"
  })
})

test("lint scripts: vibelang lint follows each oxlint run whose config enables effecttsgo rules (VIP-38)", () => {
  const configs = { "oxlint.config.ts": 'rules: { "effecttsgo/floating-effect": "error" }', ".oxlintrc.effect.json": '{ "rules": { "effecttsgo/effect-in-failure": "warn" } }', ".oxlintrc.json": '{ "rules": { "eqeqeq": "error" } }' }
  const scripts = {
    lint: "oxlint -c oxlint.config.ts",
    "lint:effect": "effect-tsgo patch --no-typescript --oxlint && oxlint --config .oxlintrc.effect.json --disable-nested-config --deny-warnings packages examples scripts",
    "lint:ci": "oxlint --disable-nested-config && pnpm lint:effect",
    done: "oxlint -c oxlint.config.ts && vibelang lint -c oxlint.config.ts",
    test: "vitest run"
  }
  assert.deepEqual(addEffectLint(scripts, (path) => configs[path]), {
    lint: "oxlint -c oxlint.config.ts && vibelang lint -c oxlint.config.ts",
    "lint:effect": "effect-tsgo patch --no-typescript --oxlint && oxlint --config .oxlintrc.effect.json --disable-nested-config --deny-warnings packages examples scripts && vibelang lint -c .oxlintrc.effect.json --deny-warnings packages examples scripts",
    "lint:ci": "oxlint --disable-nested-config && pnpm lint:effect",
    done: "oxlint -c oxlint.config.ts && vibelang lint -c oxlint.config.ts",
    test: "vitest run"
  })
})

const vitestConfig = `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
  },
})
`

test("addVitePlugin adds the plugin first and once, in the file's quote style", () => {
  const out = addVitePlugin(vitestConfig, ts)
  assert.equal(out, `import { defineConfig } from 'vitest/config'
import vibelang from 'vibelang-vite'

export default defineConfig({
  plugins: [vibelang()],
  test: {
    environment: 'happy-dom',
  },
})
`)
  assert.equal(addVitePlugin(out, ts), out)
  assert.ok(addVitePlugin('import react from "@vitejs/plugin-react"\nexport default defineConfig({ plugins: [react()] })\n', ts).includes("plugins: [vibelang(), react()]"))
  assert.throws(() => addVitePlugin("export default { test: {} }\n", ts), /defineConfig/)
})

// A monorepo's shared config, shaped like t3code's: its lint options have a
// plugins list of their own, which is not Vite's.
const sharedConfig = `import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
  },
  lint: {
    plugins: ["eslint", "oxc"],
  },
});
`

test("addVitePlugin adds the config's own plugins, never a nested option's, with the file's semicolons", () => {
  assert.equal(addVitePlugin(sharedConfig, ts), `import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import vibelang from "vibelang-vite";

export default defineConfig({
  plugins: [vibelang()],
  test: {
    environment: "node",
  },
  lint: {
    plugins: ["eslint", "oxc"],
  },
});
`)
  assert.equal(addVitePlugin("export default defineConfig({ plugins: [] })\n", ts), 'import vibelang from "vibelang-vite"\nexport default defineConfig({ plugins: [vibelang()] })\n')
  assert.throws(() => addVitePlugin("export default defineConfig({ plugins })\n", ts), /not an array literal/)
})

test("addVitePlugin adds the plugin to the object a defineConfig function returns", () => {
  const block = "import { defineConfig } from 'vite'\n\nexport default defineConfig(() => {\n  const x = 1\n  return {\n    plugins: [react()],\n  }\n})\n"
  assert.equal(addVitePlugin(block, ts), "import { defineConfig } from 'vite'\nimport vibelang from 'vibelang-vite'\n\nexport default defineConfig(() => {\n  const x = 1\n  return {\n    plugins: [vibelang(), react()],\n  }\n})\n")
  const arrow = 'import { defineConfig } from "vite"\n\nexport default defineConfig(({ mode }) => ({\n  base: "/"\n}))\n'
  assert.equal(addVitePlugin(arrow, ts), 'import { defineConfig } from "vite"\nimport vibelang from "vibelang-vite"\n\nexport default defineConfig(({ mode }) => ({\n  plugins: [vibelang()],\n  base: "/"\n}))\n')
  assert.throws(() => addVitePlugin("export default defineConfig(make())\n", ts), /add vibelang\(\) from vibelang-vite to its plugins by hand/)
})

test("testConfigArgument reads --config and -c from the command or the package script it runs", () => {
  assert.equal(testConfigArgument("vp test run --config ../../vite.config.ts --dir ."), "../../vite.config.ts")
  assert.equal(testConfigArgument("vitest run --config=vitest.shared.ts"), "vitest.shared.ts")
  assert.equal(testConfigArgument("vitest run -c 'configs/vitest.ts'"), "configs/vitest.ts")
  assert.equal(testConfigArgument("pnpm test", { test: "vp test run --config ../../vite.config.ts --dir ." }), "../../vite.config.ts")
  assert.equal(testConfigArgument("bun run test:unit", { "test:unit": "vitest run -c ../shared.ts" }), "../shared.ts")
  assert.equal(testConfigArgument("pnpm exec vitest run", { test: "vitest run --config other.ts" }), null)
  assert.equal(testConfigArgument("bun test"), null)
})

// t3code: packages/contracts runs its tests with the repository's shared
// config, so the package itself has no config to wire.
test("wireVite wires the shared config the test command names, and gives its package the plugin", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vite-"))
  try {
    mkdirSync(join(root, "packages/contracts"), { recursive: true })
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "monorepo", private: true, devDependencies: { "vite-plus": "1.4.0" } }, null, 2) + "\n")
    writeFileSync(join(root, "vite.config.ts"), sharedConfig)
    writeFileSync(join(root, "packages/contracts/package.json"), JSON.stringify({ name: "contracts", scripts: { test: "vp test run --config ../../vite.config.ts --dir ." } }, null, 2) + "\n")
    const specsFor = (dir) => toolchainSpecs(dir, { vibelang: "vibelang-0.0.11.tgz", "vibelang-vite": "vibelang-vite-0.0.11.tgz" })
    const packages = [{ dir: "packages/contracts" }]
    for (const command of ["vp test run --config ../../vite.config.ts --dir . --maxWorkers=8", "pnpm test"]) {
      writeFileSync(join(root, "vite.config.ts"), sharedConfig)
      const wired = wireVite({ root, packages, test: { command, cwd: "packages/contracts" }, ts, specsFor })
      assert.deepEqual(wired.configs, ["vite.config.ts"])
      assert.deepEqual(wired.warnings, [])
      assert.ok(readFileSync(join(root, "vite.config.ts"), "utf8").includes('defineConfig({\n  plugins: [vibelang()],\n  test:'))
      assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies, {
        "vite-plus": "1.4.0",
        vibelang: "file:./.vibelang-toolchain/vibelang-0.0.11.tgz",
        "vibelang-vite": "file:./.vibelang-toolchain/vibelang-vite-0.0.11.tgz"
      })
    }
    assert.throws(() => wireVite({ root, packages, test: { command: "vitest run --config missing.ts", cwd: "packages/contracts" }, ts, specsFor }), /missing.ts .* is not a file of the target/)

    // Without --config, each package's own config is wired, and a package without one is named.
    writeFileSync(join(root, "packages/contracts/vitest.config.ts"), vitestConfig)
    mkdirSync(join(root, "packages/other"))
    writeFileSync(join(root, "packages/other/package.json"), "{}\n")
    const own = wireVite({ root, packages: [...packages, { dir: "packages/other" }], test: { command: "vitest run", cwd: "." }, ts, specsFor })
    assert.deepEqual(own.configs, ["packages/contracts/vitest.config.ts"])
    assert.deepEqual(own.changed, ["packages/contracts/vitest.config.ts", "packages/contracts/package.json"])
    assert.match(own.warnings[0], /^packages\/other: no Vite or Vitest config/)
    assert.equal(JSON.parse(readFileSync(join(root, "packages/contracts/package.json"), "utf8")).devDependencies.vibelang, "file:../../.vibelang-toolchain/vibelang-0.0.11.tgz")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("wireViteApps adds the plugin to every config that bundles migrated sources, through workspace dependencies, and to no test's", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vite-apps-"))
  try {
    const files = {
      "packages/core/package.json": { name: "core" },
      "packages/core/vitest.config.ts": vitestConfig,
      "packages/core/test/fixtures/app/vite.config.ts": vitestConfig,
      "packages/core/test/Website/vite-do-fixture/vite.config.ts": vitestConfig,
      "packages/mid/react-router-fixture/vite.config.ts": vitestConfig,
      "apps/web/tests/e2e/vite.config.ts": vitestConfig,
      "packages/mid/package.json": { name: "mid", dependencies: { core: "workspace:^" } },
      "apps/web/package.json": { name: "web", dependencies: { core: "workspace:*" } },
      "apps/web/vite.config.ts": vitestConfig,
      "apps/deep/package.json": { name: "deep", dependencies: { mid: "workspace:*" } },
      "apps/deep/vite.config.mts": vitestConfig,
      "apps/function/package.json": { name: "function", devDependencies: { core: "workspace:*" } },
      "apps/function/vite.config.ts": "import { defineConfig } from 'vite'\n\nexport default defineConfig(() => ({}))\n",
      "apps/function/vite.config.js": "export default makeConfig()\n",
      "apps/published/package.json": { name: "published", dependencies: { core: "^1.0.0" } },
      "apps/published/vite.config.ts": vitestConfig,
      "apps/other/package.json": { name: "other" },
      "apps/other/vite.config.ts": vitestConfig,
      "templates/base/package.json": { name: "template", dependencies: { core: "workspace:*" } },
      "templates/base/vite.config.ts": vitestConfig
    }
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(join(root, file, ".."), { recursive: true })
      writeFileSync(join(root, file), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n")
    }
    assert.deepEqual(viteAppConfigs(root, ["packages/core"]).sort(), ["apps/deep/vite.config.mts", "apps/function/vite.config.js", "apps/function/vite.config.ts", "apps/web/vite.config.ts", "packages/core/vitest.config.ts"])
    const specsFor = () => ({ vibelang: "0.0.12", "vibelang-vite": "0.0.12" })
    const wired = wireViteApps({ root, packages: [{ dir: "packages/core" }], ts, specsFor, wired: ["packages/core/vitest.config.ts"] })
    assert.deepEqual(wired.configs.sort(), ["apps/deep/vite.config.mts", "apps/function/vite.config.ts", "apps/web/vite.config.ts"])
    assert.equal(wired.warnings.length, 1)
    assert.match(wired.warnings[0], /^apps\/function\/vite\.config\.js: the config does not call defineConfig/)
    assert.ok(readFileSync(join(root, "apps/web/vite.config.ts"), "utf8").includes("import vibelang from 'vibelang-vite'"))
    assert.deepEqual(JSON.parse(readFileSync(join(root, "apps/web/package.json"), "utf8")).devDependencies, { vibelang: "0.0.12", "vibelang-vite": "0.0.12" })
    assert.equal(readFileSync(join(root, "apps/other/vite.config.ts"), "utf8"), vitestConfig)
    assert.equal(readFileSync(join(root, "packages/core/vitest.config.ts"), "utf8"), vitestConfig)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("addCompilerOptions adds to compilerOptions, or creates it, and keeps options already set", () => {
  assert.equal(addCompilerOptions('{\n  "extends": "./tsconfig.base.json"\n}\n', { rewriteRelativeImportExtensions: true }),
    '{\n  "compilerOptions": {\n    "rewriteRelativeImportExtensions": true\n  },\n  "extends": "./tsconfig.base.json"\n}\n')
  assert.equal(addCompilerOptions('{\n  "compilerOptions": {\n    "noEmit": false\n  }\n}\n', { rewriteRelativeImportExtensions: true }),
    '{\n  "compilerOptions": {\n    "rewriteRelativeImportExtensions": true,\n    "noEmit": false\n  }\n}\n')
  const set = '{ "compilerOptions": { "rewriteRelativeImportExtensions": false } }'
  assert.equal(addCompilerOptions(set, { rewriteRelativeImportExtensions: true }), set)
  assert.equal(addCompilerOptions("{}", { a: 1 }), '{\n  "compilerOptions": {\n    "a": 1\n  }\n}')
})

test("addVibeIncludes gives each .ts include pattern its .vibe pattern, which a composite project needs (TS6307)", () => {
  const add = (text) => addVibeIncludes(text, ts)
  assert.equal(add('{ "include": ["src/**/*.ts", "src/**/*.tsx"] }'), '{ "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vibe"] }')
  assert.equal(add('{\n  "include": [\n    "src/**/*.ts",\n    "test/**/*.ts",\n  ],\n}\n'), '{\n  "include": [\n    "src/**/*.ts",\n    "test/**/*.ts",\n    "src/**/*.vibe",\n    "test/**/*.vibe",\n  ],\n}\n')
  for (const text of ['{ "include": ["src/**/*.ts", "src/**/*.vibe"] }', '{ "include": ["src/**/*", "types/*.d.ts"] }', '{ "files": ["a.ts"] }', '{ "include": [] }']) {
    assert.equal(add(text), text)
  }
})

test("addVibeLangSetting adds to the vibelang object the file keeps, or a new top-level one", () => {
  const set = (text) => addVibeLangSetting(text, ts, "declarationSidecars", true)
  assert.equal(set('{\n  "compilerOptions": { "strict": true }\n}\n'), '{\n  "compilerOptions": { "strict": true },\n  "vibelang": { "declarationSidecars": true }\n}\n')
  assert.equal(set('{\n\t// comment\n\t"include": ["src"],\n}\n'), '{\n\t// comment\n\t"include": ["src"],\n\t"vibelang": { "declarationSidecars": true },\n}\n')
  assert.equal(set('{ "vibelang": { "tracing": "all" } }'), '{ "vibelang": { "declarationSidecars": true, "tracing": "all" } }')
  assert.equal(set('{ "compilerOptions": { "vibelang": {} } }'), '{ "compilerOptions": { "vibelang": { "declarationSidecars": true } } }')
  assert.equal(set('{}'), '{\n  "vibelang": { "declarationSidecars": true }\n}')
  const done = '{ "vibelang": { "declarationSidecars": true } }'
  assert.equal(set(done), done)
})

test("rootTsconfigs lists the tsconfig files that extend no other of the repository's", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-tsconfigs-"))
  try {
    const files = {
      "tsconfig.base.json": '{ "compilerOptions": { "strict": true } }',
      "tsconfig.json": '{ "files": [], "references": [{ "path": "packages/a" }] }',
      "packages/a/tsconfig.json": '{\n  // inherits\n  "extends": "../../tsconfig.base.json"\n}',
      "packages/a/tsconfig.build.json": '{ "extends": "./tsconfig" }',
      "packages/b/tsconfig.json": '{ "extends": ["@tsconfig/node22/tsconfig.json"] }',
      "packages/b/node_modules/x/tsconfig.json": "{}",
      ".cache/tsconfig.json": "{}",
      "package.json": '{ "workspaces": ["packages/*"] }',
      "repos/effect/package.json": "{}",
      "repos/effect/tsconfig.json": "{}",
      "repos/effect/packages/effect/tsconfig.json": "{}"
    }
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(root, file, ".."), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    assert.deepEqual(rootTsconfigs(root, ts).sort(), ["packages/b/tsconfig.json", "tsconfig.base.json", "tsconfig.json"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("bun test gets vibelang/bun in the [test] preload, which is the one it applies", () => {
  assert.equal(addBunTestPreload(""), '[test]\npreload = ["vibelang/bun"]\n')
  // A top-level preload is for bun run; bun test ignores it.
  assert.equal(addBunTestPreload('preload = ["vibelang/bun"]\n'), 'preload = ["vibelang/bun"]\n\n[test]\npreload = ["vibelang/bun"]\n')
  assert.equal(addBunTestPreload('[test]\ntimeout = 5000\n\n[install]\nexact = true\n'), '[test]\npreload = ["vibelang/bun"]\ntimeout = 5000\n\n[install]\nexact = true\n')
  assert.equal(addBunTestPreload('[test]\npreload = ["./setup.ts"]\n'), '[test]\npreload = ["vibelang/bun", "./setup.ts"]\n')
  assert.equal(addBunTestPreload('[test]\npreload = "./setup.ts"\n'), '[test]\npreload = ["vibelang/bun", "./setup.ts"]\n')
  const done = '[test]\npreload = ["vibelang/bun"]\n'
  assert.equal(addBunTestPreload(done), done)
  assert.equal(runsBunTest("bun test"), true)
  assert.equal(runsBunTest("bun run test", { test: "bun test --timeout 30000" }), true)
  assert.equal(runsBunTest("pnpm test", { test: "vitest run" }), false)
  assert.equal(runsBunTest("bun run test", { test: "bunx vitest" }), false)
})

test("wireKnip moves a JSON Knip configuration to knip.config.ts with VibeLang's compiler", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-knip-"))
  try {
    const knipJson = '{\n  // dead code\n  "$schema": "https://unpkg.com/knip@6/schema.json",\n  "ignore": "scripts/**",\n}\n'
    writeFileSync(join(root, "knip.jsonc"), knipJson)
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "repo", scripts: { knip: "knip --config knip.jsonc" }, devDependencies: { knip: "^6" } }, null, 2) + "\n")
    const wired = wireKnip({ root, specs: { vibelang: "0.0.12" } })
    assert.deepEqual(wired.changed, ["knip.jsonc", "knip.config.ts", "package.json"])
    assert.deepEqual(wired.warnings, ["package.json script knip names knip.jsonc, which is now knip.config.ts"])
    assert.equal(existsSync(join(root, "knip.jsonc")), false)
    const text = readFileSync(join(root, "knip.config.ts"), "utf8")
    assert.ok(text.startsWith('import vibelang from "vibelang/knip"\n'))
    assert.ok(text.includes(`const config: { ignore?: string | string[]; [setting: string]: unknown } = ${knipJson.trim()}`))
    // A repository's lint may forbid type assertions (typescript/consistent-type-assertions), and its
    // typecheck may include the configuration: it holds no assertion and checks under strict.
    assert.doesNotMatch(text, /\}\s+as\s+\{/)
    writeFileSync(join(root, "knip.d.ts"), 'declare module "vibelang/knip" { const compile: (text: string) => string; export default compile }\n')
    const program = ts.createProgram([join(root, "knip.config.ts"), join(root, "knip.d.ts")], { strict: true, noEmit: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, types: [] })
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [])
    assert.ok(text.includes('  compilers: { vibe: vibelang },\n  ignore: [...[config.ignore ?? []].flat(), "**/*.d.vibe.ts"],\n'))
    // The configuration is TypeScript, and its value keeps the JSON's settings.
    const out = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS }, reportDiagnostics: true })
    assert.deepEqual(out.diagnostics, [])
    const module = { exports: {} }
    new Function("module", "exports", "require", out.outputText)(module, module.exports, () => ({ default: "compiler" }))
    assert.deepEqual(module.exports.default, { $schema: "https://unpkg.com/knip@6/schema.json", ignore: ["scripts/**", "**/*.d.vibe.ts"], compilers: { vibe: "compiler" } })
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies.vibelang, "0.0.12")

    // A package.json key moves too; a configuration that is code is named, not rewritten.
    rmSync(join(root, "knip.config.ts"))
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "repo", knip: { entry: ["src/main.ts"] } }, null, 2) + "\n")
    assert.deepEqual(wireKnip({ root, specs: { vibelang: "0.0.12" } }).changed, ["knip.config.ts", "package.json"])
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).knip, undefined)
    writeFileSync(join(root, "knip.config.ts"), "export default {}\n")
    assert.match(wireKnip({ root, specs: { vibelang: "0.0.12" } }).warnings[0], /^knip\.config\.ts: add compilers/)
    // A repository without Knip is left alone.
    rmSync(join(root, "knip.config.ts"))
    writeFileSync(join(root, "package.json"), '{ "name": "repo" }\n')
    assert.deepEqual(wireKnip({ root, specs: { vibelang: "0.0.12" } }), { changed: [], warnings: [], config: null })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("formatterOf finds the repository's own formatter, from its format scripts or its dependencies", () => {
  assert.deepEqual(formatterOf({ scripts: { format: "oxfmt", "format:check": "oxfmt --check" } }), ["oxfmt"])
  assert.deepEqual(formatterOf({ scripts: { fmt: "vp fmt", "fmt:check": "vp fmt --check" } }), ["vp", "fmt"])
  assert.deepEqual(formatterOf({ scripts: { "lint:format": "prettier --check ." } }), ["prettier", "--write"])
  assert.deepEqual(formatterOf({ scripts: { format: "biome format --write ." } }), ["biome", "format", "--write"])
  assert.deepEqual(formatterOf({ scripts: { lint: "oxlint" }, devDependencies: { prettier: "3.6.2" } }), ["prettier", "--write"])
  assert.equal(formatterOf({ scripts: { lint: "oxlint" } }), null)
  assert.deepEqual(formattable(["package.json", "tsconfig.json", "pnpm-workspace.yaml", "vite.config.ts", "src/a.vibe", "src/a.d.vibe.ts", "pnpm-lock.yaml", ".gitignore", ".prettierignore", "bunfig.toml", "knip.config.ts"]),
    ["package.json", "tsconfig.json", "pnpm-workspace.yaml", "vite.config.ts", "knip.config.ts"])
})

test("packageManager reads the lockfile", () => {
  assert.equal(packageManager(["pnpm-lock.yaml", "package.json"]), "pnpm")
  assert.equal(packageManager(["bun.lock"]), "bun")
  assert.equal(packageManager(["package.json"]), "npm")
  assert.equal(installCommand("pnpm"), "pnpm install --no-frozen-lockfile")
})

test("a staged toolchain's specifiers are relative to each package, into the ignored root directory", () => {
  const tarballs = { vibelang: "vibelang-0.0.11.tgz", "vibelang-runtime": "vibelang-runtime-0.0.11.tgz" }
  assert.deepEqual(toolchainSpecs("packages/foldkit", tarballs), {
    vibelang: "file:../../.vibelang-toolchain/vibelang-0.0.11.tgz",
    "vibelang-runtime": "file:../../.vibelang-toolchain/vibelang-runtime-0.0.11.tgz"
  })
  assert.equal(toolchainSpecs(".", tarballs).vibelang, "file:./.vibelang-toolchain/vibelang-0.0.11.tgz")
  assert.equal(toolchainSpecs("apps/web/", tarballs).vibelang, "file:../../.vibelang-toolchain/vibelang-0.0.11.tgz")
})

test("a rebuilt toolchain of the same version installs: each tarball's name follows its content", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "vibe-tarballs-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  // Two builds of vibelang 0.0.11 whose npm pack names agree; the second adds a command, as vibelang-format was added.
  const build = async (dir, bins) => {
    const pkg = join(root, dir, "package")
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "vibelang", version: "0.0.11", bin: Object.fromEntries(bins.map((bin) => [bin, `${bin}.js`])) }))
    for (const bin of bins) writeFileSync(join(pkg, `${bin}.js`), "")
    await must("npm pack --silent --pack-destination ..", { cwd: pkg })
    return join(root, dir)
  }
  const first = await build("first", ["vibelang"])
  const second = await build("second", ["vibelang", "vibelang-format"])
  const target = join(root, "target")
  mkdirSync(target)
  // What setup does on each run: a fresh toolchain directory, the package's specifiers, an install.
  const install = async (toolchain) => {
    const local = join(target, toolchainDirectory)
    rmSync(local, { recursive: true, force: true })
    const tarballs = copyTarballs(toolchain, { vibelang: "vibelang-0.0.11.tgz" }, local)
    writeFileSync(join(target, "package.json"), JSON.stringify({ name: "target", private: true, devDependencies: toolchainSpecs(".", tarballs) }))
    await must("npm install --offline --no-audit --no-fund", { cwd: target })
    return tarballs.vibelang
  }
  await install(first)
  const after = await install(second)
  assert.ok(existsSync(join(target, "node_modules/.bin/vibelang-format")), "the second build's new command is linked")
  assert.equal(await install(second), after, "the same build keeps its name")
})

test("setIgnoreLine adds the toolchain directory once and removes it for a published version", () => {
  assert.equal(setIgnoreLine("node_modules\ndist", ".vibelang-toolchain/", true), "node_modules\ndist\n.vibelang-toolchain/\n")
  assert.equal(setIgnoreLine("", ".vibelang-toolchain/", true), ".vibelang-toolchain/\n")
  const added = setIgnoreLine("node_modules\n", ".vibelang-toolchain/", true)
  assert.equal(setIgnoreLine(added, ".vibelang-toolchain/", true), added)
  assert.equal(setIgnoreLine(added, ".vibelang-toolchain/", false), "node_modules\n")
  assert.equal(setIgnoreLine("node_modules\n", ".vibelang-toolchain/", false), "node_modules\n")
})

test("initAgents sets the target's coding agents up with the vibelang a workspace package installed", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-agents-"))
  try {
    writeFileSync(join(root, "package.json"), "{}")
    mkdirSync(join(root, "packages/core/node_modules/.bin"), { recursive: true })
    symlinkSync(fileURLToPath(new URL("../../../../packages/compiler/", import.meta.url)), join(root, "packages/core/node_modules/vibelang"))
    symlinkSync("../vibelang/bin/vibelang", join(root, "packages/core/node_modules/.bin/vibelang"))
    const { files } = await initAgents({ root, packageDir: "packages/core", log: join(root, "agents-init.log") })
    assert.ok(files.includes(".codex/hooks.json") && files.includes(".agents/skills/vibelang/SKILL.md"), files.join(", "))
    const hook = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8")).hooks.PostToolUse[0].hooks[0].command
    assert.equal(hook, "npx --no --prefix packages/core -- vibelang agents hook")
    assert.match(readFileSync(join(root, "AGENTS.md"), "utf8"), /npx --prefix packages\/core vibelang agents check/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("setup formats the files vibelang agents init writes, with the target's own formatter", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-agents-"))
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { format: "oxfmt" } }))
    mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
    // The formatter records the files it was given.
    writeFileSync(join(root, "node_modules/.bin/oxfmt"), '#!/bin/sh\nprintf "%s\\n" "$@" > formatted.txt\n', { mode: 0o755 })
    mkdirSync(join(root, "packages/core/node_modules/.bin"), { recursive: true })
    symlinkSync(fileURLToPath(new URL("../../../../packages/compiler/", import.meta.url)), join(root, "packages/core/node_modules/vibelang"))
    symlinkSync("../vibelang/bin/vibelang", join(root, "packages/core/node_modules/.bin/vibelang"))
    const { files } = await setUpAgents(root, "packages/core", root)
    const formatted = readFileSync(join(root, "formatted.txt"), "utf8").split("\n")
    const json = files.filter((file) => file.endsWith(".json"))
    assert.ok(json.length > 0, files.join(", "))
    for (const file of json) assert.ok(formatted.includes(file), `${file} was not formatted`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("initAgents writes nothing with a vibelang that has no agents command", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-agents-"))
  try {
    mkdirSync(join(root, "node_modules/vibelang"), { recursive: true })
    assert.deepEqual((await initAgents({ root, packageDir: ".", log: join(root, "log") })).files, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("wireVite follows a package's test script to a shared config once, and warns for a package with neither", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-wire-"))
  try {
    const write = (file, text) => {
      mkdirSync(join(root, file, ".."), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const manifest = (test) => JSON.stringify({ scripts: { test } })
    write("package.json", "{}")
    write("vite.config.ts", "export default defineConfig({ plugins: [] })\n")
    write("packages/a/package.json", manifest("vp test run --config ../../vite.config.ts --dir ."))
    write("packages/b/package.json", manifest("vp test run --config ../../vite.config.ts --dir ."))
    write("packages/c/package.json", manifest("vp test run"))
    write("packages/d/package.json", manifest("vp test run --config ./missing.config.ts"))
    const packages = ["a", "b", "c", "d"].map((name) => ({ dir: `packages/${name}` }))
    const specsFor = () => ({ vibelang: "0.0.12", "vibelang-vite": "0.0.12" })
    const result = wireVite({ root, packages, test: { command: "python3 scope.py", cwd: "." }, ts, specsFor })
    assert.deepEqual(result.configs, ["vite.config.ts"])
    assert.deepEqual(result.warnings.map((w) => w.split(":")[0]), ["packages/c", "packages/d"])
    assert.ok(readFileSync(join(root, "vite.config.ts"), "utf8").includes("vibelang()"))
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies, { vibelang: "0.0.12", "vibelang-vite": "0.0.12" })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("wireViteApps leaves an Astro app's Vite config alone and says where the plugin goes", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-wire-"))
  try {
    const write = (file, text) => {
      mkdirSync(join(root, file, ".."), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const config = "export default defineConfig({ plugins: [] })\n"
    write("package.json", "{}")
    write("packages/core/package.json", JSON.stringify({ name: "core" }))
    write("apps/site/package.json", JSON.stringify({ name: "site", dependencies: { core: "workspace:*" } }))
    write("apps/site/vite.config.ts", config)
    write("apps/site/astro.config.mjs", "export default {}\n")
    const result = wireViteApps({ root, packages: [{ dir: "packages/core" }], ts, specsFor: () => ({ vibelang: "0.0.12", "vibelang-vite": "0.0.12" }) })
    assert.deepEqual(result.configs, [])
    assert.match(result.warnings[0], /^apps\/site\/vite\.config\.ts: Astro builds this app from astro\.config\.mjs/)
    assert.equal(readFileSync(join(root, "apps/site/vite.config.ts"), "utf8"), config)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
