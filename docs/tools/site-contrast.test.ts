import { test, expect, afterAll } from "bun:test"
import { contrastStage } from "./site-contrast-stage"
import { scratchSite } from "./site-scratch"
import { resolve, join } from "node:path"
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { builtInstallProblems } from "./published-site.mjs"

// A private copy of site/: the build replaces its node_modules, pages and dist, which other targets read meanwhile.
const scratch = scratchSite(resolve(import.meta.dir, "../.."))
afterAll(() => scratch.finish())

test("built install metadata resolves in the npm snapshot and both themes have zero contrast violations", async () => {
  const site = scratch.site
  const fixture = resolve(import.meta.dir, "testdata/npm-0.0.10.json")
  const snapshot = JSON.parse(readFileSync(fixture, "utf8"))
  const bin = mkdtempSync(join(tmpdir(), "site-registry-"))
  const realNpm = Bun.which("npm")!
  // Keep registry metadata hermetic while exercising the real prebuild child,
  // MDX renderer, HTML output and Markdown copies. No snapshot env is inherited:
  // prebuild must pass the selected snapshot to its child explicitly.
  writeFileSync(join(bin, "npm"), [
    "#!/usr/bin/env node",
    'import { readFileSync } from "node:fs"',
    'import { spawnSync } from "node:child_process"',
    "const snapshot = JSON.parse(readFileSync(" + JSON.stringify(fixture) + ', "utf8"))',
    "const args = process.argv.slice(2)",
    'if (args[0] !== "view") { const child = spawnSync(' + JSON.stringify(realNpm) + ', args, { stdio: "inherit" }); process.exit(child.status ?? 1) }',
    'if (args[1] === "vibelang" && args[2] === "version") { console.log(snapshot.compiler.version); process.exit(0) }',
    'if (args[2] === "versions") { const p = snapshot.packages[args[1]]; if (!p) process.exit(1); console.log(JSON.stringify(p.versions ?? [p.version])); process.exit(0) }',
    'const name = args[1]?.replace(/@[^@]*$/, "")',
    'const manifest = name === "vibelang" ? snapshot.compiler : name === "vibelang-runtime" ? snapshot.runtime : snapshot.packages[name]',
    'if (!manifest || !args[1].endsWith("@" + manifest.version)) { console.error("Package absent from registry snapshot: " + args[1]); process.exit(1) }',
    "console.log(JSON.stringify(manifest))",
  ].join("\n"))
  chmodSync(join(bin, "npm"), 0o755)
  try {
    // Exercise the production build in the release validator's docs/tools step.
    // Install Chromium once with: cd site && bunx playwright install chromium
    for (const command of [
      ["npm", "ci", "--no-audit", "--no-fund"],
      ["npm", "run", "test:infrastructure"],
      ["npm", "run", "typecheck"],
      ["bun", "run", "build"],
      ["bun", "run", "test:contrast"],
    ]) {
      // Bun tests set NODE_ENV=test; React would embed development RSC stacks.
      // Keep npm ci in the test environment so it installs devDependencies.
      const env = { ...process.env, ...(command.includes("build") ? { NODE_ENV: "production", PATH: bin + ":" + process.env.PATH } : {}) }
      delete env.VIBELANG_SITE_RELEASE_FILE
      delete env.VIBELANG_RELEASE_VERSION
      const { stdout, stderr, code } = await contrastStage(command, site, env)
      expect({ command, code, output: code === 0 ? "" : stdout + stderr }).toEqual({ command, code: 0, output: "" })
      if (command.includes("build")) {
        expect(builtInstallProblems(join(site, "dist/public"), snapshot)).toEqual([])
        for (const file of ["index.html", "getting-started/004-installation/index.html", "getting-started/004-installation.md"]) {
          const text = readFileSync(join(site, "dist/public", file), "utf8")
          expect(text).not.toContain("@vibelang/cli-win32-")
          expect(text).toContain("WSL")
        }
      }
      if (command.includes("test:contrast")) console.log(stdout)
    }
  } finally { rmSync(bin, { recursive: true, force: true }) }
  // The build runs the kernel law suite (up to 15 minutes, kernel-facts.ts) and
  // //:site-contrast allows 30; site-contrast-budget.test.ts keeps this between them.
}, 25 * 60_000)
