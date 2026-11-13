// Local release assembly only: npm pack runs, npm publish never does.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

import { dirname, join } from "node:path"
import { test } from "node:test"

import { fixtureRevision } from "./fixture-checkout.mjs"
import { repo, platformPackage, platforms, json, vsixFiles, checkouts, fixture, assemble, listing, archive, unzipped, buildAndAssemble } from "./make-packages-fixture.mjs"

test("assembles every package in publish order with pinned versions, platform binaries and portable templates", { timeout: 120_000 }, (t) => {
  const root = fixture(t)
  const result = assemble(root)
  assert.equal(result.status, 0, result.stderr)
  const manifest = json(join(root, "dist-npm/tarballs/manifest.json"))
  const names = [...platforms.map((p) => platformPackage(p)), "vibelang", "vibelang-runtime", "vibelang-vite", "create-vibelang", "vibelang-unplugin", "vibelang-typescript"]
  assert.deepEqual(manifest.packages.map((p) => p.name), names)
  for (const pkg of manifest.packages) {
    assert.equal(pkg.version, pkg.name === "vibelang-typescript" ? json(join(repo, "packages/typescript-shim/package.json")).version : manifest.version)
    assert.equal(readFileSync(join(root, "dist-npm/tarballs", pkg.file)).length, pkg.size)
    assert.ok(pkg.files > 0)
    const packed = JSON.parse(archive(root, pkg.name, "package.json"))
    assert.equal(packed.name, pkg.name)
    assert.equal(packed.version, pkg.version)
  }
  for (const platform of platforms) {
    const [os, cpu] = platform.split("-")
    const name = platformPackage(platform)
    const pkg = JSON.parse(archive(root, name, "package.json"))
    assert.deepEqual(pkg.os, [os])
    const compiler = json(join(root, "packages/compiler/package.json"))
    assert.deepEqual([pkg.homepage, pkg.bugs, pkg.repository], [compiler.homepage, compiler.bugs, compiler.repository], `${name} links to the compiler's repository`)
    assert.deepEqual(pkg.cpu, [cpu])
    const exe = os === "win32" ? "vibelang.exe" : "vibelang"
    assert.deepEqual(archive(root, name, `bin/${exe}`), readFileSync(join(root, "dist-npm/bin", platform, exe)))
    const mode = execFileSync("tar", ["-tvzf", join(root, "dist-npm/tarballs", `${name.replace("@", "").replace("/", "-")}-${manifest.version}.tgz`)], { encoding: "utf8" })
    assert.match(mode, /-rwxr-xr-x/)
  }
  for (const path of ["src/options.d.ts", "src/index.d.ts", "src/deferred.d.ts"]) {
    assert.deepEqual(archive(root, "vibelang-unplugin", path), readFileSync(join(repo, "packages/unplugin", path)))
  }
  const compilerPeer = JSON.parse(archive(root, "vibelang", "package.json")).peerDependencies
  assert.equal(compilerPeer?.effect, json(join(root, "packages/runtime/package.json")).peerDependencies.effect,
    "VIP-32: the packed compiler requires the runtime's exact Effect version")
  const plugin = JSON.parse(archive(root, "vibelang", "dprint-plugin.json"))
  assert.equal(plugin.kind, "process")
  assert.equal(plugin.name, "dprint-plugin-vibelang")
  assert.equal(plugin.version, manifest.version)
  const dprintNames = { "darwin-arm64": "darwin-aarch64", "darwin-x64": "darwin-x86_64", "linux-arm64": "linux-aarch64", "linux-x64": "linux-x86_64", "win32-arm64": "windows-aarch64", "win32-x64": "windows-x86_64" }
  for (const platform of platforms) {
    const exe = platform.startsWith("win32") ? "vibelang.exe" : "vibelang"
    const tarball = readFileSync(join(root, "dist-npm/tarballs", `${platformPackage(platform).replace("@", "").replace("/", "-")}-${manifest.version}.tgz`))
    assert.deepEqual(plugin[dprintNames[platform]], {
      reference: `npm:${platformPackage(platform)}@${manifest.version}/bin/${exe}`,
      checksum: createHash("sha256").update(tarball).digest("hex")
    })
  }
  const launcherFiles = execFileSync("tar", ["-tzf", join(root, "dist-npm/tarballs", `vibelang-${manifest.version}.tgz`)], { encoding: "utf8" })
  assert.doesNotMatch(launcherFiles, /package\/native\//)
  assert.deepEqual(unzipped(root, archive(root, "vibelang", "editor/vibelang.vsix")), vsixFiles)
  const app = JSON.parse(archive(root, "create-vibelang", "template/package.json"))
  assert.equal(app.dependencies["vibelang-runtime"], manifest.version)
  assert.equal(app.devDependencies.vibelang, manifest.version)
  assert.equal(app.devDependencies["vibelang-vite"], manifest.version)
  assert.ok(archive(root, "create-vibelang", "template/gitignore").length)
  assert.ok(archive(root, "create-vibelang", "template/gitattributes").length)
  for (const name of ["vibelang", ...platforms.map(p => platformPackage(p))]) {
    const notice = archive(root, name, "NOTICE").toString()
    const own = notice.slice(0, notice.indexOf("NOTICES AND INFORMATION"))
    assert.match(own, /microsoft\/TypeScript/, name + ": name the repository that owns the upstream commit")
    assert.doesNotMatch(own, /typescript-go/, name + ": the upstream commit is from the unified TypeScript repository")
  }
  for (const name of ["vibelang-runtime", "vibelang-vite", "vibelang-unplugin", "create-vibelang"]) {
    const license = archive(root, name, "LICENSE").toString()
    assert.equal(license.split("\n")[0], "MIT License", name + ": LICENSE must start at the MIT heading")
    assert.equal(createHash("sha256").update(license).digest("hex"), "812b2af11bfeb9214e0428f91357a87316996b779e32c58b19319a59af38e1e9", name + ": unchanged standard MIT text")
    assert.doesNotMatch(license, /VibeLang is licensed under/)
  }
})

test("reports inconsistent versions, pins and missing binaries together before replacing release artifacts", (t) => {
  const root = fixture(t)
  const runtimePath = join(root, "packages/runtime/package.json")
  const runtime = json(runtimePath)
  runtime.version = "99.0.0"
  writeFileSync(runtimePath, JSON.stringify(runtime))
  const compilerPath = join(root, "packages/compiler/package.json")
  const compiler = json(compilerPath)
  compiler.optionalDependencies["vibelang-linux-x64"] = "99.0.0"
  delete compiler.optionalDependencies["@smthrs/cli-win32-x64"]
  writeFileSync(compilerPath, JSON.stringify(compiler))
  rmSync(join(root, "dist-npm/bin/darwin-arm64"), { recursive: true })
  mkdirSync(join(root, "dist-npm/tarballs"))
  const previous = join(root, "dist-npm/tarballs/manifest.json")
  writeFileSync(previous, "previous release")
  const result = assemble(root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /vibelang-runtime: version 99\.0\.0/)
  assert.match(result.stderr, /optionalDependencies must list exactly/)
  assert.match(result.stderr, /vibelang-linux-x64 pinned to 99\.0\.0/)
  assert.match(result.stderr, /missing dist-npm\/bin\/darwin-arm64/)
  assert.equal(readFileSync(previous, "utf8"), "previous release")
})

for (const missing of ["editors/vscode/vibelang.vsix", "packages/runtime/dist/index.js"]) {
  test(`--skip-build refuses a missing ${missing} before replacing release artifacts`, (t) => {
    const root = fixture(t)
    rmSync(join(root, missing))
    const result = assemble(root)
    assert.equal(result.status, 1)
    assert.ok(result.stderr.includes(missing), result.stderr)
    assert.match(result.stderr, /run without --skip-build/)
    assert.ok(!existsSync(join(root, "dist-npm/tarballs")))
  })
}

test("refuses stale install docs before replacing release artifacts", (t) => {
  const root = fixture(t)
  const page = join(root, "docs/user/src/setup.md")
  mkdirSync(dirname(page), { recursive: true })
  writeFileSync(page, "Install vibelang@0.0.0")
  const result = assemble(root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /docs\/user\/src\/setup.md: stale VibeLang version/)
  assert.ok(!existsSync(join(root, "dist-npm/tarballs")))
})

test("all release packages and the starter declare the Node 22.22.3 floor", () => {
  for (const path of [...["compiler", "runtime", "vite", "unplugin", "create-vibelang"].map(name => "packages/" + name + "/package.json"), "templates/app/package.json"]) {
    assert.equal(json(join(repo, path)).engines?.node, "^22.22.3 || >=24.11.1", path)
  }
})

for (const name of ["compiler", "runtime", "vite", "unplugin", "create-vibelang"]) {
  test("refuses a drifting Node engine in " + name + " before replacing release artifacts", (t) => {
    const root = fixture(t)
    const path = join(root, "packages", name, "package.json")
    const pkg = json(path)
    pkg.engines = { ...pkg.engines, node: ">=20" }
    writeFileSync(path, JSON.stringify(pkg))
    const result = assemble(root)
    assert.equal(result.status, 1)
    assert.ok(result.stderr.includes("expected ^22.22.3 || >=24.11.1"), result.stderr)
    assert.ok(!existsSync(join(root, "dist-npm/tarballs")))
  })
}

test("package READMEs teach the Node 22.22.3 floor", () => {
  for (const name of ["compiler", "runtime", "vite", "unplugin", "create-vibelang"]) {
    const readme = readFileSync(join(repo, "packages", name, "README.md"), "utf8")
    assert.doesNotMatch(readme, /Node 26 or later/, name)
    assert.match(readme, /Node 22\.22\.3(?:\s|\.)/, name)
  }
})

test("the root license starts with standard MIT text", () => {
  assert.ok(readFileSync(join(repo, "LICENSE"), "utf8").startsWith("MIT License\n"))
})

test("packs only MIT text when the root license is MIT first with trailing exceptions", { timeout: 120_000 }, (t) => {
  const root = fixture(t)
  const source = readFileSync(join(root, "LICENSE"), "utf8")
  const start = source.indexOf("MIT License\n")
  const end = source.indexOf("\nSOFTWARE.", start) + "\nSOFTWARE.".length
  const mit = source.slice(start, end) + "\n"
  writeFileSync(join(root, "LICENSE"), mit + "\nCompiler exceptions: see typescript/LICENSE.txt.\n")
  const result = assemble(root)
  assert.equal(result.status, 0, result.stderr)
  for (const name of ["vibelang-runtime", "vibelang-vite", "vibelang-unplugin", "create-vibelang"]) {
    assert.equal(archive(root, name, "LICENSE").toString(), mit)
  }
})

test("refuses a missing or drifting transitive Effect override before packing", (t) => {
  for (const pin of [undefined, "0.0.0"]) {
    const root = fixture(t)
    const path = join(root, "templates/app/package.json")
    const app = json(path)
    app.overrides = { "@effect/platform-node-shared": pin }
    writeFileSync(path, JSON.stringify(app))
    const result = assemble(root)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /@effect\/platform-node-shared override must match effect/)
    assert.ok(!existsSync(join(root, "dist-npm/tarballs")))
  }
})

