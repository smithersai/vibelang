import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { packagedMarkdownLinkViolations } from "../scripts/packaged-markdown-links.mjs";

const root = resolve(import.meta.dirname, "..");

test("packaged Markdown resolves relative links against its archive directory", () => {
  assert.deepEqual(packagedMarkdownLinkViolations("docs/API.md",
    "[license](../LICENSE) [nested](details/Contract%20Notes.md#result) [same](API.md?raw=1)",
    ["docs/API.md", "LICENSE", "docs/details/Contract Notes.md"]), []);
});

test("packaged Markdown permits remote URLs and same-document anchors", () => {
  assert.deepEqual(packagedMarkdownLinkViolations("README.md",
    "[site](https://vibelang.sh) [mail](mailto:security@example.test) [section](#license)", []), []);
});

for (const [link, reason] of [
  ["docs/DECISIONS.md", "unshipped file"],
  ["../outside.md", "unshipped file"],
  ["%2e%2e/outside.md", "unshipped file"],
  ["bad%ZZ.md", "invalid percent-encoded link"],
  ["/absolute.md", "unsafe local link"],
  ["docs%5Csecret.md", "unsafe local link"],
  ["?raw=1", "unsafe local link"],
]) {
  test(`packaged Markdown refuses ${link}`, () => {
    const failures = packagedMarkdownLinkViolations("README.md", `[link](${link})`, ["README.md"]);
    assert.equal(failures.length, 1);
    assert.ok(failures[0].includes(reason), failures[0]);
    assert.ok(failures[0].includes(`README.md -> ${link}`), failures[0]);
  });
}

test("packaged Markdown reports every broken local link", () => {
  assert.equal(packagedMarkdownLinkViolations("README.md",
    "[one](one.md) [two](two.md)", ["README.md"]).length, 2);
});

test("every Markdown link resolves in npm's actual package inventory", () => {
  // A dry run neither invokes prepack (which would recurse into this suite)
  // nor creates an archive. It catches a source-only README link in seconds,
  // before the release gate waits for the Bun and Go suites.
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm",
    ["pack", "--dry-run", "--ignore-scripts", "--json"],
    { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.length, 1);
  const paths = report[0].files.map(({ path }) => path);
  assert.ok(paths.includes("README.md"));
  const failures = paths.filter((path) => path.endsWith(".md")).flatMap((path) =>
    packagedMarkdownLinkViolations(path, readFileSync(join(root, path), "utf8"), paths));
  assert.deepEqual(failures, []);
});
