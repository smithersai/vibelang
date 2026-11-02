import { test, expect } from "bun:test"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { scratchSite } from "./site-scratch"

function checkout() {
  const repo = mkdtempSync(join(tmpdir(), "site-scratch-test-"))
  for (const [file, text] of Object.entries({
    "site/package.json": "{}",
    "site/src/pages/guide.mdx": "# Guide",
    "site/node_modules/vocs/index.js": "",
    "site/dist/public/index.html": "<p>old</p>",
    "docs/user/guide.md": "# Guide",
    ".jj/repo/store": "",
    ".cache/site-facts.json": "{}",
  })) {
    mkdirSync(dirname(join(repo, file)), { recursive: true })
    writeFileSync(join(repo, file), text)
  }
  return repo
}

test("the copy holds site/'s sources, links its siblings, and leaves out installs, output and version control", () => {
  const repo = checkout()
  const scratch = scratchSite(repo)
  const root = dirname(scratch.site)
  expect(readFileSync(join(scratch.site, "src/pages/guide.mdx"), "utf8")).toBe("# Guide")
  expect(lstatSync(join(scratch.site, "src/pages/guide.mdx")).isSymbolicLink()).toBe(false)
  for (const ignored of ["node_modules", "dist"]) expect(existsSync(join(scratch.site, ignored))).toBe(false)
  expect(readlinkSync(join(root, "docs"))).toBe(join(repo, "docs"))
  expect(existsSync(join(root, ".jj"))).toBe(false)
  expect(lstatSync(join(root, ".cache")).isSymbolicLink()).toBe(false)
  scratch.finish()
  expect(existsSync(root)).toBe(false)
  rmSync(repo, { recursive: true, force: true })
})

test("a build in the copy leaves the checkout unchanged", () => {
  const repo = checkout()
  const scratch = scratchSite(repo)
  rmSync(join(scratch.site, "src/pages"), { recursive: true })
  mkdirSync(join(scratch.site, "src/pages"))
  writeFileSync(join(scratch.site, "src/pages/guide.mdx"), "# Rewritten")
  mkdirSync(join(scratch.site, "node_modules/vocs"), { recursive: true })
  mkdirSync(join(scratch.site, "dist"))
  writeFileSync(join(scratch.site, "../.cache/site-facts.json"), "{\"fresh\":true}")
  expect(() => scratch.finish()).not.toThrow()
  expect(readFileSync(join(repo, "site/src/pages/guide.mdx"), "utf8")).toBe("# Guide")
  expect(readFileSync(join(repo, ".cache/site-facts.json"), "utf8")).toBe("{}")
  rmSync(repo, { recursive: true, force: true })
})

test("finish names the checkout's site/ files that changed while the copy was built", () => {
  const repo = checkout()
  const scratch = scratchSite(repo)
  writeFileSync(join(repo, "site/src/pages/guide.mdx"), "# Rewritten in place")
  rmSync(join(repo, "site/dist/public/index.html"))
  expect(() => scratch.finish()).toThrow("the site build changed the checkout's site/: dist/public/index.html, src/pages/guide.mdx")
  rmSync(repo, { recursive: true, force: true })
})
