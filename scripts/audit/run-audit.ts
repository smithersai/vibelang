#!/usr/bin/env bun
/**
 * Runs Uphill continuous metrics + VibeLang backpressure gates, renders the
 * Chrome-Lighthouse-inspired Backpressure Audit Report (HTML, JSON, Markdown),
 * attaches execution trust provenance, and optionally publishes to Smithers
 * Cloud feeds and CI artifacts.
 *
 * Usage:
 *   bun scripts/audit/run-audit.ts [--ci] [--publish] [--out <html-path>] [--skip-uphill]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import {
  buildAuditSummary,
  renderLighthouseHtml,
  renderMarkdownSummary,
  type AuditProvenance,
  type BackpressureGate,
  type CachePolicy,
  type ExecutionTrust,
  type UphillReport
} from "./render-lighthouse-report.ts"

const repoRoot = resolve(import.meta.dir, "../..")

export function resolveExecutionTrust(env: Readonly<Record<string, string | undefined>>): {
  readonly executionTrust: ExecutionTrust
  readonly cachePolicy: CachePolicy
} {
  const isControlledSandbox =
    env.SMITHERS_SANDBOX === "1" ||
    env.SMITHERS_CONTROLLED_SANDBOX === "1" ||
    Boolean(env.SMITHERS_ARTIFACT_URL)

  const isTrustedMainCi =
    env.GITHUB_ACTIONS === "true" &&
    env.GITHUB_REPOSITORY === "smithersai/vibelang" &&
    env.GITHUB_EVENT_NAME === "push" &&
    env.GITHUB_REF === "refs/heads/main"

  const isUntrustedPr =
    env.GITHUB_ACTIONS === "true" &&
    (env.GITHUB_EVENT_NAME === "pull_request" || env.GITHUB_EVENT_NAME === "pull_request_target")

  const hasWrite = Boolean(env.SMITHERS_CACHE_WRITE_TOKEN)
  const hasRead = Boolean(env.SMITHERS_CACHE_READ_TOKEN)

  if (isUntrustedPr) {
    return {
      executionTrust: "untrusted-contributor",
      cachePolicy: hasRead ? "read-only-namespaced" : "local-only"
    }
  }
  if (isControlledSandbox || isTrustedMainCi) {
    return {
      executionTrust: "trusted-sandbox",
      cachePolicy: hasWrite ? "read-write-trunk" : hasRead ? "read-only-namespaced" : "local-only"
    }
  }
  if (env.SMITHERS_TRUST_ROLE === "contributor" || env.SMITHERS_UNTRUSTED === "1") {
    return {
      executionTrust: "untrusted-contributor",
      cachePolicy: hasRead ? "read-only-namespaced" : "local-only"
    }
  }
  return {
    executionTrust: "maintainer",
    cachePolicy: hasWrite ? "read-write-trunk" : hasRead ? "read-only-namespaced" : "local-only"
  }
}

function findUphillBinary(): string | null {
  const candidates = [
    process.env.UPHILL_BIN,
    join(homedir(), ".uphill/bin/uphill"),
    "uphill"
  ].filter((x): x is string => Boolean(x))

  for (const bin of candidates) {
    if (bin.includes("/") && !existsSync(bin)) continue
    const probe = spawnSync(bin, ["--version"], { encoding: "utf8" })
    if (probe.status === 0) return bin
  }
  return null
}

function currentRevision(): { commit: string; branch: string } {
  if (process.env.GITHUB_SHA) {
    return {
      commit: process.env.GITHUB_SHA,
      branch: process.env.GITHUB_REF_NAME ?? process.env.GITHUB_HEAD_REF ?? "main"
    }
  }
  const jj = spawnSync(
    "jj",
    ["--no-pager", "log", "-r", "@-", "--no-graph", "-T", 'commit_id ++ "\\n" ++ bookmarks'],
    { cwd: repoRoot, encoding: "utf8" }
  )
  if (jj.status === 0 && jj.stdout.trim()) {
    const [commit = "unknown", bookmarks = "vibe"] = jj.stdout.trim().split("\n")
    return { commit: commit.trim(), branch: bookmarks.trim().split(/\s+/)[0] || "vibe" }
  }
  return { commit: "working-copy", branch: "vibe" }
}

function buildGatesFromReport(
  report: UphillReport,
  trust: { readonly executionTrust: ExecutionTrust; readonly cachePolicy: CachePolicy }
): ReadonlyArray<BackpressureGate> {
  const factoryCat = report.categories.find((c) => c.name === "factory")
  const byName = new Map((factoryCat?.metrics ?? []).map((m) => [m.name, m]))
  const gateOf = (name: string, label: string, fallbackDetail: string): BackpressureGate => {
    const m = byName.get(name)
    if (!m) return { name: label, status: "average", detail: fallbackDetail }
    const pass = m.value === true || m.value === "pass" || (typeof m.score === "number" && m.score >= 90)
    return {
      name: label,
      status: pass ? "pass" : "fail",
      detail: m.note ?? fallbackDetail
    }
  }
  const regressions = (report.changes ?? []).filter((c) => (c.change ?? c.direction) === "worse")
  return [
    gateOf("factory-projection", "Declarative Factory Projection", ".smithers/FACTORY.ts matches factory.json and home.json"),
    gateOf("cache-trust", "Split Read/Write Object Store", "Untrusted PRs receive read-only cache hits; writes isolated to main"),
    gateOf("workflow-trust", "Controlled Workflow Trust", "pr-check, uphill, and cache-publish honor trust boundaries"),
    gateOf("factory-policy", "Public Mirror & Maintainer Policy", "Two-way issues, GitHub push mirror, protected paths active"),
    gateOf("wiki-links", "Obsidian Wiki & Mythical History", "Zero broken wikilinks across docs/wiki/"),
    {
      name: "Uphill Baseline Guard",
      status: regressions.length === 0 ? "pass" : "fail",
      detail:
        regressions.length === 0
          ? "Zero regressions against committed Uphill baseline"
          : `${regressions.length} metric regression(s) detected since baseline`
    },
    {
      name: "Execution Trust Boundary",
      status: trust.executionTrust === "untrusted-contributor" ? "average" : "pass",
      detail: `${trust.executionTrust} · ${trust.cachePolicy}`
    }
  ]
}

function readCompilerVersion(): string | undefined {
  const identityPath = join(repoRoot, "typescript/tsc/internal/vibelang/identity.go")
  if (!existsSync(identityPath)) return undefined
  const m = /const\s+Version\s*=\s*"([^"]+)"/.exec(readFileSync(identityPath, "utf8"))
  return m?.[1]
}

async function publishAuditFeed(summary: unknown): Promise<void> {
  let cfg: { url: string; repo: string; key: string } | null = null
  if (process.env.SMITHERS_FEED_TOKEN) {
    cfg = {
      url: process.env.SMITHERS_FEED_URL || "https://smithers.sh",
      repo: process.env.SMITHERS_FEED_REPO || "smithersai/vibelang",
      key: process.env.SMITHERS_FEED_TOKEN
    }
  } else {
    const cfgPath = process.env.SMITHERS_FEED_CONFIG ?? join(homedir(), ".config/vibelang-factory/smithers.json")
    if (existsSync(cfgPath)) {
      cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as { url: string; repo: string; key: string }
    }
  }
  if (!cfg) {
    console.warn("run-audit: skip feed publish (no feed config or SMITHERS_FEED_TOKEN present)")
    return
  }
  const endpoint = `${cfg.url.replace(/\/+$/, "")}/api/repos/${cfg.repo}/feeds`
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.key}`
    },
    body: JSON.stringify({
      set: {
        audit: {
          visibility: "public",
          body: summary
        }
      }
    })
  })
  if (!res.ok) {
    throw new Error(`feed publish failed with HTTP ${res.status}`)
  }
  const json = (await res.json()) as { written: number; unchanged: number; deleted: number }
  console.log(`run-audit: published public 'audit' feed (written=${json.written}, unchanged=${json.unchanged})`)
}

async function main() {
  const args = process.argv.slice(2)
  const skipUphill = args.includes("--skip-uphill")
  const publish = args.includes("--publish")
  const outIdx = args.indexOf("--out")
  const customOut = outIdx >= 0 ? args[outIdx + 1] : undefined

  if (!skipUphill) {
    const uphillBin = findUphillBinary()
    if (!uphillBin) {
      console.error("run-audit: uphill binary not found (install wevm/uphill or pass --skip-uphill)")
      process.exit(1)
    }
    const checkRes = spawnSync(uphillBin, ["check"], { cwd: repoRoot, stdio: "inherit" })
    if (checkRes.status !== 0) process.exit(checkRes.status ?? 1)
    const runRes = spawnSync(uphillBin, ["--compact"], { cwd: repoRoot, stdio: "inherit" })
    if (runRes.status !== 0) process.exit(runRes.status ?? 1)
  }

  const reportJsonPath = join(repoRoot, ".uphill/report.json")
  if (!existsSync(reportJsonPath)) {
    console.error("run-audit: .uphill/report.json not found")
    process.exit(1)
  }

  const report = JSON.parse(readFileSync(reportJsonPath, "utf8")) as UphillReport
  const rev = currentRevision()
  const trust = resolveExecutionTrust(process.env)
  const provenance: AuditProvenance = {
    repository: "smithersai/vibelang",
    commit: rev.commit,
    branch: rev.branch,
    generatedAt: new Date().toISOString(),
    executionTrust: trust.executionTrust,
    cachePolicy: trust.cachePolicy,
    cacheEndpoint: process.env.SMITHERS_CACHE_URL || "https://build.smithers.sh",
    factoryUrl: "https://smithers.sh/smithersai/vibelang/-/factory",
    wikiUrl: "https://smithers.sh/smithersai/vibelang/-/wiki",
    mcpEndpoint: "https://smithers.sh/smithersai/vibelang/mcp",
    compilerVersion: readCompilerVersion(),
    buildTargets: 5709,
    gates: buildGatesFromReport(report, trust)
  }

  const summary = buildAuditSummary(report, provenance)
  const html = renderLighthouseHtml(report, provenance)
  const md = renderMarkdownSummary(summary)

  const htmlPath = customOut ? resolve(repoRoot, customOut) : join(repoRoot, ".uphill/lighthouse-audit.html")
  const summaryJsonPath = join(repoRoot, ".uphill/lighthouse-audit.json")
  const summaryMdPath = join(repoRoot, ".uphill/lighthouse-audit.md")
  mkdirSync(dirname(htmlPath), { recursive: true })
  writeFileSync(htmlPath, html, "utf8")
  writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2) + "\n", "utf8")
  writeFileSync(summaryMdPath, md, "utf8")

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n")
  }

  // When running inside a controlled Smithers Cloud gate sandbox, upload the
  // Lighthouse audit report directly to the run's R2 artifact store.
  if (process.env.SMITHERS_ARTIFACT_URL) {
    const target = `${process.env.SMITHERS_ARTIFACT_URL.replace(/\/+$/, "")}/lighthouse-audit.html`
    const bytes = new TextEncoder().encode(html)
    const put = await fetch(target, {
      method: "PUT",
      headers: { "content-type": "text/html; charset=utf-8", "content-length": String(bytes.byteLength) },
      body: bytes
    })
    if (!put.ok) console.warn(`run-audit: artifact upload returned HTTP ${put.status}`)
  }

  if (publish) {
    await publishAuditFeed(summary)
  }

  console.log(
    `run-audit: overall=${summary.overallScore}/100 trust=${summary.executionTrust} cache=${summary.cachePolicy} wrote=${htmlPath}`
  )
}

if (import.meta.main) {
  await main()
}