// Release integrity: the tarballs must be one commit's files and binaries.
test("the manifest records the revision and that --skip-build tarballs are for rehearsal only", { timeout: 120_000 }, (t) => {
  const root = fixture(t)
  const result = assemble(root)
  assert.equal(result.status, 0, result.stderr)
  const manifest = json(join(root, "dist-npm/tarballs/manifest.json"))
  assert.equal(manifest.revision, fixtureRevision)
  assert.equal(manifest.clean, true)
  assert.deepEqual(manifest.rehearsalOnly, ["--skip-build"])
})

for (const [name, receipt, message] of [
  ["a receipt that records a failed build", "platform=linux-arm64\ncompleted=2026-11-08T05:00:00Z\nexit=1\n", /linux-arm64\.status records exit 1, so .*linux-arm64\/vibelang is from an earlier build/],
  ["a missing receipt", undefined, /no receipt dist-npm\/bin\/linux-arm64\.status/],
]) {
  test(`refuses a binary beside ${name} before replacing release artifacts`, (t) => {
    const root = fixture(t)
    const path = join(root, "dist-npm/bin/linux-arm64.status")
    if (receipt) writeFileSync(path, receipt)
    else rmSync(path)
    for (const flags of [[], ["--rehearsal"]]) {
      const result = assemble(root, ...flags)
      assert.equal(result.status, 1, result.stdout)
      assert.match(result.stderr, message)
      assert.ok(!existsSync(join(root, "dist-npm/tarballs")))
    }
  })
}

