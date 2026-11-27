/**
 * Renders a self-contained, Chrome-Lighthouse-inspired Backpressure Audit Report
 * (HTML + structured JSON) from Uphill's `.uphill/report.json` plus Smithers Cloud
 * execution provenance and repository metadata.
 *
 * Pure and dependency-free so it runs identically locally, in GitHub Actions,
 * and inside Smithers Cloud job sandboxes.
 */

export interface UphillItem {
  readonly name: string
  readonly value: number | string
  readonly target?: number | string | null
  readonly baseline?: number | string | null
  readonly score?: number | null
  readonly note?: string | null
}

export interface UphillMetric {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly kind?: string
  readonly unit?: string | null
  readonly value?: number | string | null
  readonly item?: string | null
  readonly score?: number | null
  readonly target?: number | string | null
  readonly baseline?: number | string | null
  readonly note?: string | null
  readonly better?: "lower" | "higher" | string | null
  readonly weight?: number
  readonly items?: ReadonlyArray<UphillItem>
}

export interface UphillCategory {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly score: number
  readonly metrics: ReadonlyArray<UphillMetric>
}

export interface UphillOpportunity {
  readonly category: string
  readonly metric: string
  readonly item?: string | null
  readonly items?: number | null
  readonly gain: number
  readonly current?: number | boolean | string | null
  readonly value?: number | boolean | string | null
  readonly target?: number | boolean | string | null
  readonly note?: string | null
}

export interface UphillDelta {
  readonly direction?: "worse" | "better" | string
  readonly change?: "worse" | "better" | "new" | string
  readonly category: string
  readonly metric: string
  readonly item?: string | null
  readonly baseline?: number | boolean | string | null
  readonly current?: number | boolean | string | null
  readonly before?: number | boolean | string | null
  readonly after?: number | boolean | string | null
}

export interface BackpressureGate {
  readonly name: string
  readonly status: "pass" | "average" | "fail"
  readonly detail: string
}

export interface UphillReport {
  readonly version?: number
  readonly categories: ReadonlyArray<UphillCategory>
  readonly opportunities?: ReadonlyArray<UphillOpportunity>
  readonly changes?: ReadonlyArray<UphillDelta>
}

export type ExecutionTrust = "trusted-sandbox" | "maintainer" | "untrusted-contributor"
export type CachePolicy = "read-write-trunk" | "read-only-namespaced" | "local-only"

export interface AuditProvenance {
  readonly repository: string
  readonly commit: string
  readonly branch: string
  readonly generatedAt: string
  readonly executionTrust: ExecutionTrust
  readonly cachePolicy: CachePolicy
  readonly cacheEndpoint: string
  readonly factoryUrl: string
  readonly wikiUrl: string
  readonly mcpEndpoint: string
  readonly compilerVersion?: string
  readonly buildTargets?: number
  readonly gates?: ReadonlyArray<BackpressureGate>
}

export interface LighthouseAuditSummary {
  readonly version: 1
  readonly repository: string
  readonly commit: string
  readonly branch: string
  readonly generatedAt: string
  readonly overallScore: number
  readonly executionTrust: ExecutionTrust
  readonly cachePolicy: CachePolicy
  readonly cacheEndpoint: string
  readonly categories: ReadonlyArray<{
    readonly name: string
    readonly title: string
    readonly score: number
    readonly band: "pass" | "average" | "fail"
    readonly passedCount: number
    readonly totalCount: number
  }>
  readonly topOpportunities: ReadonlyArray<{
    readonly category: string
    readonly metric: string
    readonly item: string | null
    readonly gain: number
    readonly summary: string
  }>
  readonly regressions: ReadonlyArray<{
    readonly category: string
    readonly metric: string
    readonly item: string | null
    readonly baseline: string
    readonly current: string
  }>
}

export function scoreBand(score: number): "pass" | "average" | "fail" {
  if (score >= 90) return "pass"
  if (score >= 50) return "average"
  return "fail"
}

