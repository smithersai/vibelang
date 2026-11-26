import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { assertInstalledCompiler, verifyInstalledCompiler } from "../lib/toolchain.mjs"

const put = (root, file, text) => {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  return path
}
const sha256 = text => createHash("sha256").update(text).digest("hex")

test("#167: verifyInstalledCompiler accepts a complete restored install with matching staged native binary", () => {
  const root = mkdtempSync(join(tmpdir(), "installed-compiler-ok-"))
  try {
    const target = join(root, "repo")
    const staged = join(root, "toolchain")
    const nativeBytes = "#!/bin/sh\necho 0.0.14\n"
    const digest = sha256(nativeBytes)
    const stagedBin = put(staged, "native/vibelang", nativeBytes)
    chmodSync(stagedBin, 0o755)
    put(staged, "toolchain.json", JSON.stringify({
      version: "0.0.14",
      commit: "abc123456789",
      compiler: "native/vibelang",
      nativeSha256: digest
    }))

    put(target, "package.json", JSON.stringify({ name: "root", private: true, devDependencies: { vibelang: "file:.vibelang-toolchain/vibelang.tgz" } }))
    put(target, "node_modules/vibelang/package.json", JSON.stringify({ name: "vibelang", version: "0.0.14" }))
    const installedBin = put(target, "node_modules/vibelang/native/vibelang", nativeBytes)
    chmodSync(installedBin, 0o755)

    const receipt = verifyInstalledCompiler({
      target,
      packages: [{ dir: "." }],
      toolchain: { kind: "staged", dir: staged }
    })
    assert.equal(receipt.ok, true, JSON.stringify(receipt))
    assert.deepEqual(receipt.missing, [])
    assert.equal(receipt.checked.length, 1)
    assert.equal(receipt.checked[0].nativeSha256, digest)
    assert.equal(receipt.checked[0].version, "0.0.14")
    assert.doesNotThrow(() => assertInstalledCompiler({
      target,
      packages: [{ dir: "." }],
      toolchain: { kind: "staged", dir: staged }
    }))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#167: verifyInstalledCompiler rejects a restored cache missing the native compiler binary", () => {
  const root = mkdtempSync(join(tmpdir(), "installed-compiler-missing-"))
  try {
    const target = join(root, "repo")
    put(target, "packages/sdk/package.json", JSON.stringify({ name: "@app/sdk", devDependencies: { vibelang: "0.0.14" } }))
    // Restored cache has vibelang package.json and launcher, but omits native/vibelang and platform optional dep.
    put(target, "packages/sdk/node_modules/vibelang/package.json", JSON.stringify({ name: "vibelang", version: "0.0.14" }))

    const receipt = verifyInstalledCompiler({
      target,
      packages: [{ dir: "packages/sdk" }],
      toolchain: { kind: "npm", version: "0.0.14" }
    })
    assert.equal(receipt.ok, false, JSON.stringify(receipt))
    assert.equal(receipt.missing.length, 1)
    assert.equal(receipt.missing[0].package, "packages/sdk")
    assert.match(receipt.missing[0].reason, /native compiler binary/)
    assert.throws(
      () => assertInstalledCompiler({ target, packages: [{ dir: "packages/sdk" }], toolchain: { kind: "npm", version: "0.0.14" } }),
      /dependency cache integrity.*packages\/sdk/i
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#167: verifyInstalledCompiler rejects a stale cached binary whose sha256 differs from the staged toolchain", () => {
  const root = mkdtempSync(join(tmpdir(), "installed-compiler-stale-"))
  try {
    const target = join(root, "repo")
    const staged = join(root, "toolchain")
    const freshBytes = "#!/bin/sh\necho fresh\n"
    const staleBytes = "#!/bin/sh\necho stale\n"
    const stagedBin = put(staged, "native/vibelang", freshBytes)
    chmodSync(stagedBin, 0o755)
    put(staged, "toolchain.json", JSON.stringify({
      version: "0.0.14",
      commit: "fresh1234567",
      compiler: "native/vibelang",
      nativeSha256: sha256(freshBytes)
    }))

    put(target, "package.json", JSON.stringify({ name: "root", private: true, devDependencies: { vibelang: "file:.vibelang-toolchain/vibelang.tgz" } }))
    put(target, "node_modules/vibelang/package.json", JSON.stringify({ name: "vibelang", version: "0.0.14" }))
    const installedBin = put(target, "node_modules/vibelang/native/vibelang", staleBytes)
    chmodSync(installedBin, 0o755)

    const receipt = verifyInstalledCompiler({
      target,
      packages: [{ dir: "." }],
      toolchain: { kind: "staged", dir: staged }
    })
    assert.equal(receipt.ok, false, JSON.stringify(receipt))
    assert.equal(receipt.missing.length, 1)
    assert.match(receipt.missing[0].reason, /digest mismatch/)
    assert.equal(receipt.missing[0].expectedSha256, sha256(freshBytes))
    assert.equal(receipt.missing[0].actualSha256, sha256(staleBytes))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("#167: verifyInstalledCompiler accepts platform optional-dependency binary layout", () => {
  const root = mkdtempSync(join(tmpdir(), "installed-compiler-platform-pkg-"))
  try {
    const target = join(root, "repo")
    const plat = `${process.platform}-${process.arch}`
    const platPkg = process.platform === "win32" ? `@smthrs/cli-${plat}` : `vibelang-${plat}`
    const exe = process.platform === "win32" ? "vibelang.exe" : "vibelang"
    put(target, "package.json", JSON.stringify({ name: "root", private: true, devDependencies: { vibelang: "0.0.14" } }))
    put(target, "node_modules/vibelang/package.json", JSON.stringify({ name: "vibelang", version: "0.0.14" }))
    put(target, `node_modules/${platPkg}/package.json`, JSON.stringify({ name: platPkg, version: "0.0.14" }))
    const bin = put(target, `node_modules/${platPkg}/bin/${exe}`, "#!/bin/sh\necho ok\n")
    chmodSync(bin, 0o755)

    const receipt = verifyInstalledCompiler({
      target,
      packages: [{ dir: "." }],
      toolchain: { kind: "npm", version: "0.0.14" }
    })
    assert.equal(receipt.ok, true, JSON.stringify(receipt))
    assert.equal(receipt.checked[0].binary, bin)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
