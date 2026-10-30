import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { releaseDocsProblems, renderReleasePage } from "./release-docs.mjs"


// Release headings may lead package versions only for the next unreleased section.
function assertReleaseHistory(notes, version) {
  const [current, previous] = notes.split(/^## /m).slice(1)
  assert.ok(current && previous, "release notes need current and previous sections")
  const heading = /^(\d+\.\d+\.\d+(?:-[\w.-]+)?)( \(unreleased\))?$/.exec(current.split("\n")[0])
  assert.ok(heading, "top release must name a version, optionally marked (unreleased)")
  const previousVersion = previous.split("\n")[0]
  assert.match(previousVersion, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, "the section below must be a published version")
  if (heading[2]) {
    assert.equal(previousVersion, version, "an unreleased section follows the compiler's published version")
    const next = heading[1].split(/[.-]/).slice(0, 3).map(Number)
    const published = version.split(/[.-]/).slice(0, 3).map(Number)
    const difference = next.map((part, i) => part - published[i]).find(part => part !== 0)
    assert.ok(difference > 0, "the unreleased version must be newer than the published version")
  } else {
    assert.equal(heading[1], version, "a published top section matches the compiler version")
  }
  assert.ok(current.split("\n").includes("### Bugs fixed since " + previousVersion),
    "top release must have ### Bugs fixed since " + previousVersion)
}

test("the top release names the previous published version in its bug heading", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url))
  const version = JSON.parse(readFileSync(join(root, "packages/compiler/package.json"), "utf8")).version
  assertReleaseHistory(readFileSync(join(root, "docs/user/src/setup/release-notes.md"), "utf8"), version)
})

test("release history accepts the published and next unreleased states", () => {
  assertReleaseHistory("## 9.8.7\n### Bugs fixed since 9.8.6\n## 9.8.6\n", "9.8.7")
  assertReleaseHistory("## 9.8.8 (unreleased)\n### Bugs fixed since 9.8.7\n## 9.8.7\n", "9.8.7")
})

test("release history rejects missing or stale bug headings and mismatched versions", () => {
  for (const notes of [
    "## 9.8.7\n## 9.8.6\n",
    "## 9.8.7\n### Bugs fixed since 9.8.5\n## 9.8.6\n",
    "## 9.8.8\n### Bugs fixed since 9.8.7\n## 9.8.7\n",
    "## 9.8.8 (unreleased)\n### Bugs fixed since 9.8.6\n## 9.8.6\n",
    "## 9.8.7 (unreleased)\n### Bugs fixed since 9.8.7\n## 9.8.7\n",
    "## 9.8.6 (unreleased)\n### Bugs fixed since 9.8.7\n## 9.8.7\n",
    "## 9.8.7\n### Bugs fixed since 9.8.6\n## 9.8.6 (unreleased)\n",
    "## 9.8.7\n### Bugs fixed since 9.8.6\n"
  ]) assert.throws(() => assertReleaseHistory(notes, "9.8.7"))
})