export function escapeHtml(input: unknown): string {
  return String(input ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function formatValue(val: unknown, unit?: string | null): string {
  if (val === null || val === undefined) return "-"
  if (typeof val === "boolean") return val ? "pass" : "fail"
  if (typeof val === "string") return val
  if (typeof val !== "number" || !Number.isFinite(val)) return String(val)
  if (unit === "bytes" || unit === "B") {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)} MB`
    if (val >= 1_000) return `${(val / 1_000).toFixed(1)} kB`
    return `${val} B`
  }
  if (unit === "%" || unit === "percent") return `${val}%`
  if (Number.isInteger(val)) return val.toLocaleString("en-US")
  return String(Number(val.toFixed(2)))
}

function metricStatus(metric: UphillMetric): "pass" | "average" | "fail" {
  if (typeof metric.score === "number") return scoreBand(metric.score)
  if (metric.value === "pass" || (metric.value as unknown) === true) return "pass"
  if (metric.value === "fail" || (metric.value as unknown) === false) return "fail"
  return "average"
}

function computeOpportunities(report: UphillReport): ReadonlyArray<UphillOpportunity> {
  if (Array.isArray(report.opportunities) && report.opportunities.length > 0) {
    return [...report.opportunities].sort((a, b) => b.gain - a.gain)
  }
  const derived: UphillOpportunity[] = []
  for (const cat of report.categories) {
    const totalWeight = cat.metrics.reduce((sum, m) => sum + (m.weight ?? 1), 0) || 1
    for (const metric of cat.metrics) {
      const score = typeof metric.score === "number" ? metric.score : metric.value === "pass" ? 100 : 0
      if (score >= 95) continue
      const weight = metric.weight ?? 1
      const gain = Math.max(1, Math.round(((100 - score) * weight) / totalWeight))
      derived.push({
        category: cat.name,
        metric: metric.name,
        item: metric.item ?? null,
        gain,
        current: metric.value ?? null,
        target: metric.target ?? null,
        note: metric.note ?? null
      })
    }
  }
  return derived.sort((a, b) => b.gain - a.gain).slice(0, 12)
}

function normalizeOppValue(opp: UphillOpportunity): number | boolean | string | null {
  if (opp.current !== undefined && opp.current !== null) return opp.current
  if (opp.value !== undefined && opp.value !== null) return opp.value
  return null
}

function normalizeDeltaKind(delta: UphillDelta): string {
  return delta.change ?? delta.direction ?? ""
}

function normalizeDeltaBefore(delta: UphillDelta): string {
  const raw = delta.before !== undefined ? delta.before : delta.baseline
  return formatValue(raw)
}

function normalizeDeltaAfter(delta: UphillDelta): string {
  const raw = delta.after !== undefined ? delta.after : delta.current
  return formatValue(raw)
}

function findMetricUnit(report: UphillReport, category: string, metric: string): string | null | undefined {
  const cat = report.categories.find((c) => c.name === category)
  const m = cat?.metrics.find((x) => x.name === metric)
  return m?.unit
}

export function buildAuditSummary(
  report: UphillReport,
  provenance: AuditProvenance
): LighthouseAuditSummary {
  const cats = report.categories.map((cat) => {
    const totalCount = cat.metrics.length
    const passedCount = cat.metrics.filter((m) => metricStatus(m) === "pass").length
    return {
      name: cat.name,
      title: cat.title ?? cat.name,
      score: Math.round(cat.score),
      band: scoreBand(cat.score),
      passedCount,
      totalCount
    }
  })

  const overallScore =
    cats.length === 0 ? 0 : Math.round(cats.reduce((sum, c) => sum + c.score, 0) / cats.length)

  const opportunities = computeOpportunities(report).slice(0, 8).map((opp) => {
    const unit = findMetricUnit(report, opp.category, opp.metric)
    const cur = normalizeOppValue(opp)
    const tgt = opp.target
    const scopeSuffix = !opp.item && typeof opp.items === "number" && opp.items > 1 ? ` (${opp.items} items)` : ""
    return {
      category: opp.category,
      metric: opp.metric,
      item: opp.item ?? null,
      gain: Math.round(opp.gain),
      summary:
        cur !== null && tgt !== undefined && tgt !== null
          ? `${formatValue(cur, unit)} -> ${formatValue(tgt, unit)}${scopeSuffix}`
          : opp.note ?? "Improve metric toward target"
    }
  })

  const regressions = (report.changes ?? [])
    .filter((c) => normalizeDeltaKind(c) === "worse")
    .map((c) => {
      const unit = findMetricUnit(report, c.category, c.metric)
      return {
        category: c.category,
        metric: c.metric,
        item: c.item ?? null,
        baseline: formatValue(c.before !== undefined ? c.before : c.baseline, unit),
        current: formatValue(c.after !== undefined ? c.after : c.current, unit)
      }
    })

  return {
    version: 1,
    repository: provenance.repository,
    commit: provenance.commit,
    branch: provenance.branch,
    generatedAt: provenance.generatedAt,
    overallScore,
    executionTrust: provenance.executionTrust,
    cachePolicy: provenance.cachePolicy,
    cacheEndpoint: provenance.cacheEndpoint,
    categories: cats,
    topOpportunities: opportunities,
    regressions
  }
}

export function renderMarkdownSummary(summary: LighthouseAuditSummary): string {
  const bandIcon = (band: "pass" | "average" | "fail") =>
    band === "pass" ? "🟢" : band === "average" ? "🟠" : "🔴"
  const trustLabel =
    summary.executionTrust === "trusted-sandbox"
      ? "Trusted Controlled Sandbox"
      : summary.executionTrust === "maintainer"
        ? "Trusted Maintainer Run"
        : "Untrusted Contributor Run (read-only cache, non-gating)"

  const lines: string[] = [
    `## VibeLang Lighthouse Backpressure Audit (${summary.overallScore}/100)`,
    "",
    `- **Repository**: \`${summary.repository}\` @ \`${summary.commit.slice(0, 12)}\` (\`${summary.branch}\`)`,
    `- **Execution Trust**: ${trustLabel}`,
    `- **Shared Cache Policy**: \`${summary.cachePolicy}\` (\`${summary.cacheEndpoint}\`)`,
    "",
    "| Category | Score | Passed Audits | Status |",
    "| --- | ---: | ---: | --- |"
  ]
  for (const cat of summary.categories) {
    lines.push(
      `| ${cat.title} | **${cat.score}** | ${cat.passedCount}/${cat.totalCount} | ${bandIcon(cat.band)} ${cat.band} |`
    )
  }
  if (summary.regressions.length > 0) {
    lines.push("", "### Regressions since baseline")
    for (const reg of summary.regressions) {
      const target = reg.item ? `${reg.metric} (${reg.item})` : reg.metric
      lines.push(`- 🔴 **${reg.category}** \`${target}\`: ${reg.baseline} -> ${reg.current}`)
    }
  }
  if (summary.topOpportunities.length > 0) {
    lines.push("", "### Top Opportunities")
    for (const opp of summary.topOpportunities.slice(0, 5)) {
      const target = opp.item ? `${opp.metric} (${opp.item})` : opp.metric
      lines.push(`- **+${opp.gain} pts** [${opp.category}] \`${target}\`: ${opp.summary}`)
    }
  }
  lines.push("")
  return lines.join("\n")
}

