#!/usr/bin/env node
// Current-release references come from the compiler manifest; release notes
// and historical compiler-gap notes retain the versions they describe.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const semver = String.raw`\d+\.\d+\.\d+(?:-[\w.-]+)?`
const historical = /(?:^|\/)(?:release-notes|compiler-gaps)\.(?:md|mdx)$/

export function renderReleasePage(path, text, version, effect) {
  if (historical.test(path)) return text
  let output = text
    .replace(new RegExp(String.raw`\b(vibelang(?:-[a-z0-9-]+)?@)` + semver, "g"), (_, prefix) => prefix + version)
    .replace(new RegExp(String.raw`\b((?:VibeLang|vibelang|[Vv]ersion|Rehearsed for|In) )` + semver, "g"), (_, prefix) => prefix + version)
    .replace(new RegExp('(vibelang@' + semver + ' version\\x60? and expect \\x60)' + semver + '(\\x60)', "g"), (_, prefix, suffix) => prefix + version + suffix)
  if (path === "site/src/pages/index.mdx") {
    output = output.replace(new RegExp("(<strong>)" + semver + "(</strong>)", "g"), (_, prefix, suffix) => prefix + version + suffix)
  }
  if (effect) output = output.replace(new RegExp('("@effect/platform-node-shared": ")' + semver + '(")', "g"), (_, prefix, suffix) => prefix + effect + suffix)
  if (effect) {
    // These boxes are generated from packages/runtime/package.json, alongside
    // release pins. Keep the version out of the hand-written copy.
    const code = value => String.fromCharCode(96) + value + String.fromCharCode(96)
    const compatibility = [
      "**Compatibility.** Use exactly " + code("effect@" + effect) + "; keep " + code("@effect/platform-node") + " and " + code("@effect/vitest") + " at " + code(effect) + " when used.",
      "Existing projects need an " + code("@effect/platform-node-shared") + " override. The starter includes the pins and override.",
      "Use " + code("vibelang") + " to check " + code(".vibe") + " source. Stock " + code("tsc") + " and " + code("vue-tsc") + " see only the " + code("x.d.vibe.ts") + " declarations the compiler writes, which resolve " + code(".vibe") + " imports when " + code("allowArbitraryExtensions") + " is on.",
      "For mixed editing in VS Code, let the VibeLang server own TypeScript files: disable the built-in TypeScript and JavaScript Language Features extension for this workspace.",
    ]
    const install = path === "site/src/pages/index.mdx"
      ? "[Setup details](/setup/existing-project) · [Editor setup](/getting-started/012-devtools)"
      : "[Setup details](https://vibelang.sh/setup/existing-project) · [Editor setup](https://vibelang.sh/getting-started/012-devtools)"
    output = output.replace(/(<!-- compatibility:start -->)[\s\S]*?(<!-- compatibility:end -->)/,
      (_, begin, end) => begin + "\n" + [...compatibility, install].map(line => "> " + line).join("\n>\n") + "\n" + end)
    output = output.replace(/(\{\/\* compatibility:start \*\/\})[\s\S]*?(\{\/\* compatibility:end \*\/\})/,
      (_, begin, end) => begin + "\n\n" + [...compatibility, install].map(line => "> " + line).join("\n>\n") + "\n\n" + end)
    if (path === "packages/compiler/README.md") output = output.replace(/effect@\d+\.\d+\.\d+/g, "effect@" + effect)
  }
  return output
}

export function releasePaths(repository) {
  const walk = path => !existsSync(path) ? [] : readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const file = join(path, entry.name)
    return entry.isDirectory() ? (["site", "node_modules", "notes"].includes(entry.name) ? [] : walk(file))
      : /\.(?:md|mdx)$/.test(entry.name) ? [file] : []
  })
  const packages = join(repository, "packages")
  return [...new Set([
    ...["docs/user", "docs/design/src", "site/src/pages"].flatMap(path => walk(join(repository, path))),
    ...["README.md", ".smithers/instructions/app.md"].map(path => join(repository, path)),
    ...(existsSync(packages) ? readdirSync(packages).map(name => join(packages, name, "README.md")) : [])
  ])].filter(existsSync).map(path => relative(repository, path).replaceAll("\\", "/")).sort()
}

export function releaseDocsProblems(repository = root, write = false) {
  const version = JSON.parse(readFileSync(join(repository, "packages/compiler/package.json"), "utf8")).version
  if (!new RegExp("^" + semver + "$").test(version)) throw new Error("Invalid compiler version: " + version)
  const runtime = join(repository, "packages/runtime/package.json")
  const effect = existsSync(runtime) ? JSON.parse(readFileSync(runtime, "utf8")).peerDependencies?.effect : undefined
  const problems = []
  const examples = join(repository, "examples")
  if (existsSync(examples)) for (const entry of readdirSync(examples, { withFileTypes: true })) {
    const file = join(examples, entry.name, "package.json")
    if (!entry.isDirectory() || !existsSync(file)) continue
    const manifest = JSON.parse(readFileSync(file, "utf8"))
    let changed = false
    for (const section of ["dependencies", "devDependencies"]) {
      for (const name of ["vibelang", "vibelang-runtime", "vibelang-vite"]) {
        if (manifest[section]?.[name] && manifest[section][name] !== version) {
          manifest[section][name] = version
          changed = true
        }
      }
    }
    if (effect && manifest.dependencies?.["@effect/platform-node"] && manifest.overrides?.["@effect/platform-node-shared"] !== effect) {
      manifest.overrides = { ...manifest.overrides, "@effect/platform-node-shared": effect }
      changed = true
    }
    if (changed) {
      if (write) writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n")
      else problems.push(relative(repository, file) + ": example package pins must match the release and Effect manifests")
    }
  }
  for (const path of releasePaths(repository)) {
    const file = join(repository, path)
    const current = readFileSync(file, "utf8")
    const generated = renderReleasePage(path, current, version, effect)
    if (effect && ["docs/user/src/setup/existing-project.md", "docs/user/src/getting-started/004-installation.md"].includes(path) && !generated.includes('"@effect/platform-node-shared": "' + effect + '"')) problems.push(path + ": missing @effect/platform-node-shared override for effect " + effect)
    if (current === generated) continue
    if (write && (!path.startsWith("site/src/pages/") || path === "site/src/pages/index.mdx")) writeFileSync(file, generated)
    else if (!write) problems.push(path + ": stale VibeLang version; expected " + version + " from packages/compiler/package.json")
  }
  return problems
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode] = process.argv.slice(2)
  if (!["--write", "--check"].includes(mode)) {
    console.error("usage: node docs/tools/release-docs.mjs --write | --check")
    process.exitCode = 2
  } else {
    const problems = releaseDocsProblems(root, mode === "--write")
    for (const problem of problems) console.error(problem)
    if (problems.length) {
      console.error("Run (cd .smithers && bun run docs:generate) to regenerate release docs and site copies.")
      process.exitCode = 1
    } else console.log("release-docs: current-release references match the compiler manifest")
  }
}