test("an unreleased section keeps install pins and version-derived text on the compiler version", () => {
  const repo = mkdtempSync(join(tmpdir(), "unreleased-docs-"))
  const put = (path, text) => {
    const file = join(repo, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  try {
    put("packages/compiler/package.json", JSON.stringify({ version: "9.8.7" }))
    put("docs/user/src/setup/release-notes.md", "## 9.8.8 (unreleased)\n### Bugs fixed since 9.8.7\n## 9.8.7\n")
    put("README.md", "VibeLang 9.8.6; vibelang@9.8.6; vibelang-runtime@9.8.6")
    put("examples/app/package.json", JSON.stringify({ devDependencies: { vibelang: "9.8.6" } }))
    releaseDocsProblems(repo, true)
    const notes = readFileSync(join(repo, "docs/user/src/setup/release-notes.md"), "utf8")
    assertReleaseHistory(notes, "9.8.7")
    assert.match(notes, /^## 9\.8\.8 \(unreleased\)/)
    assert.equal(readFileSync(join(repo, "README.md"), "utf8"), "VibeLang 9.8.7; vibelang@9.8.7; vibelang-runtime@9.8.7")
    assert.equal(JSON.parse(readFileSync(join(repo, "examples/app/package.json"), "utf8")).devDependencies.vibelang, "9.8.7")
    assert.deepEqual(releaseDocsProblems(repo), [])
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test("contribution rules require each fix's changelog and affected docs in the same commit", () => {
  for (const path of ["../../CONTRIBUTING.md", "../../.smithers/flows/docs/project.ts"]) {
    const text = readFileSync(new URL(path, import.meta.url), "utf8")
    assert.match(text, /Every fix commit must add one line to the top release-notes section.s/)
    assert.match(text, /Bugs fixed since <last published version>/)
    assert.match(text, /update every doc page its change affects, in the same commit/)
  }
})

test("install pins, compiler output, prose and homepage badges derive from the compiler version", () => {
  const text = "Version 0.0.2; VibeLang 0.0.3; vibelang 0.0.1; In 0.0.2; Rehearsed for 0.0.2\n" +
    "vibelang@0.0.2 vibelang-runtime@0.0.2 vibelang-vite@0.0.2 vibelang-unplugin@0.0.2\n" +
    "Run npm view vibelang@0.0.2 version and expect \x600.0.2\x60.\n<strong>0.0.1</strong>"
  const next = renderReleasePage("site/src/pages/index.mdx", text, "9.8.7")
  assert.doesNotMatch(next, /0\.0\.[123]/)
  assert.equal(renderReleasePage("page.md", next, "9.8.7"), next)
})

test("a toolchain version the docs expect keeps its value", () => {
  const text = "Run \x60node --version\x60 and expect \x60v26.0.0\x60 or later. With Bun, run \x60bun --version\x60 and expect \x601.4.0\x60 or later.\n" +
    "Run \x60npm view vibelang@0.0.2 version\x60 and expect \x600.0.2\x60."
  assert.equal(renderReleasePage("docs/user/src/setup.md", text, "9.8.7"),
    "Run \x60node --version\x60 and expect \x60v26.0.0\x60 or later. With Bun, run \x60bun --version\x60 and expect \x601.4.0\x60 or later.\n" +
    "Run \x60npm view vibelang@9.8.7 version\x60 and expect \x609.8.7\x60.")
})

test("historical release notes and ordinary addresses keep their original values", () => {
  const text = "Version 0.0.2; vibelang@0.0.2"
  assert.equal(renderReleasePage("docs/user/src/setup/release-notes.md", text, "9.8.7"), text)
  assert.equal(renderReleasePage("site/src/pages/setup/release-notes.mdx", text, "9.8.7"), text)
  assert.equal(renderReleasePage("page.md", 'fetch("http://127.0.0.1:8080") effect@4.0.5', "9.8.7"),
    'fetch("http://127.0.0.1:8080") effect@4.0.5')
})

test("the docs gate rejects stale source and deployed copies after a version bump", () => {
  const repo = mkdtempSync(join(tmpdir(), "release-docs-"))
  const put = (path, text) => { const file = join(repo, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
  try {
    put("packages/compiler/package.json", JSON.stringify({ version: "9.8.7" }))
    put("docs/user/src/setup.md", "VibeLang 0.0.2; vibelang@0.0.2")
    put("docs/user/notes/review.md", "Version 0.0.1; vibelang@0.0.1")
    put("site/src/pages/setup.mdx", "VibeLang 0.0.2; vibelang@0.0.2")
    assert.equal(releaseDocsProblems(repo).length, 2)
    releaseDocsProblems(repo, true)
    assert.equal(readFileSync(join(repo, "docs/user/src/setup.md"), "utf8"), "VibeLang 9.8.7; vibelang@9.8.7")
    assert.equal(releaseDocsProblems(repo).length, 1)
    put("site/src/pages/setup.mdx", "VibeLang 9.8.7; vibelang@9.8.7")
    assert.deepEqual(releaseDocsProblems(repo), [])
    put("packages/compiler/package.json", JSON.stringify({ version: "9.8.8" }))
    assert.equal(releaseDocsProblems(repo).length, 2)
  } finally { rmSync(repo, { recursive: true, force: true }) }
})

test("all current repository release references match the compiler manifest", () => {
  assert.deepEqual(releaseDocsProblems(fileURLToPath(new URL("../../", import.meta.url))), [])
})

test("install docs describe published platforms; the next launcher supports scoped Windows packages", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url))
  for (const path of ["docs/user/src/getting-started/004-installation.md", "docs/user/src/setup.md",
    "docs/design/history/src/428-part4-ch28-tooling.md", ".smithers/instructions/app.md", "packages/compiler/README.md"]) {
    const text = readFileSync(join(root, path), "utf8")
    assert.match(text, /Windows.*not (?:available|published).*WSL/s, path)
    assert.doesNotMatch(text, /\| Windows on .*vibelang-win32/, path)
    assert.doesNotMatch(text, /ships all six|one of six/, path)
  }
  const launcher = readFileSync(join(root, "packages/compiler/bin/vibelang"), "utf8")
  assert.match(launcher, /const platforms = .*win32-arm64.*win32-x64/)
  assert.match(launcher, /@vibelang\/cli-/)
})

test("the starter and existing-project instructions pin the transitive Effect peer", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url))
  const effect = JSON.parse(readFileSync(join(root, "packages/runtime/package.json"), "utf8")).peerDependencies.effect
  const app = JSON.parse(readFileSync(join(root, "templates/app/package.json"), "utf8"))
  assert.equal(app.overrides?.["@effect/platform-node-shared"], effect)
  for (const page of ["docs/user/src/setup/existing-project.md", "docs/user/src/getting-started/004-installation.md"]) {
    assert.ok(readFileSync(join(root, page), "utf8").includes('"@effect/platform-node-shared": "' + effect + '"'), page)
  }
  assert.equal(renderReleasePage("page.md", '{"overrides":{"@effect/platform-node-shared": "4.0.6"}}', "9.8.7", effect),
    '{"overrides":{"@effect/platform-node-shared": "' + effect + '"}}')
})

test("example installs use published pins and the release gate updates them", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url))
  const repo = mkdtempSync(join(tmpdir(), "example-release-"))
  const put = (path, value) => { mkdirSync(dirname(join(repo, path)), {recursive:true}); writeFileSync(join(repo, path), JSON.stringify(value)) }
  try {
    put("packages/compiler/package.json", { version:"9.8.7" })
    put("packages/runtime/package.json", { peerDependencies:{effect:"4.0.5"} })
    put("examples/hello/package.json", {dependencies:{effect:"4.0.5","@effect/platform-node":"4.0.5","vibelang-runtime":"file:../../packages/runtime/vibelang-runtime.tgz"},devDependencies:{vibelang:"0.0.1","vibelang-vite":"0.0.2"}})
    assert.match(releaseDocsProblems(repo).join("\n"), /example package pins/)
    releaseDocsProblems(repo, true)
    const app = JSON.parse(readFileSync(join(repo,"examples/hello/package.json"),"utf8"))
    assert.equal(app.dependencies["vibelang-runtime"],"9.8.7")
    assert.equal(app.devDependencies.vibelang,"9.8.7")
    assert.equal(app.devDependencies["vibelang-vite"],"9.8.7")
    assert.equal(app.overrides["@effect/platform-node-shared"],"4.0.5")
    assert.deepEqual(releaseDocsProblems(repo),[])
    assert.deepEqual(releaseDocsProblems(root),[])
  } finally { rmSync(repo,{recursive:true,force:true}) }
})

