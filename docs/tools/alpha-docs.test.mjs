import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = process.env.DOCS_CONTRACT_ROOT || fileURLToPath(new URL("../../", import.meta.url))
const read = path => readFileSync(resolve(root, path), "utf8")
const supportedEffect = JSON.parse(readFileSync(new URL("../../packages/runtime/package.json", import.meta.url), "utf8")).peerDependencies.effect

test("1: onboarding explains calls into local TypeScript and npm at the boundary", () => {
  for (const path of ["README.md", "docs/user/src/setup/existing-project.md"]) {
    const text = read(path)
    assert.match(text, /your (?:own )?`\.ts` (?:code|functions) and npm packages/)
    assert.ok(text.includes("Effect.try"), path + ": Effect.try")
    assert.match(text, /114-vibelang-for-effect-users/)
    assert.match(text, /012-devtools/)
    // A function that may throw is wrapped with Effect's own Effect.try and run with try (VIP-4, VIP-5).
    assert.match(text, /import \{ parseSettings \} from "\.\/settings\.ts"\nerror BadSettings \{ cause: unknown \}\n\neffect function settings\(text: string\) \{\n  return try Effect\.try\(/)
  }
})

test("2: first-screen compatibility covers exact peers, checker and editor costs", () => {
  for (const path of ["README.md", "site/src/pages/index.mdx"]) {
    const text = read(path)
    const box = text.slice(text.indexOf("compatibility:start"), text.indexOf("compatibility:end"))
    for (const term of ["effect@" + supportedEffect, "@effect/platform-node", "@effect/vitest", "override", "tsc", "vue-tsc", "VS Code", "TypeScript files"]) assert.ok(box.includes(term), path + ": " + term)
    if (path === "README.md") assert.ok(text.indexOf("compatibility:start") < text.indexOf("## Why VibeLang"))
  }
  for (const path of ["docs/user/src/setup/existing-project.md", "docs/user/src/getting-started/004-installation.md"]) {
    assert.match(read(path), /bun add --exact [^\n]*effect@/)
    assert.match(read(path), /bun add -d --exact [^\n]*@effect\/vitest@/)
  }
  assert.match(read("packages/compiler/README.md"), /exact.*fiber internals/s)
  assert.match(read("site/src/pages/index.mdx"), /libraries compatible with the supported Effect version/)
})

test("3: prerequisites, output and starter descriptions agree", () => {
  const homepage = read("site/src/pages/index.mdx")
  assert.match(homepage, /Bun is optional/)
  assert.doesNotMatch(homepage, /Everything Effect does, VibeLang does|compiles to TypeScript/)
  assert.match(homepage, /Everything Effect does is reachable from VibeLang/)
  const install = read("docs/user/src/getting-started/004-installation.md")
  assert.match(install, /macOS on Apple silicon[^\n]*\| No \|/)
  assert.match(install, /Linux on x64[^\n]*\| Yes \|/)
  assert.match(install, /Linux on arm64[^\n]*\| No \|/)
  assert.match(install, /npm and Bun on Linux x64/)
  assert.doesNotMatch(install, /tests a starter on macOS arm64 and Linux x64/)
  assert.match(install, /macOS on Intel[^\n]*\| No \|/)
  for (const path of ["README.md", "docs/user/src/getting-started/004-installation.md"]) {
    assert.match(read(path), /Bun is optional/)
    assert.match(read(path), /"declaration": true/)
    assert.match(read(path), /starter.*(?:leaves|does not|omits)/i)
  }
  assert.doesNotMatch(read("docs/user/src/vibelang-features/114-vibelang-for-effect-users.md"), /0\.0\.6 starter/)
  for (const path of ["packages/compiler/README.md", "packages/compiler/package.json"]) assert.doesNotMatch(read(path), /compiles to TypeScript/)
})

test("4: the token headline leads with the corpus and discloses longer pairs", () => {
  const text = read("README.md")
  assert.match(text, /\*\*\d+\.\d+% fewer tokens across \d+ cheat-sheet pairs; VibeLang is longer in \d+ pairs\.\*\*/)
  assert.ok(text.indexOf("cheat-sheet pairs") < text.indexOf("The example above uses **"))
})

test("5: comparisons use real Console and the homepage uses the fair generator", () => {
  assert.doesNotMatch(read("docs/user/src/vibelang-features/115-cheat-sheet.md"), /Effect\.Console/)
  const homepage = read("site/src/pages/index.mdx")
  assert.doesNotMatch(homepage, /Effect\.fn\("greet"\)|Schema\.TaggedError<UserNotFound>/)
  assert.match(homepage, /Data\.TaggedError\("UserNotFound"\)/)
})

test("6: the shipped agent contract is self-contained and names current forms and routes", () => {
  const skill = read("packages/compiler/skills/vibelang/SKILL.md")
  assert.doesNotMatch(skill, /\bD\d+\b|docs\/design\/DECISIONS\.md/)
  for (const form of ["export data Shape", "export error", "export service", "export schema", "Delivery.Waiting()", "TestClock.adjust"]) assert.ok(skill.includes(form), form)
  const idioms = skill.split("## Idioms")[1].split(String.fromCharCode(96).repeat(3))[0]
  const routes = [...idioms.matchAll(new RegExp(String.fromCharCode(96) + "([^" + String.fromCharCode(96) + "]+)" + String.fromCharCode(96), "g"))].map(m => m[1]).filter(s => /\d{3}-|^spec\//.test(s))
  assert.ok(routes.length > 10)
  for (const route of routes) assert.match(route, /^[a-z-]+\/(?:\d{3}-[a-z-]+)?$/, route)
  assert.ok(routes.includes("vibelang-features/111-control-operations-and-handlers"))
  assert.ok(routes.includes("vibelang-features/112-producers"))
})

test("7: Effect users can find tracing limits, a debugging recipe and measured costs", () => {
  for (const path of ["docs/user/src/getting-started/004-installation.md", "docs/user/src/getting-started/012-devtools.md", "docs/user/src/vibelang-features/114-vibelang-for-effect-users.md"]) {
    const text = read(path)
    for (const term of ["--enable-source-maps", '"exported"', '"all"', "stack", "span"]) assert.ok(text.includes(term), path + ": " + term)
    assert.match(text, /default.*none|none.*default/s)
  }
  const tools = read("docs/user/src/getting-started/012-devtools.md")
  assert.match(tools, /Effect\.runPromise\(main\(\)\)/)
  assert.match(tools, /error\.stack/)
  const effects = read("docs/user/src/vibelang-features/114-vibelang-for-effect-users.md")
  for (const term of ["single-machine", "2.9", "Effect.fn", "catch 0", "Effect.orElseSucceed", "200,000", "1,000,000", "Clock.currentTimeMillis"]) assert.ok(effects.includes(term), term)
})

test("8: cache startup and formatter requirements state their measured limits", () => {
  const compiler = read("packages/compiler/README.md")
  assert.doesNotMatch(compiler, /warm start costs a few\s+milliseconds/)
  assert.match(compiler, /0\.5 s/)
  assert.match(compiler, /loading Effect/)
  assert.match(compiler, /0\.64\.3/)
  const formatting = read("docs/user/src/setup/formatting.md")
  assert.match(formatting, /0\.64\.3 or later/)
  assert.match(formatting, /0\.50\.2/)
  assert.match(formatting, /npm:vibelang\/dprint-plugin\.json/)
})
