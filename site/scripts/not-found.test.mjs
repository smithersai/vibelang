import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import { test } from "node:test"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const site = fileURLToPath(new URL("../", import.meta.url))
// The full site check supplies the output it just built; standalone runs build it.
const suppliedOutput = process.env.VIBELANG_DOCS_TEST_OUTPUT
const output = suppliedOutput === undefined ? join(site, "dist/public") : resolve(suppliedOutput)

function head(html) {
  const content = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1]
  assert.ok(content, "the built page must have a head")
  const tags = [...content.matchAll(/<(meta|link)\b([^>]*)>/gi)].map(([, tag, attributes]) => ({
    tag: tag.toLowerCase(),
    ...Object.fromEntries([...attributes.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, name, value]) => [name.toLowerCase(), value])),
  }))
  return {
    title: content.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1],
    meta: name => tags.filter(tag => tag.tag === "meta" && tag.name === name).map(tag => tag.content),
    canonical: tags.filter(tag => tag.tag === "link" && tag.rel === "canonical"),
  }
}

test("the published site has a non-indexable 404 at the Cloudflare assets root", { timeout: 600_000 }, async t => {
  if (suppliedOutput === undefined) {
    const build = spawnSync("npm", ["run", "build"], {
      cwd: site,
      encoding: "utf8",
      timeout: 540_000,
      maxBuffer: 20 * 1024 * 1024,
    })
    assert.equal(build.error, undefined, build.error?.message)
    assert.equal(build.status, 0, (build.stdout + build.stderr).slice(-12_000))
  }

  // cloudflare-stack.test.mjs pins StaticSite.outdir to dist/public and its
  // notFoundHandling to 404-page. A fallback outside this root is never uploaded.
  const fallback = join(output, "404.html")
  await t.test("404.html is a file at the published root", () => {
    assert.ok(statSync(fallback).isFile(), "Cloudflare needs dist/public/404.html")
  })
  const notFound = head(readFileSync(fallback, "utf8"))
  await t.test("the fallback opts out of indexing and has no canonical", () => {
    assert.deepEqual(notFound.meta("robots"), ["noindex"])
    assert.deepEqual(notFound.canonical, [])
  })
  await t.test("the title and description describe a missing page", () => {
    assert.match(notFound.title, /page not found/i)
    assert.equal(notFound.meta("description").length, 1)
    assert.match(notFound.meta("description")[0], /page.*(?:not found|does not exist|doesn.t exist)/i)
  })
  await t.test("ordinary pages retain their indexing and canonical metadata", () => {
    const page = head(readFileSync(join(output, "index.html"), "utf8"))
    assert.deepEqual(page.meta("robots"), ["index, follow"])
    assert.equal(page.canonical.length, 1)
    assert.equal(page.canonical[0].href, "https://vibelang.sh/")
    assert.doesNotMatch(page.title, /page not found/i)
  })
})
