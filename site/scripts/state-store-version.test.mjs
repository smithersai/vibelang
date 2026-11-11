import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

// The site deploys through alchemy's Cloudflare state store: one Worker that every
// alchemy stack in the Cloudflare account shares. alchemy moves that Worker to its own
// STATE_STORE_VERSION before each deploy, and a release older than the account's store
// fails there with "State store request failed (DecodeError, HTTP 409)". 2.0.0-beta.84
// writes v7; the account's store runs v8, which 2.0.0-beta.85 writes.
const ACCOUNT_STATE_STORE_VERSION = 8

const site = new URL("../", import.meta.url)
const manifest = JSON.parse(readFileSync(new URL("package.json", site), "utf8"))
const pins = { ...manifest.dependencies, ...manifest.devDependencies }

test("alchemy and its Cloudflare provider are pinned to one exact release", () => {
  assert.match(pins.alchemy, /^\d+\.\d+\.\d+(?:-[\w.]+)?$/)
  assert.equal(pins["@alchemy.run/cloudflare"], pins.alchemy)
})

test("the installed Cloudflare provider writes the account's state store version", () => {
  const provider = new URL("node_modules/@alchemy.run/cloudflare/", site)
  assert.equal(JSON.parse(readFileSync(new URL("package.json", provider), "utf8")).version, pins["@alchemy.run/cloudflare"])
  const api = readFileSync(new URL("lib/StateStore/Api.js", provider), "utf8")
  const version = Number(/export const STATE_STORE_VERSION = (\d+);/.exec(api)?.[1])
  assert.ok(version >= ACCOUNT_STATE_STORE_VERSION,
    `@alchemy.run/cloudflare ${pins["@alchemy.run/cloudflare"]} writes state store v${version}; the account's store is v${ACCOUNT_STATE_STORE_VERSION}, so the deploy fails with HTTP 409`)
})
