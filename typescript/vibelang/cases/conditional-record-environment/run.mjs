import assert from "node:assert/strict"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../../../../scripts/api-identity.mjs"
import { assertReferenceTypes } from "../../test/cov-ch004-twin.mjs"
import { readFileSync } from "node:fs"
import * as vibe from "./out/a.js"
import * as ts from "./out/reference.js"
// Plain code: no frames and no Effect. Its for...of loops use the runtime's
// close helper, which joins a failing return() to the failure in flight (D424).
assert.doesNotMatch(readFileSync(new URL("./out/a.js", import.meta.url), "utf8"), /fnUntraced|yield\*|effect\//)
for (const { consume, repositoryCheckEnvironment } of [vibe, ts]) {
  const input = { PATH: "/bin", SMITHERS_CACHE_URL: "url", SMITHERS_CACHE_TOKEN: "token", PRIVATE: "secret" }
  const value = consume(input)
  assert.deepEqual(value, { environment: { PATH: "/bin" }, cache: { SMITHERS_CACHE_URL: "url", SMITHERS_CACHE_TOKEN: "token", SMITHERS_CACHE_READ_TOKEN: "token" } })
  assert.equal(input.SMITHERS_CACHE_URL, undefined)
  assert.equal(input.SMITHERS_CACHE_TOKEN, undefined)
  for (const partial of [{}, { SMITHERS_CACHE_URL: "url" }, { SMITHERS_CACHE_TOKEN: "token" }, { SMITHERS_CACHE_URL: "", SMITHERS_CACHE_TOKEN: "token" }, { SMITHERS_CACHE_URL: "url", SMITHERS_CACHE_TOKEN: "" }]) {
    assert.deepEqual(consume(partial).cache, {})
  }
  assert.equal(repositoryCheckEnvironment({}), undefined)
  const environment = { PATH: "/bin" }
  assert.equal(repositoryCheckEnvironment({ checkEnvironment: environment, cacheEnvironment: {} }), environment)
  assert.deepEqual(repositoryCheckEnvironment({ checkEnvironment: environment, cacheEnvironment: { TOKEN: "read" } }), { PATH: "/bin", TOKEN: "read" })
}
assertReferenceTypes(loadTypeScript(), dirname(fileURLToPath(import.meta.url)), undefined, { before: "out/reference.d.ts", after: "out/a.d.ts" })
console.log("ok")
