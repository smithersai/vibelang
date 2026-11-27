import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildAuditSummary,
  escapeHtml,
  renderLighthouseHtml,
  renderMarkdownSummary,
  scoreBand
} from "./render-lighthouse-report.ts"
import { resolveExecutionTrust } from "./run-audit.ts"

const sampleReport = {
  version: 1,
  categories: [
    {
      name: "correctness",
      title: "Correctness",
      description: "Version lockstep and guards.",
      score: 94,
      metrics: [
        {
          name: "version-alignment",
          title: "Version alignment",
          value: "pass",
          score: 100,
          target: "pass",
          items: [{ name: "packages/compiler/package.json", value: "pass" }]
        }
      ]
    },
    {
      name: "style",
      title: "Style",
      description: "gofmt and strict typing.",
      score: 62,
      metrics: [
        {
          name: "ts-no-explicit-any",
          title: "No explicit any",
          value: "fail",
          score: 20,
          target: "pass",
          note: "packages/runtime/src/foo.ts:12: <script>alert(1)</script>"
        }
      ]
    },
    {
      name: "footprint",
      title: "Footprint",
      description: "Modular packages and concise SKILL.md.",
      score: 38,
      metrics: [
        {
          name: "skill-bytes",
          title: "SKILL.md size",
          unit: "bytes",
          value: 22100,
          target: 18000,
          score: 40
        }
      ]
    }
  ],
  changes: [
    {
      direction: "worse",
      category: "footprint",
      metric: "skill-bytes",
      baseline: "21.9 kB",
      current: "22.1 kB"
    }
  ]
}

const sampleProvenance = {
  repository: "smithersai/vibelang",
  commit: "13ddcadff0e43dfda63ae56ee224d999c7239ec1",
  branch: "main",
  generatedAt: "2026-11-27T07:45:00.000Z",
  executionTrust: "trusted-sandbox",
  cachePolicy: "read-write-trunk",
  cacheEndpoint: "https://build.smithers.sh",
  factoryUrl: "https://smithers.sh/smithersai/vibelang/-/factory",
  wikiUrl: "https://smithers.sh/smithersai/vibelang/-/wiki",
  mcpEndpoint: "https://smithers.sh/smithersai/vibelang/mcp",
  compilerVersion: "0.0.14",
  buildTargets: 5709
}

test("scoreBand classifies Lighthouse bands accurately", () => {
  assert.equal(scoreBand(100), "pass")
  assert.equal(scoreBand(90), "pass")
  assert.equal(scoreBand(89), "average")
  assert.equal(scoreBand(50), "average")
  assert.equal(scoreBand(49), "fail")
  assert.equal(scoreBand(0), "fail")
})

test("buildAuditSummary computes overall score, opportunities, and regressions", () => {
  const summary = buildAuditSummary(sampleReport, sampleProvenance)
  assert.equal(summary.overallScore, 65)
  assert.equal(summary.categories.length, 3)
  assert.equal(summary.categories[0].band, "pass")
  assert.equal(summary.categories[1].band, "average")
  assert.equal(summary.categories[2].band, "fail")
  assert.equal(summary.regressions.length, 1)
  assert.equal(summary.regressions[0].metric, "skill-bytes")
  assert.ok(summary.topOpportunities.length >= 2)
})

test("renderLighthouseHtml escapes untrusted strings and renders gauges + trust provenance", () => {
  const html = renderLighthouseHtml(sampleReport, sampleProvenance)
  assert.ok(html.startsWith("<!DOCTYPE html>"))
  assert.ok(html.includes("Trusted Controlled Sandbox"))
  assert.ok(html.includes("read-write-trunk"))
  assert.ok(html.includes("https://build.smithers.sh"))
  assert.ok(html.includes("lh-gauge--pass"))
  assert.ok(html.includes("lh-gauge--average"))
  assert.ok(html.includes("lh-gauge--fail"))
  assert.ok(!html.includes("<script>alert(1)</script>"), "must HTML-escape notes")
  assert.ok(html.includes(escapeHtml("<script>alert(1)</script>")))
})

test("renderLighthouseHtml distinguishes untrusted contributor runs clearly", () => {
  const untrustedHtml = renderLighthouseHtml(sampleReport, {
    ...sampleProvenance,
    executionTrust: "untrusted-contributor",
    cachePolicy: "read-only-namespaced"
  })
  assert.ok(untrustedHtml.includes("Untrusted Contributor Execution"))
  assert.ok(untrustedHtml.includes("read-only-namespaced"))
  assert.ok(untrustedHtml.includes("trust-untrusted"))
})