function renderGaugeSvg(score: number, size = 96): string {
  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  const band = scoreBand(clamped)
  const r = 40
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - clamped / 100)
  return `<svg class="lh-gauge lh-gauge--${band}" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="Score ${clamped} out of 100">
  <circle class="lh-gauge__bg" cx="50" cy="50" r="${r}" />
  <circle class="lh-gauge__arc" cx="50" cy="50" r="${r}" stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 50 50)" />
  <text class="lh-gauge__text" x="50" y="55" text-anchor="middle">${clamped}</text>
</svg>`
}

function renderStatusGlyph(band: "pass" | "average" | "fail"): string {
  if (band === "pass") return `<span class="lh-glyph lh-glyph--pass" aria-label="Pass"></span>`
  if (band === "average") return `<span class="lh-glyph lh-glyph--average" aria-label="Needs improvement"></span>`
  return `<span class="lh-glyph lh-glyph--fail" aria-label="Fail"></span>`
}

export function renderLighthouseHtml(
  report: UphillReport,
  provenance: AuditProvenance
): string {
  const summary = buildAuditSummary(report, provenance)
  const opportunities = computeOpportunities(report)
  const regressions = (report.changes ?? []).filter((c) => normalizeDeltaKind(c) === "worse")
  const improvements = (report.changes ?? []).filter((c) => normalizeDeltaKind(c) === "better")

  const trustMeta =
    provenance.executionTrust === "trusted-sandbox"
      ? {
          cls: "trust-trusted",
          title: "Trusted Controlled Sandbox",
          detail: "Verified inside a Smithers Cloud controlled sandbox. Eligible for trunk cache publication and merge gates."
        }
      : provenance.executionTrust === "maintainer"
        ? {
            cls: "trust-trusted",
            title: "Maintainer Verified Execution",
            detail: "Executed by a repository maintainer. Eligible for shared cache reads and gate verification."
          }
        : {
            cls: "trust-untrusted",
            title: "Untrusted Contributor Execution",
            detail: "Encouraged for fast local and PR feedback. Read-only shared cache hits only; isolated from trunk cache writes and merge gates."
          }

  const gaugeCards = summary.categories
    .map(
      (cat) => `
      <a class="lh-score-card" href="#cat-${escapeHtml(cat.name)}" data-band="${cat.band}">
        ${renderGaugeSvg(cat.score, 92)}
        <div class="lh-score-card__label">${escapeHtml(cat.title)}</div>
        <div class="lh-score-card__sub">${cat.passedCount}/${cat.totalCount} passed</div>
      </a>`
    )
    .join("\n")

  const gatesHtml =
    !provenance.gates || provenance.gates.length === 0
      ? ""
      : `
    <section class="lh-section" id="gates">
      <div class="lh-section__head">
        <h2>Backpressure Gates</h2>
        <span class="lh-pill">${provenance.gates.filter((g) => g.status === "pass").length}/${provenance.gates.length} passing</span>
      </div>
      <div class="lh-gates-grid">
        ${provenance.gates
          .map(
            (gate) => `
        <div class="lh-gate-card lh-gate-card--${gate.status}">
          <div class="lh-gate-card__head">
            ${renderStatusGlyph(gate.status)}
            <strong>${escapeHtml(gate.name)}</strong>
          </div>
          <div class="lh-gate-card__detail">${escapeHtml(gate.detail)}</div>
        </div>`
          )
          .join("\n")}
      </div>
    </section>`

  const opportunitiesHtml =
    opportunities.length === 0
      ? `<div class="lh-empty">All audited metrics meet their targets. Zero open opportunities.</div>`
      : opportunities
          .map((opp) => {
            const barWidth = Math.max(8, Math.min(100, opp.gain * 3))
            const unit = findMetricUnit(report, opp.category, opp.metric)
            const cur = normalizeOppValue(opp)
            const label = opp.item
              ? `${opp.metric} (${opp.item})`
              : typeof opp.items === "number" && opp.items > 1
                ? `${opp.metric} (${opp.items} targets)`
                : opp.metric
            const delta =
              cur !== null && opp.target !== null && opp.target !== undefined
                ? `${escapeHtml(formatValue(cur, unit))} -> ${escapeHtml(formatValue(opp.target, unit))}`
                : escapeHtml(opp.note ?? "Target improvement")
            return `
        <div class="lh-opp-row" data-audit-kind="opportunity" data-search="${escapeHtml(`${opp.category} ${label} ${opp.note ?? ""}`).toLowerCase()}">
          <div class="lh-opp-row__main">
            <span class="lh-pill lh-pill--cat">${escapeHtml(opp.category)}</span>
            <span class="lh-opp-row__name">${escapeHtml(label)}</span>
            <span class="lh-opp-row__delta">${delta}</span>
          </div>
          <div class="lh-opp-row__bar-wrap">
            <div class="lh-opp-row__track"><div class="lh-opp-row__bar" style="width:${barWidth}%"></div></div>
            <span class="lh-opp-row__gain">+${Math.round(opp.gain)} pts</span>
          </div>
        </div>`
          })
          .join("\n")

  const regressionsHtml =
    regressions.length === 0
      ? ""
      : `
    <section class="lh-section lh-section--regressions" id="regressions">
      <div class="lh-section__head">
        <h2>Regressions Since Baseline (${regressions.length})</h2>
        <span class="lh-badge lh-badge--fail">Action required</span>
      </div>
      <div class="lh-reg-list">
        ${regressions
          .map((r) => {
            const label = r.item ? `${r.metric} (${r.item})` : r.metric
            const unit = findMetricUnit(report, r.category, r.metric)
            const before = formatValue(r.before !== undefined ? r.before : r.baseline, unit)
            const after = formatValue(r.after !== undefined ? r.after : r.current, unit)
            return `<div class="lh-reg-row" data-audit-kind="regression" data-search="${escapeHtml(`${r.category} ${label}`).toLowerCase()}">
              ${renderStatusGlyph("fail")}
              <span class="lh-pill lh-pill--cat">${escapeHtml(r.category)}</span>
              <strong>${escapeHtml(label)}</strong>
              <span class="lh-mono">${escapeHtml(before)} -> ${escapeHtml(after)}</span>
            </div>`
          })
          .join("\n")}
      </div>
    </section>`

  const improvementsHtml =
    improvements.length === 0
      ? ""
      : `
    <section class="lh-section lh-section--improvements" id="improvements">
      <div class="lh-section__head">
        <h2>Improvements Since Baseline (${improvements.length})</h2>
        <span class="lh-badge lh-badge--pass">Uphill progress</span>
      </div>
      <div class="lh-reg-list">
        ${improvements
          .map((r) => {
            const label = r.item ? `${r.metric} (${r.item})` : r.metric
            const unit = findMetricUnit(report, r.category, r.metric)
            const before = formatValue(r.before !== undefined ? r.before : r.baseline, unit)
            const after = formatValue(r.after !== undefined ? r.after : r.current, unit)
            return `<div class="lh-reg-row" data-audit-kind="improvement" data-search="${escapeHtml(`${r.category} ${label}`).toLowerCase()}">
              ${renderStatusGlyph("pass")}
              <span class="lh-pill lh-pill--cat">${escapeHtml(r.category)}</span>
              <strong>${escapeHtml(label)}</strong>
              <span class="lh-mono">${escapeHtml(before)} -> ${escapeHtml(after)}</span>
            </div>`
          })
          .join("\n")}
      </div>
    </section>`

  const categoriesHtml = report.categories
    .map((cat) => {
      const band = scoreBand(cat.score)
      const metricsHtml = cat.metrics
        .map((m) => {
          const mBand = metricStatus(m)
          const mTitle = m.title ?? m.name
          const currentDisplay = formatValue(m.value, m.unit)
          const isInfoMetric = m.score === null && (m.target === null || m.target === undefined)
          const targetDisplay = isInfoMetric
            ? "tripwire"
            : m.target !== null && m.target !== undefined
              ? `target: ${formatValue(m.target, m.unit)}`
              : "target: pass"
          const scoreChip =
            typeof m.score === "number"
              ? `<span class="lh-score-chip lh-score-chip--${mBand}">${Math.round(m.score)}</span>`
              : `<span class="lh-score-chip lh-score-chip--info">info</span>`
          const items = m.items ?? []
          const itemRows =
            items.length === 0
              ? ""
              : `<table class="lh-items-table">
                  <thead><tr><th>Target / Package</th><th>Measured</th><th>Target</th><th>Note</th></tr></thead>
                  <tbody>
                    ${items
                      .map(
                        (it) => `<tr>
                        <td class="lh-mono">${escapeHtml(it.name)}</td>
                        <td class="lh-mono">${escapeHtml(formatValue(it.value, m.unit))}</td>
                        <td class="lh-mono">${escapeHtml(it.target !== null && it.target !== undefined ? formatValue(it.target, m.unit) : targetDisplay)}</td>
                        <td>${escapeHtml(it.note ?? "")}</td>
                      </tr>`
                      )
                      .join("\n")}
                  </tbody>
                </table>`
          const searchHaystack = `${cat.name} ${m.name} ${mTitle} ${m.description ?? ""} ${m.note ?? ""} ${items.map((i) => `${i.name} ${i.note ?? ""}`).join(" ")}`.toLowerCase()
          return `
          <details class="lh-audit lh-audit--${mBand}" data-audit-band="${mBand}" data-search="${escapeHtml(searchHaystack)}" ${mBand === "fail" ? "open" : ""}>
            <summary class="lh-audit__summary">
              <div class="lh-audit__left">
                ${renderStatusGlyph(mBand)}
                <span class="lh-audit__title">${escapeHtml(mTitle)}</span>
                <span class="lh-audit__code lh-mono">${escapeHtml(m.name)}</span>
              </div>
              <div class="lh-audit__right">
                <span class="lh-audit__value lh-mono">${escapeHtml(currentDisplay)}</span>
                <span class="lh-audit__target">${escapeHtml(targetDisplay)}</span>
                ${scoreChip}
              </div>
            </summary>
            <div class="lh-audit__body">
              ${m.description ? `<p class="lh-audit__desc">${escapeHtml(m.description)}</p>` : ""}
              ${m.note ? `<div class="lh-audit__note lh-mono">${escapeHtml(m.note)}</div>` : ""}
              ${itemRows}
            </div>
          </details>`
        })
        .join("\n")

      return `
      <section class="lh-section lh-category" id="cat-${escapeHtml(cat.name)}">
        <div class="lh-category__head">
          <div class="lh-category__title-wrap">
            ${renderGaugeSvg(cat.score, 60)}
            <div>
              <h2>${escapeHtml(cat.title ?? cat.name)}</h2>
              ${cat.description ? `<p class="lh-category__desc">${escapeHtml(cat.description)}</p>` : ""}
            </div>
          </div>
          <span class="lh-badge lh-badge--${band}">${Math.round(cat.score)} / 100</span>
        </div>
        <div class="lh-audit-list">
          ${metricsHtml}
        </div>
      </section>`
    })
    .join("\n")

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(provenance.repository)} Backpressure Audit Report</title>
<style>
  :root {
    --bg: #f8f9fa;
    --surface: #ffffff;
    --surface-2: #f1f3f4;
    --border: #dadce0;
    --text: #202124;
    --muted: #5f6368;
    --pass: #008800;
    --pass-ring: #0cce6b;
    --pass-bg: #e6f4ea;
    --avg: #b06000;
    --avg-ring: #ffa400;
    --avg-bg: #fef7e0;
    --fail: #c7221f;
    --fail-ring: #ff4e42;
    --fail-bg: #fce8e6;
    --accent: #1a73e8;
    --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
  }
  [data-theme="dark"] {
    --bg: #111317;
    --surface: #181b21;
    --surface-2: #20242c;
    --border: #2d333d;
    --text: #e8eaed;
    --muted: #9aa0a6;
    --pass: #6dd58c;
    --pass-ring: #0cce6b;
    --pass-bg: rgba(12, 206, 107, 0.14);
    --avg: #ffb74d;
    --avg-ring: #ffa400;
    --avg-bg: rgba(255, 164, 0, 0.14);
    --fail: #ff8a80;
    --fail-ring: #ff4e42;
    --fail-bg: rgba(255, 78, 66, 0.14);
    --accent: #8ab4f8;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: var(--sans);
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
  }
  .lh-topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 12px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .lh-brand { display: flex; align-items: center; gap: 12px; }
  .lh-brand__mark {
    width: 32px; height: 32px; border-radius: 8px;
    background: linear-gradient(135deg, #0cce6b, #1a73e8);
    display: grid; place-items: center; color: #fff; font-weight: 800; font-size: 15px;
  }
  .lh-brand__title { font-weight: 700; font-size: 15px; }
  .lh-brand__sub { font-size: 12px; color: var(--muted); font-family: var(--mono); }
  .lh-nav { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .lh-nav a, .lh-btn {
    font-size: 13px; color: var(--accent); text-decoration: none;
    padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border);
    background: var(--surface); cursor: pointer; font-family: inherit;
  }
  .lh-nav a:hover, .lh-btn:hover { background: var(--surface-2); }
  .lh-wrap { max-width: 1120px; margin: 0 auto; padding: 24px 20px 64px; }
  .lh-hero {
    background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
    padding: 24px; margin-bottom: 20px;
  }
  .lh-hero__top {
    display: flex; align-items: center; justify-content: space-between;
    gap: 20px; flex-wrap: wrap; padding-bottom: 20px; border-bottom: 1px solid var(--border);
  }
  .lh-hero__meta h1 { margin: 0 0 6px; font-size: 22px; }
  .lh-hero__facts { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12.5px; color: var(--muted); }
  .lh-mono { font-family: var(--mono); }
  .lh-gauges {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
    gap: 14px;
    padding-top: 20px;
  }
  .lh-score-card {
    display: flex; flex-direction: column; align-items: center; text-decoration: none;
    color: var(--text); padding: 14px 10px; border-radius: 10px;
    border: 1px solid transparent; transition: background 0.15s, border-color 0.15s;
  }
  .lh-score-card:hover { background: var(--surface-2); border-color: var(--border); }
  .lh-score-card__label { font-weight: 600; font-size: 14px; margin-top: 8px; text-align: center; }
  .lh-score-card__sub { font-size: 12px; color: var(--muted); }
  .lh-gauge__bg { fill: none; stroke: var(--surface-2); stroke-width: 8; }
  .lh-gauge__arc { fill: none; stroke-width: 8; stroke-linecap: round; transition: stroke-dashoffset 0.5s ease; }
  .lh-gauge--pass .lh-gauge__arc { stroke: var(--pass-ring); }
  .lh-gauge--pass .lh-gauge__text { fill: var(--pass); }
  .lh-gauge--average .lh-gauge__arc { stroke: var(--avg-ring); }
  .lh-gauge--average .lh-gauge__text { fill: var(--avg); }
  .lh-gauge--fail .lh-gauge__arc { stroke: var(--fail-ring); }
  .lh-gauge--fail .lh-gauge__text { fill: var(--fail); }
  .lh-gauge__text { font-family: var(--mono); font-size: 26px; font-weight: 700; }
  .lh-legend {
    display: flex; justify-content: center; gap: 20px; margin-top: 14px;
    font-size: 12px; color: var(--muted); flex-wrap: wrap;
  }
  .lh-legend span { display: inline-flex; align-items: center; gap: 6px; }
  .lh-glyph { display: inline-block; flex-shrink: 0; }
  .lh-glyph--pass { width: 10px; height: 10px; border-radius: 50%; background: var(--pass-ring); }
  .lh-glyph--average { width: 10px; height: 10px; border-radius: 2px; background: var(--avg-ring); }
  .lh-glyph--fail {
    width: 0; height: 0;
    border-left: 6px solid transparent; border-right: 6px solid transparent;
    border-bottom: 10px solid var(--fail-ring);
  }
  .lh-trust {
    border-radius: 12px; padding: 14px 18px; margin-bottom: 20px;
    border: 1px solid var(--border); display: flex; justify-content: space-between;
    align-items: center; gap: 16px; flex-wrap: wrap;
  }
  .trust-trusted { background: var(--pass-bg); border-color: var(--pass-ring); }
  .trust-untrusted { background: var(--avg-bg); border-color: var(--avg-ring); }
  .lh-trust__title { font-weight: 700; font-size: 14px; }
  .lh-trust__detail { font-size: 13px; color: var(--text); opacity: 0.9; }
  .lh-controls {
    display: flex; justify-content: space-between; align-items: center;
    gap: 12px; flex-wrap: wrap; margin-bottom: 18px;
  }
  .lh-filters { display: flex; gap: 8px; flex-wrap: wrap; }
  .lh-filter {
    padding: 6px 12px; border-radius: 999px; border: 1px solid var(--border);
    background: var(--surface); color: var(--text); font-size: 13px; cursor: pointer;
  }
  .lh-filter[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
  .lh-search {
    padding: 7px 12px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--surface); color: var(--text); font-size: 13px; min-width: 240px;
  }
  .lh-section {
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    padding: 20px; margin-bottom: 18px;
  }
  .lh-section__head, .lh-category__head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 14px; flex-wrap: wrap; margin-bottom: 14px;
  }
  .lh-category__title-wrap { display: flex; align-items: center; gap: 14px; }
  .lh-section h2 { margin: 0; font-size: 18px; }
  .lh-category__desc { margin: 3px 0 0; font-size: 13px; color: var(--muted); }
  .lh-badge {
    font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px;
    font-family: var(--mono);
  }
  .lh-badge--pass { background: var(--pass-bg); color: var(--pass); }
  .lh-badge--average { background: var(--avg-bg); color: var(--avg); }
  .lh-badge--fail { background: var(--fail-bg); color: var(--fail); }
  .lh-pill {
    font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
    background: var(--surface-2); color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em;
  }
  .lh-opp-row {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 10px 0; border-top: 1px solid var(--border); flex-wrap: wrap;
  }
  .lh-opp-row:first-child { border-top: none; }
  .lh-opp-row__main { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex: 1; }
  .lh-opp-row__name { font-weight: 600; font-size: 13.5px; }
  .lh-opp-row__delta { font-family: var(--mono); font-size: 12px; color: var(--muted); }
  .lh-opp-row__bar-wrap { display: flex; align-items: center; gap: 10px; width: 220px; flex-shrink: 0; }
  .lh-opp-row__track { flex: 1; height: 8px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
  .lh-opp-row__bar { height: 100%; border-radius: 4px; background: var(--avg-ring); }
  .lh-opp-row__gain { font-family: var(--mono); font-size: 12px; font-weight: 700; color: var(--avg); width: 58px; text-align: right; flex-shrink: 0; }
  .lh-reg-row {
    display: flex; align-items: center; gap: 10px; padding: 8px 0;
    border-top: 1px solid var(--border); flex-wrap: wrap; font-size: 13.5px;
  }
  .lh-reg-row:first-child { border-top: none; }
  .lh-audit {
    border-top: 1px solid var(--border);
  }
  .lh-audit__summary {
    list-style: none; cursor: pointer; padding: 12px 4px;
    display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  }
  .lh-audit__summary::-webkit-details-marker { display: none; }
  .lh-audit__left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .lh-audit__title { font-weight: 600; font-size: 14px; }
  .lh-audit__code { font-size: 12px; color: var(--muted); }
  .lh-audit__right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .lh-audit__value { font-size: 13px; font-weight: 600; }
  .lh-audit__target { font-size: 12px; color: var(--muted); }
  .lh-score-chip {
    font-family: var(--mono); font-size: 11.5px; font-weight: 700;
    padding: 2px 7px; border-radius: 6px; min-width: 38px; text-align: center;
  }
  .lh-score-chip--pass { background: var(--pass-bg); color: var(--pass); }
  .lh-score-chip--average { background: var(--avg-bg); color: var(--avg); }
  .lh-score-chip--fail { background: var(--fail-bg); color: var(--fail); }
  .lh-score-chip--info { background: var(--surface-2); color: var(--muted); }
  .lh-audit__body { padding: 0 4px 14px 24px; }
  .lh-audit__desc { margin: 0 0 8px; font-size: 13px; color: var(--muted); }
  .lh-audit__note {
    font-size: 12px; padding: 8px 10px; border-radius: 8px;
    background: var(--surface-2); margin-bottom: 10px; overflow-x: auto;
  }
  .lh-items-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .lh-items-table th, .lh-items-table td {
    text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border);
  }
  .lh-items-table th { color: var(--muted); font-weight: 600; background: var(--surface-2); }
  .lh-empty { font-size: 13.5px; color: var(--pass); padding: 8px 0; }
  .lh-hidden { display: none !important; }
  .lh-gates-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px;
  }
  .lh-gate-card {
    border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;
    background: var(--surface-2);
  }
  .lh-gate-card--pass { border-left: 3px solid var(--pass-ring); }
  .lh-gate-card--average { border-left: 3px solid var(--avg-ring); }
  .lh-gate-card--fail { border-left: 3px solid var(--fail-ring); }
  .lh-gate-card__head { display: flex; align-items: center; gap: 8px; font-size: 13.5px; margin-bottom: 4px; }
  .lh-gate-card__detail { font-size: 12px; color: var(--muted); }
  .lh-controls-right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .lh-footer { text-align: center; font-size: 12px; color: var(--muted); margin-top: 24px; }
  @media print {
    .lh-topbar, .lh-controls { display: none !important; }
    body { background: #fff; color: #000; }
    .lh-section, .lh-hero { break-inside: avoid; }
  }
</style>
</head>
<body>
<header class="lh-topbar">
  <div class="lh-brand">
    <div class="lh-brand__mark">VL</div>
    <div>
      <div class="lh-brand__title">${escapeHtml(provenance.repository)} Backpressure Audit</div>
      <div class="lh-brand__sub">${escapeHtml(provenance.branch)} @ ${escapeHtml(provenance.commit.slice(0, 12))} · ${escapeHtml(provenance.generatedAt)}</div>
    </div>
  </div>
  <nav class="lh-nav" aria-label="Smithers Cloud Links">
    <a href="${escapeHtml(provenance.factoryUrl)}" target="_blank" rel="noopener">Factory</a>
    <a href="${escapeHtml(provenance.wikiUrl)}" target="_blank" rel="noopener">Wiki</a>
    <a href="${escapeHtml(provenance.mcpEndpoint)}" target="_blank" rel="noopener">Cloud MCP</a>
    <button type="button" class="lh-btn" id="theme-toggle">Toggle theme</button>
  </nav>
</header>

<main class="lh-wrap">
  <section class="lh-hero">
    <div class="lh-hero__top">
      <div class="lh-hero__meta">
        <h1>Continuous Backpressure Audit Report</h1>
        <div class="lh-hero__facts">
          <span>Overall Score: <strong class="lh-mono">${summary.overallScore}/100</strong></span>
          ${provenance.compilerVersion ? `<span>Compiler: <strong class="lh-mono">v${escapeHtml(provenance.compilerVersion)}</strong></span>` : ""}
          ${provenance.buildTargets ? `<span>Build Graph: <strong class="lh-mono">${provenance.buildTargets.toLocaleString("en-US")} targets</strong></span>` : ""}
          <span>Object Store: <strong class="lh-mono">${escapeHtml(provenance.cacheEndpoint)}</strong></span>
        </div>
      </div>
      ${renderGaugeSvg(summary.overallScore, 104)}
    </div>
    <div class="lh-gauges">
      ${gaugeCards}
    </div>
    <div class="lh-legend">
      <span>${renderStatusGlyph("fail")} 0-49 Needs work</span>
      <span>${renderStatusGlyph("average")} 50-89 Improving</span>
      <span>${renderStatusGlyph("pass")} 90-100 Target met</span>
    </div>
  </section>

  <section class="lh-trust ${trustMeta.cls}" aria-label="Execution Trust Provenance">
    <div>
      <div class="lh-trust__title">${escapeHtml(trustMeta.title)}</div>
      <div class="lh-trust__detail">${escapeHtml(trustMeta.detail)}</div>
    </div>
    <span class="lh-pill lh-mono">${escapeHtml(provenance.cachePolicy)}</span>
  </section>

  ${gatesHtml}

  <div class="lh-controls">
    <div class="lh-filters" role="group" aria-label="Filter audits">
      <button type="button" class="lh-filter" data-filter="all" aria-pressed="true">All audits</button>
      <button type="button" class="lh-filter" data-filter="fail" aria-pressed="false">Failed / Missed</button>
      <button type="button" class="lh-filter" data-filter="average" aria-pressed="false">Improving</button>
      <button type="button" class="lh-filter" data-filter="pass" aria-pressed="false">Passed</button>
    </div>
    <div class="lh-controls-right">
      <button type="button" class="lh-btn" id="toggle-all">Expand all</button>
      <input type="search" class="lh-search" id="audit-search" placeholder="Filter metrics, packages, files..." aria-label="Filter audits" />
    </div>
  </div>

  ${regressionsHtml}
  ${improvementsHtml}

  <section class="lh-section" id="opportunities">
    <div class="lh-section__head">
      <h2>Top Opportunities</h2>
      <span class="lh-pill">Highest score impact first</span>
    </div>
    ${opportunitiesHtml}
  </section>

  ${categoriesHtml}

  <footer class="lh-footer">
    Generated by Smithers Cloud Backpressure Audit (Uphill + VibeLang) · Shared cache: ${escapeHtml(provenance.cacheEndpoint)}
  </footer>
</main>

<script>
(() => {
  const root = document.documentElement;
  const toggle = document.getElementById("theme-toggle");
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    root.setAttribute("data-theme", "dark");
  }
  toggle?.addEventListener("click", () => {
    root.setAttribute("data-theme", root.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  let activeFilter = "all";
  let query = "";
  const buttons = [...document.querySelectorAll(".lh-filter")];
  const audits = [...document.querySelectorAll(".lh-audit")];
  const opps = [...document.querySelectorAll(".lh-opp-row")];
  const search = document.getElementById("audit-search");

  function apply() {
    for (const el of audits) {
      const band = el.getAttribute("data-audit-band") || "";
      const hay = el.getAttribute("data-search") || "";
      const matchBand = activeFilter === "all" || band === activeFilter;
      const matchQuery = !query || hay.includes(query);
      el.classList.toggle("lh-hidden", !(matchBand && matchQuery));
    }
    for (const el of opps) {
      const hay = el.getAttribute("data-search") || "";
      el.classList.toggle("lh-hidden", Boolean(query && !hay.includes(query)));
    }
  }

  for (const btn of buttons) {
    btn.addEventListener("click", () => {
      activeFilter = btn.getAttribute("data-filter") || "all";
      for (const b of buttons) b.setAttribute("aria-pressed", String(b === btn));
      apply();
    });
  }
  search?.addEventListener("input", () => {
    query = (search.value || "").trim().toLowerCase();
    apply();
  });
  const toggleAll = document.getElementById("toggle-all");
  let allExpanded = false;
  toggleAll?.addEventListener("click", () => {
    allExpanded = !allExpanded;
    for (const el of audits) el.open = allExpanded;
    toggleAll.textContent = allExpanded ? "Collapse all" : "Expand all";
  });
})();
</script>
</body>
</html>
`
}