test("refuses binaries built from another revision than the checkout's", { timeout: 120_000 }, (t) => {
  const root = fixture(t)
  const next = "9c".repeat(20)
  checkouts.get(root).set({ revision: next })
  const result = assemble(root)
  assert.equal(result.status, 1, result.stdout)
  assert.ok(result.stderr.includes(`the binaries were built from revision ${fixtureRevision}, but this checkout is ${next}`), result.stderr)
  assert.ok(!existsSync(join(root, "dist-npm/tarballs")))
  const rehearsed = assemble(root, "--rehearsal")
  assert.equal(rehearsed.status, 0, rehearsed.stderr)
  assert.deepEqual(json(join(root, "dist-npm/tarballs/manifest.json")).rehearsalOnly, ["--skip-build", "--rehearsal"])
})

test("refuses a binary that does not carry the recorded revision, a missing record and a build from a changed tree", (t) => {
  const root = fixture(t)
  writeFileSync(join(root, "dist-npm/bin/win32-x64/vibelang.exe"), "an earlier build")
  const stale = assemble(root, "--rehearsal")
  assert.equal(stale.status, 1, stale.stdout)
  assert.match(stale.stderr, new RegExp("win32-x64/vibelang\\.exe does not carry revision " + fixtureRevision))
  writeFileSync(join(root, "dist-npm/bin/revision"), `revision=${fixtureRevision}\nclean=false\n`)
  assert.match(assemble(root).stderr, /binaries were built from a tree with uncommitted changes/)
  rmSync(join(root, "dist-npm/bin/revision"))
  const unrecorded = assemble(root, "--rehearsal")
  assert.equal(unrecorded.status, 1, unrecorded.stdout)
  assert.match(unrecorded.stderr, /no dist-npm\/bin\/revision/)
  assert.ok(!existsSync(join(root, "dist-npm/tarballs")))
})

