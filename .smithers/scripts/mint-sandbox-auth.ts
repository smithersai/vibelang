#!/usr/bin/env bun
/**
 * One-time-use authentication & verification helper for Smithers Cloud MCP
 * sandboxes and BYOA coding agents (`https://smithers.sh/smithersai/vibelang/mcp`).
 *
 * Security invariants:
 * - PKCE S256 verifiers and minted tokens are written only to mode-600 files
 *   inside a non-world-writable directory (never passed on argv or logged).
 * - Authorization codes expire in 5 minutes and burn atomically on first use.
 * - Untrusted contributor sandboxes are restricted to `mcp:read` only.
 * - Person-only acts (merge, approve, commit TODO, secrets) remain blocked
 *   server-side (`403 person_only`) for all MCP tokens.
 *
 * Usage:
 *   bun .smithers/scripts/mint-sandbox-auth.ts --mode verify
 *   bun .smithers/scripts/mint-sandbox-auth.ts --mode pkce [--trust trusted|untrusted] [--out <file>]
 *   bun .smithers/scripts/mint-sandbox-auth.ts --mode attach --intent <ref> [--out <file>]
 */
import { createHash, randomBytes } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

export const DEFAULT_BASE_URL = "https://smithers.sh"
export const DEFAULT_REPO = "smithersai/vibelang"

export type SandboxTrust = "trusted" | "untrusted"

export interface PkcePair {
  readonly verifier: string
  readonly challenge: string
  readonly method: "S256"
  readonly state: string
}

export interface OneTimeBootstrap {
  readonly repository: string
  readonly mcpEndpoint: string
  readonly trust: SandboxTrust
  readonly scopes: ReadonlyArray<string>
  readonly codeChallenge: string
  readonly codeChallengeMethod: "S256"
  readonly state: string
  readonly authorizeUrl: string
  readonly verifierFile: string | null
  readonly expiresInSeconds: number
}

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

export function pkceS256(verifier: string): string {
  return toBase64Url(createHash("sha256").update(verifier, "ascii").digest())
}

export function generatePkcePair(): PkcePair {
  const verifier = toBase64Url(randomBytes(32))
  const state = toBase64Url(randomBytes(24))
  return {
    verifier,
    challenge: pkceS256(verifier),
    method: "S256",
    state
  }
}

export function scopesForTrust(trust: SandboxTrust): ReadonlyArray<string> {
  return trust === "trusted" ? ["mcp:read", "mcp:write"] : ["mcp:read"]
}

export function buildAuthorizeUrl(params: {
  readonly baseUrl: string
  readonly repository: string
  readonly clientId: string
  readonly redirectUri: string
  readonly challenge: string
  readonly state: string
  readonly scopes: ReadonlyArray<string>
}): string {
  const url = new URL("/api/mcp/oauth/authorize", params.baseUrl)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", params.clientId)
  url.searchParams.set("redirect_uri", params.redirectUri)
  url.searchParams.set("scope", params.scopes.join(" "))
  url.searchParams.set("code_challenge", params.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", params.state)
  url.searchParams.set("resource", `${params.baseUrl.replace(/\/+$/, "")}/${params.repository}/mcp`)
  return url.toString()
}

export function writePrivateSecretFile(filePath: string, payload: Record<string, unknown>): string {
  const abs = resolve(filePath)
  const parent = dirname(abs)
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 })
  const st = statSync(parent)
  if ((st.mode & 0o022) !== 0) {
    throw new Error(`refusing to write private credential into group- or world-writable directory: ${parent}`)
  }
  writeFileSync(abs, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 })
  chmodSync(abs, 0o600)
  return abs
}

export function buildOneTimeBootstrap(options: {
  readonly baseUrl?: string
  readonly repository?: string
  readonly trust?: SandboxTrust
  readonly clientId?: string
  readonly redirectUri?: string
  readonly outFile?: string
}): OneTimeBootstrap {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
  const repository = options.repository ?? DEFAULT_REPO
  const trust: SandboxTrust = options.trust ?? "untrusted"
  const scopes = scopesForTrust(trust)
  const pkce = generatePkcePair()
  const clientId = options.clientId ?? "smithers-sandbox-ephemeral"
  const redirectUri = options.redirectUri ?? "http://127.0.0.1:43111/callback"
  const mcpEndpoint = `${baseUrl}/${repository}/mcp`

  let verifierFile: string | null = null
  if (options.outFile) {
    verifierFile = writePrivateSecretFile(options.outFile, {
      repository,
      mcpEndpoint,
      trust,
      scopes,
      codeVerifier: pkce.verifier,
      state: pkce.state,
      createdAt: new Date().toISOString()
    })
  }

  return {
    repository,
    mcpEndpoint,
    trust,
    scopes,
    codeChallenge: pkce.challenge,
    codeChallengeMethod: "S256",
    state: pkce.state,
    authorizeUrl: buildAuthorizeUrl({
      baseUrl,
      repository,
      clientId,
      redirectUri,
      challenge: pkce.challenge,
      state: pkce.state,
      scopes
    }),
    verifierFile,
    expiresInSeconds: 300
  }
}