test("starter prerequisites make Bun conditional on the chosen package manager", () => {
  const root = fileURLToPath(new URL("../../",import.meta.url))
  for (const path of ["README.md","docs/user/src/getting-started/004-installation.md"]) {
    const text = readFileSync(join(root,path),"utf8")
    assert.match(text,/Node 22\.22\.3 \(22\.x\) or Node 24\.11\.1 or later\. If you use Bun, use Bun 1\.4 or later\./,path)
  }
})

test("installation documents the pinned Effect version and adopted defect precedence", () => {
  const root = fileURLToPath(new URL("../../",import.meta.url))
  for (const path of ["docs/user/src/getting-started/004-installation.md","docs/user/src/setup/existing-project.md"]) {
    const text = readFileSync(join(root,path),"utf8")
    assert.match(text,/depends on Effect internals and checks the exact version at load/,path)
    assert.match(text,/VibeLang follows Effect 4\.0\.6.s defect precedence/,path)
    assert.match(text,/a failure whose cleanup crashes is a defect/,path)
    assert.doesNotMatch(text,/failure rules do not accept yet|must use 4\.0\.5 for now/,path)
  }
})

test("compatibility boxes and package install pins follow the runtime manifest", () => {
  const markdown = "<!-- compatibility:start -->old<!-- compatibility:end -->"
  const mdx = "{/* compatibility:start */}old{/* compatibility:end */}"
  for (const [path, text] of [["README.md", markdown], ["site/src/pages/index.mdx", mdx]]) {
    const output = renderReleasePage(path, text, "9.8.7", "4.9.1")
    assert.ok(output.includes("effect@4.9.1"))
    assert.ok(output.includes("@effect/vitest"))
    assert.ok(output.includes("vue-tsc"))
    assert.ok(output.includes("TypeScript files"))
    assert.equal(renderReleasePage(path, output, "9.8.7", "4.9.1"), output)
  }
  assert.equal(renderReleasePage("packages/compiler/README.md", "effect@4.0.5", "9.8.7", "4.9.1"), "effect@4.9.1")
})

