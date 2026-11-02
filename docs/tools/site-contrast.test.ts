import { test, expect, afterAll } from "bun:test"
import { scratchSite } from "./site-scratch"
import { resolve } from "node:path"

// A private copy of site/: the build replaces its node_modules, pages and dist, which other targets read meanwhile.
const scratch = scratchSite(resolve(import.meta.dir, "../.."))
afterAll(() => scratch.finish())

test("built home, onboarding and cheat sheet have zero contrast violations in both themes", async () => {
  const site = scratch.site
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
    const env = { ...process.env, ...(command.includes("build") ? { NODE_ENV: "production" } : {}) }
    console.log("site contrast stage:", command.join(" "), "NODE_ENV=" + (env.NODE_ENV ?? "unset"))
    const child = Bun.spawn(command, { cwd: site, env, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    expect({ command, code, output: code === 0 ? "" : stdout + stderr }).toEqual({ command, code: 0, output: "" })
    if (command.includes("test:contrast")) console.log(stdout)
  }
  // The build runs the kernel law suite (up to 15 minutes, kernel-facts.ts) and
  // //:site-contrast allows 30; site-contrast-budget.test.ts keeps this between them.
}, 25 * 60_000)