export async function verifyCloudMcp(baseUrl = DEFAULT_BASE_URL, repository = DEFAULT_REPO): Promise<{
  readonly ok: boolean
  readonly protectedResourceOk: boolean
  readonly authServerOk: boolean
  readonly initializeOk: boolean
  readonly toolsCount: number
  readonly tools: ReadonlyArray<string>
}> {
  const base = baseUrl.replace(/\/+$/, "")
  const prRes = await fetch(`${base}/.well-known/oauth-protected-resource/${repository}/mcp`)
  let authServerBase = base
  if (prRes.ok) {
    try {
      const prMeta = (await prRes.json()) as { authorization_servers?: string[] }
      if (prMeta.authorization_servers?.[0]) {
        authServerBase = prMeta.authorization_servers[0].replace(/\/+$/, "")
      }
    } catch {
      // fall back to base
    }
  }
  const asRes = await fetch(`${authServerBase}/.well-known/oauth-authorization-server`)

  const initRes = await fetch(`${base}/${repository}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "vibelang-mcp-verify", version: "1.0.0" }
      }
    })
  })

  const listRes = await fetch(`${base}/${repository}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    })
  })

  let tools: string[] = []
  if (listRes.ok) {
    const text = await listRes.text()
    try {
      const json = JSON.parse(text) as { result?: { tools?: Array<{ name?: string }> } }
      tools = (json.result?.tools ?? []).map((t) => t.name).filter((n): n is string => typeof n === "string")
    } catch {
      const dataLine = text.split("\n").find((l) => l.startsWith("data:"))
      if (dataLine) {
        const json = JSON.parse(dataLine.slice(5).trim()) as { result?: { tools?: Array<{ name?: string }> } }
        tools = (json.result?.tools ?? []).map((t) => t.name).filter((n): n is string => typeof n === "string")
      }
    }
  }

  return {
    ok: prRes.ok && asRes.ok && initRes.ok && tools.length > 0,
    protectedResourceOk: prRes.ok,
    authServerOk: asRes.ok,
    initializeOk: initRes.ok,
    toolsCount: tools.length,
    tools
  }
}

async function main() {
  const args = process.argv.slice(2)
  const getArg = (flag: string): string | undefined => {
    const idx = args.indexOf(flag)
    return idx >= 0 ? args[idx + 1] : undefined
  }
  const mode = getArg("--mode") ?? "verify"
  const baseUrl = getArg("--base-url") ?? DEFAULT_BASE_URL
  const repository = getArg("--repo") ?? DEFAULT_REPO

  if (mode === "verify") {
    const result = await verifyCloudMcp(baseUrl, repository)
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exit(1)
    return
  }

  if (mode === "pkce") {
    const trust = (getArg("--trust") === "trusted" ? "trusted" : "untrusted") as SandboxTrust
    const outFile = getArg("--out")
    const bootstrap = buildOneTimeBootstrap({ baseUrl, repository, trust, outFile })
    // Never print codeVerifier to stdout; only print the public S256 challenge & one-time consent URL.
    console.log(JSON.stringify(bootstrap, null, 2))
    return
  }

  if (mode === "attach") {
    const intent = getArg("--intent")
    if (!intent) {
      console.error("mint-sandbox-auth: --mode attach requires --intent <attach-intent-ref>")
      process.exit(2)
    }
    const pkce = generatePkcePair()
    const outFile = getArg("--out")
    const claimRes = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/attach/claims`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intent,
        clientName: "vibelang-sandbox",
        codeChallenge: pkce.challenge,
        codeChallengeMethod: "S256"
      })
    })
    if (!claimRes.ok) {
      console.error(`mint-sandbox-auth: attach claim failed with HTTP ${claimRes.status}`)
      process.exit(1)
    }
    const claim = (await claimRes.json()) as Record<string, unknown>
    const verifierFile = outFile
      ? writePrivateSecretFile(outFile, {
          repository,
          mode: "attach",
          codeVerifier: pkce.verifier,
          createdAt: new Date().toISOString()
        })
      : null
    console.log(
      JSON.stringify(
        {
          repository,
          mode: "attach",
          pairingCode: claim.pairingCode ?? null,
          verifierFile,
          note: "Approve this one-time pairing code in Smithers Cloud; redeem with the mode-600 verifier file."
        },
        null,
        2
      )
    )
    return
  }

  console.error(`mint-sandbox-auth: unknown mode ${mode}`)
  process.exit(2)
}

if (import.meta.main) {
  await main()
}
