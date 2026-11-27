import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import {
  buildOneTimeBootstrap,
  generatePkcePair,
  pkceS256,
  scopesForTrust,
  writePrivateSecretFile
} from "../../.smithers/scripts/mint-sandbox-auth.ts"

test("generatePkcePair satisfies RFC 7636 S256 challenge format", () => {
  const pair = generatePkcePair()
  assert.match(pair.verifier, /^[A-Za-z0-9_-]{43,128}$/)
  assert.match(pair.challenge, /^[A-Za-z0-9_-]{43,128}$/)
  assert.equal(pair.method, "S256")
  assert.equal(pkceS256(pair.verifier), pair.challenge)
  assert.notEqual(pair.verifier, pair.challenge)
})

test("scopesForTrust restricts untrusted sandboxes strictly to mcp:read", () => {
  assert.deepEqual(scopesForTrust("untrusted"), ["mcp:read"])
  assert.deepEqual(scopesForTrust("trusted"), ["mcp:read", "mcp:write"])
})

test("buildOneTimeBootstrap omits verifier from public output and writes mode-600 file", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-auth-test-"))
  try {
    chmodSync(dir, 0o700)
    const secretFile = join(dir, "pkce.json")
    const bootstrap = buildOneTimeBootstrap({
      trust: "untrusted",
      outFile: secretFile
    })
    assert.equal(bootstrap.repository, "smithersai/vibelang")
    assert.equal(bootstrap.mcpEndpoint, "https://smithers.sh/smithersai/vibelang/mcp")
    assert.deepEqual(bootstrap.scopes, ["mcp:read"])
    assert.equal(bootstrap.expiresInSeconds, 300)
    assert.ok(bootstrap.authorizeUrl.includes("code_challenge_method=S256"))
    assert.ok(!("codeVerifier" in bootstrap), "public bootstrap must never expose raw codeVerifier")

    const mode = statSync(secretFile).mode & 0o777
    assert.equal(mode, 0o600, "secret file must be mode 0600")
    const saved = JSON.parse(readFileSync(secretFile, "utf8"))
    assert.equal(pkceS256(saved.codeVerifier), bootstrap.codeChallenge)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("writePrivateSecretFile refuses group- or world-writable directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-auth-unsafe-"))
  try {
    chmodSync(dir, 0o777)
    assert.throws(
      () => writePrivateSecretFile(join(dir, "pkce.json"), { secret: "x" }),
      /group- or world-writable/
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