test("refuses a tree with uncommitted changes, and a tree that is no checkout", { timeout: 120_000 }, (t) => {
  const root = fixture(t, { clean: false })
  const result = assemble(root)
  assert.equal(result.status, 1, result.stdout)
  assert.match(result.stderr, /the tree has changes that are not in a commit/)
  assert.ok(!existsSync(join(root, "dist-npm/tarballs")))
  const rehearsed = assemble(root, "--rehearsal")
  assert.equal(rehearsed.status, 0, rehearsed.stderr)
  assert.equal(json(join(root, "dist-npm/tarballs/manifest.json")).clean, false)
  rmSync(join(root, ".jj"), { recursive: true })
  rmSync(join(root, "dist-npm/tarballs"), { recursive: true })
  const bare = assemble(root, "--rehearsal")
  assert.equal(bare.status, 1, bare.stdout)
  assert.match(bare.stderr, /not a jj or git checkout/)
  assert.ok(!existsSync(join(root, "dist-npm/tarballs")))
})

test("every tracked file under a staged directory is packed", { timeout: 120_000 }, (t) => {
  const root = fixture(t)
  const result = assemble(root)
  assert.equal(result.status, 0, result.stderr)
  const tracked = execFileSync("jj", ["file", "list"], { cwd: root, encoding: "utf8", env: { ...process.env, PATH: checkouts.get(root).bin + ":" + process.env.PATH } }).split("\n")
  for (const [from, name, to] of [["packages/vite/src/", "vibelang-vite", "package/src/"], ["packages/unplugin/src/", "vibelang-unplugin", "package/src/"],
    ["packages/typescript-shim/lib/", "vibelang-typescript", "package/lib/"], ["packages/compiler/bin/", "vibelang", "package/bin/"]]) {
    const expected = tracked.filter((file) => file.startsWith(from)).map((file) => to + file.slice(from.length)).sort()
    assert.ok(expected.length > 0, from)
    assert.deepEqual(listing(root, name).filter((file) => file.startsWith(to)).sort(), expected, name)
  }
})