test("renderMarkdownSummary emits scoreboard, regressions, and opportunities", () => {
  const summary = buildAuditSummary(sampleReport, sampleProvenance)
  const md = renderMarkdownSummary(summary)
  assert.ok(md.includes("## VibeLang Lighthouse Backpressure Audit (65/100)"))
  assert.ok(md.includes("| Correctness | **94** |"))
  assert.ok(md.includes("### Regressions since baseline"))
  assert.ok(md.includes("### Top Opportunities"))
})

test("renderLighthouseHtml handles boolean check values from real Uphill JSON", () => {
  const boolReport = {
    version: 1,
    categories: [
      {
        name: "style",
        title: "Style",
        score: 100,
        metrics: [
          {
            name: "go-fmt",
            title: "Go fmt",
            value: true,
            target: true,
            score: 100,
            items: [{ name: "typescript/tsc/internal/vibelang", value: true, target: true }]
          }
        ]
      }
    ]
  }
  const html = renderLighthouseHtml(boolReport, sampleProvenance)
  assert.ok(html.includes(">pass<"))
})

test("renderLighthouseHtml normalizes Uphill value/change/before/after fields and renders gates", () => {
  const realShapeReport = {
    version: 1,
    categories: [
      {
        name: "footprint",
        title: "Footprint",
        score: 70,
        metrics: [{ name: "skill-bytes", title: "Skill bytes", unit: "B", value: 22080, target: 18000, score: 71 }]
      }
    ],
    opportunities: [
      { category: "testing", metric: "go-unit-tests", item: "typescript/tsc/internal/vibelangprotocol", items: 1, value: 0, target: 50, gain: 29 },
      { category: "testing", metric: "pkg-test-files", item: null, items: 3, value: 3, target: 10, gain: 9 }
    ],
    changes: [
      { category: "footprint", metric: "skill-bytes", item: null, change: "worse", before: 21930, after: 22080 },
      { category: "documentation", metric: "go-doc-coverage", item: "vibelangestree", change: "better", before: 40, after: 100 }
    ]
  }
  const provWithGates = {
    ...sampleProvenance,
    gates: [
      { name: "Declarative Factory Projection", status: "pass", detail: "Matches FACTORY.ts" },
      { name: "Uphill Baseline Guard", status: "fail", detail: "1 regression" }
    ]
  }
  const summary = buildAuditSummary(realShapeReport, provWithGates)
  assert.equal(summary.topOpportunities[0].summary, "0 -> 50")
  assert.equal(summary.topOpportunities[1].summary, "3 -> 10 (3 items)")
  assert.equal(summary.regressions.length, 1)
  assert.equal(summary.regressions[0].baseline, "21.9 kB")
  assert.equal(summary.regressions[0].current, "22.1 kB")
  const html = renderLighthouseHtml(realShapeReport, provWithGates)
  assert.ok(html.includes("Backpressure Gates"))
  assert.ok(html.includes("Declarative Factory Projection"))
  assert.ok(html.includes("Improvements Since Baseline (1)"))
  assert.ok(html.includes("Regressions Since Baseline (1)"))
  assert.ok(html.includes("0 -> 50"))
  assert.ok(html.includes("toggle-all"))
  assert.ok(html.includes("lh-kpi-strip"))
  assert.ok(html.includes("lh-jumpbar"))
  assert.ok(html.includes("copy-markdown"))
  assert.ok(html.includes("print-report"))
  assert.ok(html.includes('id="audit-md-data"'))
  assert.ok(html.includes("lh-copy-cmd"))
  assert.ok(html.includes("go test -v ./internal/vibelangprotocol/..."))
})

test("resolveExecutionTrust enforces untrusted PR isolation and trusted main separation", () => {
  assert.deepEqual(
    resolveExecutionTrust({
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "smithersai/vibelang",
      GITHUB_EVENT_NAME: "pull_request",
      SMITHERS_CACHE_READ_TOKEN: "r",
      SMITHERS_CACHE_WRITE_TOKEN: "should-be-ignored-on-pr"
    }),
    { executionTrust: "untrusted-contributor", cachePolicy: "read-only-namespaced" }
  )
  assert.deepEqual(
    resolveExecutionTrust({
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "smithersai/vibelang",
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/heads/main",
      SMITHERS_CACHE_WRITE_TOKEN: "w"
    }),
    { executionTrust: "trusted-sandbox", cachePolicy: "read-write-trunk" }
  )
  assert.deepEqual(
    resolveExecutionTrust({
      SMITHERS_SANDBOX: "1",
      SMITHERS_CACHE_READ_TOKEN: "r"
    }),
    { executionTrust: "trusted-sandbox", cachePolicy: "read-only-namespaced" }
  )
})
