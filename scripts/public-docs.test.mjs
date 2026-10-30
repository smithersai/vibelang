import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { test } from "node:test"

const root = new URL("../", import.meta.url)
const read = path => readFileSync(new URL(path, root), "utf8")

test("setup instructions address the person following them", () => {
  for (const name of ["existing-project", "vscode", "vite", "vibelang-cli", "react", "vue", "svelte"]) {
    const page = read(`docs/user/src/setup/${name}.md`)
    assert.doesNotMatch(page, /(?:tell|ask) the user|the user's editor/i, name)
  }
})

test("the shipped skill demonstrates Effect 4 config and scoped file IO", () => {
  const skill = read("packages/compiler/skills/vibelang/SKILL.md")
  assert.doesNotMatch(skill, /that reading is never wrong/)
  assert.match(skill, /try Config\.withDefault\(Config\.String\("NAME"\), "stranger"\)/)
  // using keeps TypeScript's meaning (VIP-8), so the scoped directory is acquired in scoped(effect { … }).
  assert.match(skill, /try scoped\(effect \{\n\s+const directory = try fs\.makeTempDirectoryScoped\(\)/)
  // No magic main (VIP-26): the module provides the platform layer and calls its runner.
  assert.match(skill, /NodeRuntime\.runMain\(Effect\.provide\(main\(\), NodeServices\.layer\)\)/)
})

test("the current release discloses static platform limits and the mask-end using leak", () => {
  const notes = read("docs/user/src/setup/release-notes.md").split("## 0.0.11")[1]?.split(/^## /m)[0] ?? ""
  const limits = notes.split("### Known limitations")[1]?.split(/^### /m)[0] ?? ""
  for (const text of ["not a sandbox", "globalThis; g.process.pid", "as any", "Reflect.get", "Intl.DateTimeFormat().format()", "without EK4403"]) {
    assert.ok(limits.includes(text), text)
  }
  for (const path of ["../platform/platform-globals.md#limits-of-static-checks"]) {
    assert.ok(limits.includes(path), path)
  }
  // using is one Effect program for every initializer (D490), so an interruption
  // pending in an initializer's own mask is delivered as that mask ends, as Effect
  // delivers it, and a Disposable made there is lost. The release discloses it with
  // the acquisition that registers the disposal inside the mask.
  assert.ok(limits.includes("Effect.uninterruptible(() => open())"), "mask-end using leak not disclosed")
  assert.ok(limits.includes("Effect.acquireDisposable(() => open())"), "mask-end using leak has no repair")
  assert.match(read("docs/user/src/platform/platform-globals.md"), /## Limits of static checks/)
})

test("platform installation follows the canonical exact-version setup", () => {
  const page = read("docs/user/src/platform/105-introduction.md")
  const installs = page.split("## Installing runtime-specific packages")[1]?.split(/^## /m)[0] ?? ""
  assert.ok(installs.includes("../setup/existing-project.md#2-install-the-packages"))
  assert.ok(installs.includes('"@effect/platform-node-shared": "4.1.0"'))
  for (const platform of ["node", "bun", "browser"]) assert.ok(installs.includes(`@effect/platform-${platform}@4.1.0`))
  assert.doesNotMatch(installs, /(?:npm install|bun add|deno add).*@effect\/platform-(?:node|bun|browser)(?!@)[\s\n]/)
})

test("the upgrade table names every DOM type that loses its bare name", () => {
  const notes = read("docs/user/src/setup/release-notes.md")
  const row = notes.split("\n").find(line => line.startsWith("| A DOM type named")) ?? ""
  for (const name of ["Cache", "Console", "FileSystem", "Scheduler", "Transferable", "Worker"]) {
    assert.ok(row.includes("`" + name + "`"), name)
  }
  // Effect 4.1 has no Crypto module, so the DOM's Crypto keeps its name.
  assert.ok(!row.includes("`Crypto`"), "Crypto")
})

test("public guides explain rules without internal decision identifiers", () => {
  const directory = new URL("docs/user/src/", root)
  for (const name of readdirSync(directory, { recursive: true })) {
    if (!String(name).endsWith(".md") || /(?:114-vibelang-for-effect-users|118-experimental-platform-apis)\.md$/.test(String(name))) continue
    let page = read("docs/user/src/" + name).replace(/<!--[\s\S]*?-->/g, "")
    if (name === "setup/release-notes.md") {
      page = page.split("## 0.0.10")[0].split("\n").filter(line => !line.includes("provisional, pending")).join("\n")
    }
    assert.doesNotMatch(page, /\bD\d+\b/, String(name))
  }
  const script = read("scripts/rename-to-vibelang.mjs")
  assert.doesNotMatch(script, /by any lane|Smithers-Ops vault/)
})

test("existing-project migration explains same-stem output collisions", () => {
  const page = read("docs/user/src/setup/existing-project.md")
  for (const text of ["settings.vibe", "settings.ts", "settings.js", "TS5056", "load-settings.vibe"]) assert.ok(page.includes(text), text)
})

test("first-run readers can find source-located development traces", () => {
  // The starter's README changes with the compiler. The docs follow the spec: VIP-30 decides no
  // tracing option, so the guide names spans with withSpan and links the debugging section.
  const readme = read("templates/app/README.md")
  assert.match(readme, /\bvibelang\.tracing/)
  assert.match(readme, /"vibelang":\s*\{\s*"tracing":\s*"all"/)
  assert.match(readme, /012-devtools(?:\.md)?#debug-stack-traces/)
  assert.match(readme, /rebuild or restart/)
  const guide = read("docs/user/src/013-getting-started.md")
  assert.doesNotMatch(guide, /\bvibe\.tracing/)
  assert.match(guide, /withSpan/)
  assert.match(guide, /012-devtools(?:\.md)?#debug-stack-traces/)
  assert.notEqual(JSON.parse(read("templates/app/tsconfig.json")).vibelang?.tracing, "all", "tracing stays opt-in")
})
