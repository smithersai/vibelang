import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

const root = process.env.DEPLOY_DOCS_ROOT || fileURLToPath(new URL("../", import.meta.url))

test("release docs checks can load all runtime platform peers from an extracted tarball", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-deploy-peers-"))
  const put = (path, text, mode) => {
    const target = join(dir, path)
    mkdirSync(join(target, ".."), { recursive: true })
    writeFileSync(target, text, mode ? { mode } : undefined)
  }
  const packages = ["effect", "@effect/platform-node", "@effect/platform-node-shared", "@effect/platform-bun", "@effect/platform-browser"]
  try {
    for (const path of ["scripts", "site/dist", "docs/tools", "experiments", "tarballs", "compiler/package/bin", "runtime/package/dist"]) {
      mkdirSync(join(dir, path), { recursive: true })
    }
    copyFileSync(join(root, "scripts/deploy-docs.sh"), join(dir, "scripts/deploy-docs.sh"))
    for (const file of ["published-site.mjs", "release-docs.mjs"]) copyFileSync(join(root, "docs/tools", file), join(dir, "docs/tools", file))
    const nativePlatform = `${process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}`
    put("packages/compiler/package.json", JSON.stringify({ version: "0.0.11", optionalDependencies: { ["vibelang-" + nativePlatform]: "0.0.11" } }))
    put("packages/runtime/package.json", JSON.stringify({ version: "0.0.11", peerDependencies: { effect: "4.1.0" } }))
    put("compiler/package/bin/vibelang", "#!/bin/sh\nexit 0\n", 0o755)
    for (const name of packages) {
      put(`packages/runtime/node_modules/${name}/package.json`, JSON.stringify({ name, type: "module", exports: "./index.js" }))
      put(`packages/runtime/node_modules/${name}/index.js`, `export default ${JSON.stringify(name)}\n`)
    }
    put("runtime/package/package.json", JSON.stringify({ name: "vibelang-runtime", type: "module" }))
    put("runtime/package/dist/index.js", packages.map((name, i) => `import p${i} from ${JSON.stringify(name)}`).join("\n") +
      "\nexport default [" + packages.map((_, i) => "p" + i).join(",") + "]\n")
    put("probe.mjs", `import { pathToFileURL } from "node:url"
const { default: peers } = await import(pathToFileURL(process.env.VIBELANG_RUNTIME_DIR + "/dist/index.js"))
if (peers.length !== 5) throw new Error("missing runtime peers")
console.log("Totals: all runtime peers resolved")
`)
    put("bin/bun", `#!/bin/sh
[ "$1" = install ] && exit 0
if [ -n "\${VIBELANG_RUNTIME_DIR:-}" ]; then
  exec "$DEPLOY_TEST_NODE" "$DEPLOY_TEST_ROOT/probe.mjs"
fi
exit 0
`, 0o755)
    put("bin/npm", "#!/bin/sh\nprintf 'site npm %s\\n' \"$*\"\n", 0o755)
    put("scripts/brand-gate.mjs", "")
    for (const [source, name] of [["compiler", "vibelang-" + nativePlatform], ["runtime", "vibelang-runtime"]]) {
      const tar = spawnSync("tar", ["czf", join(dir, "tarballs", name + "-0.0.11.tgz"), "-C", join(dir, source), "package"], { encoding: "utf8" })
      assert.equal(tar.status, 0, tar.stderr)
    }
    const result = spawnSync("sh", [join(dir, "scripts/deploy-docs.sh"), "--dry-run"], {
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, PATH: join(dir, "bin") + ":" + process.env.PATH,
        DEPLOY_TEST_NODE: process.execPath, DEPLOY_TEST_ROOT: dir,
        VIBELANG_RELEASE_VERSION: "0.0.11", VIBELANG_RELEASE_TARBALLS: join(dir, "tarballs"),
        VIBELANG_SKIP_RELEASE_SNIPPETS: "0", VIBELANG_DOCS_HOVERS: "1" }
    })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /Totals: all runtime peers resolved/)
    assert.match(result.stdout, /site npm run build/)
    assert.match(result.stdout, /nothing deployed/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