test("the 0.0.10 release owns the Effect 4.0.6 migration and upgrade instructions", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url))
  const version = "0.0.10"
  // 0.0.10 pinned effect 4.0.6; its section keeps that version after later pins move.
  const effect = "4.0.6"
  const notes = readFileSync(join(root, "docs/user/src/setup/release-notes.md"), "utf8")
  const releases = notes.split(/^## /m).slice(1)
  const current = releases.find((release) => release.split("\n")[0] === version)
  assert.ok(current, "release notes have a section for " + version)
  for (const text of [
    "### Effect " + effect + " and failures",
    "effect@" + effect,
    "Die(Busy)", "Interrupt + Fail(CleanupFailed)", 'returns \x60"recovered"\x60',
    "npm install --save-exact", "bun add --exact",
    "@effect/platform-node-shared", "npm test", "bun run test"
  ]) assert.ok(current.includes(text), text + " belongs in " + version)
})

test("the 0.0.11 release retains its upgrade instructions", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url))
  const version = "0.0.11"
  const notes = readFileSync(join(root, "docs/user/src/setup/release-notes.md"), "utf8")
  const current = notes.split(/^## /m).slice(1).find(release => release.split("\n")[0] === version)
  assert.ok(current, "release notes retain " + version)
  for (const heading of ["Upgrade from 0.0.10", "Bugs fixed since 0.0.10", "Known limitations"]) {
    assert.ok(current.includes("### " + heading), heading)
  }
  for (const text of ["EK4801", "EK1010", "EK2118", "EK4408", "EK4402", "await",
    "provisional", "platform-globals.md", "vibelang/platform/node", "--fix",
    "npm install --save-exact", "bun add --exact", "vibelang-runtime@" + version,
    "Experimental.FileSystem", "Experimental.Crypto", "Experimental.Process", "Experimental.Locks"]) {
    assert.ok(current.includes(text), text)
  }
})

test("the 0.0.11 bug list covers the receiver report and service-alias diagnostic", () => {
  const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
  const current = notes.split(/^## /m).slice(1).find(release => release.split("\n")[0] === "0.0.11")
  assert.ok(current, "release notes retain 0.0.11")
  const bugs = current.split("### Bugs fixed since 0.0.10\n")[1]?.split(/^### /m)[0]
  assert.ok(bugs, "0.0.11 needs a bug list for testers")
  for (const heading of ["Compiler and diagnostics", "Runtime", "Editor and language server", "Tooling and bundlers", "Docs"]) {
    assert.ok(bugs.includes("#### " + heading), heading)
  }
  assert.match(bugs, /forwards the receiver \(reported by Vladimir Kalnitsky\)/)
  assert.match(bugs, /const fs = FileSystem; fs.writeFileString/)
  assert.match(bugs, /\[Upgrade from 0.0.10\]\(#upgrade-from-0010\)/)
  assert.doesNotMatch(bugs, /\bD\d{2,}\b|alpha-chlog|bug bash/)
})

// Development commits record every fix. Enforce the curated publication list at release time.
// VIBELANG_RELEASE_NOTES_FINAL=1 node --test docs/tools/release-docs.test.mjs
test("current release notes describe user fixes without internal CI or fuzz bookkeeping", {
  skip: !process.env.VIBELANG_RELEASE_NOTES_FINAL
}, () => {
  const notes = readFileSync(new URL("../user/src/setup/release-notes.md", import.meta.url), "utf8")
  const current = notes.split(/^## /m).slice(1)[0]
  const bugs = current.split(/^### Bugs fixed since .+$/m)[1]?.split(/^### /m)[0]
  assert.ok(bugs, "current release needs a bug list")
  assert.doesNotMatch(bugs, /\bfuzz\b|go-vibelangfuzz|pre-merge|post-merge|grammar test engine|editor syntax property tests|test cache/i)
  assert.doesNotMatch(bugs, /regression checks|migration checks|diagnostic golden|fixtures now verify|grammar tooling now sees/i)
  const bullets = bugs.split("\n").filter(line => line.startsWith("- "))
  assert.equal(new Set(bullets).size, bullets.length, "each user-facing fix appears once")
})