test("normal assembly removes outputs of deleted runtime sources and rebuilds the extension", { timeout: 120_000 }, t => {
  const root = fixture(t)
  for (const file of ["deleted.js", "kernel/deleted.d.ts"]) writeFileSync(join(root, "packages/runtime/dist", file), "stale output")
  const result = buildAndAssemble(root)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(listing(root, "vibelang-runtime").filter(file => file.includes("deleted")), [])
  assert.equal(archive(root, "vibelang-runtime", "dist/index.js").toString(), "fresh index.js")
  assert.deepEqual(unzipped(root, archive(root, "vibelang", "editor/vibelang.vsix")), {
    ...vsixFiles, "extension/readme.md": "# Fresh build\n"
  })
  const manifest = json(join(root, "dist-npm/tarballs/manifest.json"))
  assert.equal(manifest.revision, fixtureRevision)
  assert.equal(manifest.clean, true)
  assert.equal(manifest.rehearsalOnly, undefined)
})

for (const [phase, output] of [
  ["runtime", "packages/runtime/dist"],
  ["extension", "editors/vscode/vibelang.vsix"]
]) {
  test(`a failed ${phase} build removes its previous output before packing`, t => {
    const root = fixture(t)
    assert.ok(existsSync(join(root, output)))
    const result = buildAndAssemble(root, phase)
    assert.equal(result.status, 1, result.stderr)
    assert.equal(existsSync(join(root, output)), false, "the failed build must not leave stale output")
    assert.equal(existsSync(join(root, "dist-npm/tarballs/manifest.json")), false)
  })
}

test("packed release files contain no hosting product prose or reviewer provenance, including embedded sources", { timeout: 120_000 }, t => {
  const root = fixture(t)
  cpSync(join(repo, "packages/runtime/dist"), join(root, "packages/runtime/dist"), { recursive: true })
  const result = assemble(root)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})

test("release assembly rejects leaks in declarations, maps, plugins, compiler docs and the held-back shim", { timeout: 120_000 }, t => {
  const root = fixture(t)
  const leaks = ["packages/runtime/dist/index.d.ts", "packages/vite/src/index.js",
    "packages/compiler/README.md", "packages/compiler/skills/vibelang/SKILL.md",
    "packages/typescript-shim/README.md", "templates/app/AGENTS.md"]
  for (const path of leaks) writeFileSync(join(root, path), readFileSync(join(root, path), "utf8") + "\n// Smithers leak\n")
  writeFileSync(join(root, "packages/runtime/dist/index.js.map"),
    JSON.stringify({ version: 3, sources: ["source.ts"], sourcesContent: ["// SMITHERS leak"] }))
  const result = assemble(root)
  assert.equal(result.status, 1)
  for (const path of ["dist/index.d.ts", "dist/index.js.map", "src/index.js",
    "package/README.md", "skills/vibelang/SKILL.md", "template/AGENTS.md"]) {
    assert.ok(result.stderr.includes(path), result.stderr)
  }
  assert.match(result.stderr, /vibelang-typescript: package\/README.md/)
  assert.match(result.stderr, /sourcesContent\[0\]/)
})

test("release assembly rejects reviewer provenance in shipped source, declarations and maps", { timeout: 120_000 }, t => {
  const root = fixture(t)
  for (const path of ["packages/runtime/dist/index.d.ts", "packages/vite/src/index.js",
    "packages/compiler/README.md", "packages/compiler/skills/vibelang/SKILL.md",
    "packages/typescript-shim/README.md", "templates/app/AGENTS.md"]) {
    writeFileSync(join(root, path), readFileSync(join(root, path), "utf8") + "\n// Fable finding 1\n")
  }
  writeFileSync(join(root, "packages/runtime/dist/index.js.map"),
    JSON.stringify({ version: 3, sources: ["source.ts"], sourcesContent: ["// Codex review R5"] }))
  const result = assemble(root)
  assert.equal(result.status, 1)
  for (const path of ["dist/index.d.ts", "dist/index.js.map", "src/index.js",
    "package/README.md", "skills/vibelang/SKILL.md", "template/AGENTS.md"]) {
    assert.ok(result.stderr.includes(path), result.stderr)
  }
  assert.match(result.stderr, /vibelang-typescript: package\/README.md/)
  assert.match(result.stderr, /sourcesContent\[0\]/)
  assert.match(result.stderr, /\[reviewer provenance\]/)
})
