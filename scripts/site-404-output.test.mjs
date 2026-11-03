import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const runner = fileURLToPath(new URL("../site/scripts/not-found.test.mjs", import.meta.url))
const page = (title, robots, description, canonical = "") =>
  "<!doctype html><html><head><title>" + title + "</title>" +
  "<meta name=\"robots\" content=\"" + robots + "\">" +
  "<meta name=\"description\" content=\"" + description + "\">" + canonical + "</head><body></body></html>"

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-404-output-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const output = join(root, "published site #1")
  mkdirSync(output)
  writeFileSync(join(output, "404.html"), page("Page not found", "noindex", "This page does not exist."))
  writeFileSync(join(output, "index.html"), page("VibeLang", "index, follow", "VibeLang docs", "<link rel=\"canonical\" href=\"https://vibelang.sh/\">"))
  return { root, output }
}

function run(root, output) {
  const env = { ...process.env, PATH: join(root, "no-tools") }
  delete env.NODE_TEST_CONTEXT
  delete env.VIBELANG_DOCS_TEST_OUTPUT
  if (output !== undefined) env.VIBELANG_DOCS_TEST_OUTPUT = output
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", runner], {
    env, cwd: root, encoding: "utf8", timeout: 15_000,
  })
  assert.equal(result.error, undefined, result.error?.message)
  return { status: result.status, text: result.stdout + result.stderr }
}

function edit(output, file, change) {
  const path = join(output, file)
  writeFileSync(path, change(readFileSync(path, "utf8")))
}

test("404 checks use the specified output, including spaces, with no build tools on PATH", t => {
  const { root, output } = fixture(t)
  const result = run(root, output)
  assert.equal(result.status, 0, result.text)
  assert.match(result.text, /# pass 5/)
})

test("the standalone 404 check still attempts its production build", t => {
  const { root } = fixture(t)
  const result = run(root)
  assert.notEqual(result.status, 0, result.text)
  assert.match(result.text, /spawnSync npm ENOENT/)
})

test("a missing supplied output fails at its given path without attempting a build", t => {
  const { root } = fixture(t)
  const output = join(root, "missing publication")
  const result = run(root, output)
  assert.notEqual(result.status, 0, result.text)
  assert.ok(result.text.includes(join(output, "404.html")), result.text)
  assert.doesNotMatch(result.text, /spawnSync npm/)
})

const corruptions = [
  ["fallback is a directory", "404.html is a file", output => {
    rmSync(join(output, "404.html")); mkdirSync(join(output, "404.html"))
  }],
  ["fallback lacks a head", "built page must have a head", output => edit(output, "404.html", () => "<html><body>missing</body></html>")],
  ["fallback allows indexing", "fallback opts out", output => edit(output, "404.html", s => s.replace("noindex", "index, follow"))],
  ["fallback has a canonical", "fallback opts out", output => edit(output, "404.html", s => s.replace("</head>", "<link rel=\"canonical\" href=\"https://vibelang.sh/\"></head>"))],
  ["fallback has the wrong title", "title and description", output => edit(output, "404.html", s => s.replace("Page not found", "VibeLang"))],
  ["fallback has the wrong description", "title and description", output => edit(output, "404.html", s => s.replace("This page does not exist.", "Welcome"))],
  ["fallback has duplicate descriptions", "title and description", output => edit(output, "404.html", s => s.replace("</head>", "<meta name=\"description\" content=\"Page not found\"></head>"))],
  ["ordinary page forbids indexing", "ordinary pages retain", output => edit(output, "index.html", s => s.replace("index, follow", "noindex"))],
  ["ordinary page lacks a canonical", "ordinary pages retain", output => edit(output, "index.html", s => s.replace(/<link[^>]+>/, ""))],
  ["ordinary page has the wrong canonical", "ordinary pages retain", output => edit(output, "index.html", s => s.replace("https://vibelang.sh/", "https://invalid.example/"))],
  ["ordinary page has a missing-page title", "ordinary pages retain", output => edit(output, "index.html", s => s.replace("<title>VibeLang</title>", "<title>Page not found</title>"))],
]
for (const [name, reason, corrupt] of corruptions) test("prebuilt 404 checks reject: " + name, t => {
  const { root, output } = fixture(t)
  corrupt(output)
  const result = run(root, output)
  assert.notEqual(result.status, 0, result.text)
  assert.ok(result.text.includes(reason), result.text)
  assert.doesNotMatch(result.text, /spawnSync npm/)
})

test("generated output directories retain positive and negative publication checks", t => {
  const { root, output } = fixture(t)
  for (let index = 0; index < 16; index++) {
    const target = join(root, ["space path", "éΩ", "hash #", "nested"][index % 4] + index)
    mkdirSync(target)
    for (const file of ["404.html", "index.html"]) writeFileSync(join(target, file), readFileSync(join(output, file)))
    assert.equal(run(root, target).status, 0, "valid output neighbour " + index)
    edit(target, "404.html", text => text.replace("noindex", "index, follow"))
    const invalid = run(root, target)
    assert.notEqual(invalid.status, 0, "invalid output neighbour " + index)
    assert.match(invalid.text, /fallback opts out/)
    assert.doesNotMatch(invalid.text, /spawnSync npm/)
  }
})

test("relative supplied output resolves against the caller directory", t => {
  const { root, output } = fixture(t)
  assert.equal(run(root, relative(root, output)).status, 0)
})

test("an explicitly empty output never starts a fallback build", t => {
  const { root } = fixture(t)
  const result = run(root, "")
  assert.notEqual(result.status, 0)
  assert.ok(result.text.includes(join(root, "404.html")), result.text)
  assert.doesNotMatch(result.text, /spawnSync npm/)
})
