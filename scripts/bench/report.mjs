#!/usr/bin/env node
// Aggregates vibelang-bench/v1 JSON results into a combined JSON report,
// Markdown summary table (with optional baseline diff), and self-contained HTML dashboard.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

function parseArgs(argv) {
  const opts = {
    resultsDir: "",
    files: [],
    baseline: "",
    noBaseline: false,
    jsonOut: "",
    mdOut: "",
    htmlOut: "",
    saveBaseline: "",
    print: false,
    failOnRegressionPct: 0
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--results-dir" && argv[i + 1]) { opts.resultsDir = path.resolve(argv[++i]); continue }
    if (arg === "--baseline" && argv[i + 1]) { opts.baseline = path.resolve(argv[++i]); continue }
    if (arg === "--no-baseline") { opts.noBaseline = true; continue }
    if (arg === "--json" && argv[i + 1]) { opts.jsonOut = path.resolve(argv[++i]); continue }
    if (arg === "--md" && argv[i + 1]) { opts.mdOut = path.resolve(argv[++i]); continue }
    if (arg === "--html" && argv[i + 1]) { opts.htmlOut = path.resolve(argv[++i]); continue }
    if (arg === "--save-baseline" && argv[i + 1]) { opts.saveBaseline = path.resolve(argv[++i]); continue }
    if (arg === "--print") { opts.print = true; continue }
    if (arg === "--fail-on-regression" && argv[i + 1]) { opts.failOnRegressionPct = Number(argv[++i]); continue }
    if (!arg.startsWith("--")) { opts.files.push(path.resolve(arg)); continue }
    throw new Error(`report.mjs: unknown or incomplete option ${arg}`)
  }
  return opts
}

function writeAtomic(filePath, content) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`
  writeFileSync(tmp, content)
  renameSync(tmp, filePath)
}

function fmtNum(v) {
  if (!Number.isFinite(v)) return "n/a"
  if (Math.abs(v) < 10) return v.toFixed(2)
  if (Math.abs(v) < 1000) return v.toFixed(1)
  return Math.round(v).toLocaleString("en-US")
}

function fmtBytes(b) {
  if (b === undefined || b === null) return "—"
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KiB`
  return `${(b / (1024 * 1024)).toFixed(2)} MiB`
}

function normalizeNs(bench) {
  if (typeof bench.nsPerOp === "number" && Number.isFinite(bench.nsPerOp)) return bench.nsPerOp
  if (bench.unit === "ns/op") return bench.value
  if (bench.unit === "us/op") return bench.value * 1e3
  if (bench.unit === "ms/op" || bench.unit === "ms") return bench.value * 1e6
  if (bench.unit === "s") return bench.value * 1e9
  return undefined
}

function compareMetric(current, baseline) {
  if (!baseline) return null
  const higherIsBetter = current.higherIsBetter === true || current.unit === "ops/s" || current.unit === "MB/s"
  const curNs = normalizeNs(current)
  const baseNs = normalizeNs(baseline)
  const cur = curNs !== undefined && baseNs !== undefined ? curNs : current.value
  const base = curNs !== undefined && baseNs !== undefined ? baseNs : baseline.value
  if (!Number.isFinite(cur) || !Number.isFinite(base) || base === 0) return null
  const deltaPct = ((cur - base) / base) * 100
  const isRegression = higherIsBetter ? deltaPct < -10 : deltaPct > 10
  const isImprovement = higherIsBetter ? deltaPct > 10 : deltaPct < -10
  return {
    baselineValue: baseline.value,
    baselineUnit: baseline.unit,
    deltaPct: Number(deltaPct.toFixed(2)),
    ratio: Number((cur / base).toFixed(3)),
    status: isRegression ? "regression" : isImprovement ? "improved" : "same"
  }
}

function renderMarkdown(report) {
  const lines = []
  lines.push("# VibeLang Performance Benchmarks")
  lines.push("")
  lines.push(`Generated: ${report.generatedAt} | Host: ${report.machine.cpu} (${report.machine.cores} cores, ${report.machine.platform}/${report.machine.arch}) | Suites: ${report.suites.length} | Benchmarks: ${report.summary.totalBenchmarks}`)
  if (report.baselinePath) {
    lines.push(`Baseline: \`${report.baselinePath}\` | Improved (>10%): ${report.summary.improved} | Regressed (>10%): ${report.summary.regressed}`)
  }
  lines.push("")

  const categoryOrder = ["go-compiler", "compiler-e2e", "runtime", "packages", "bundlers", "tooling", "editors"]
  const categories = [...new Set(report.suites.map((s) => s.category))]
    .sort((a, b) => {
      const ia = categoryOrder.indexOf(a)
      const ib = categoryOrder.indexOf(b)
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b)
    })

  for (const cat of categories) {
    lines.push(`## ${cat}`)
    lines.push("")
    for (const suite of report.suites.filter((s) => s.category === cat).sort((a, b) => a.suite.localeCompare(b.suite))) {
      lines.push(`### ${suite.suite}`)
      if (suite.description) lines.push(`_${suite.description}_`)
      lines.push("")
      const hasMem = suite.benchmarks.some((b) => b.bytesPerOp !== undefined)
      const hasDiff = suite.benchmarks.some((b) => b.diff != null)
      const headers = ["Benchmark", "Median", "Min", "P95", ...(hasMem ? ["B/op", "Allocs/op"] : []), ...(hasDiff ? ["vs Baseline"] : [])]
      const align = ["---", "---:", "---:", "---:", ...(hasMem ? ["---:", "---:"] : []), ...(hasDiff ? ["---:"] : [])]
      lines.push(`| ${headers.join(" | ")} |`)
      lines.push(`| ${align.join(" | ")} |`)
      for (const b of suite.benchmarks) {
        const diffText = b.diff
          ? `${b.diff.deltaPct > 0 ? "+" : ""}${b.diff.deltaPct.toFixed(1)}%${b.diff.status === "regression" ? " (REGRESSION)" : b.diff.status === "improved" ? " (faster)" : ""}`
          : "—"
        const cols = [
          `\`${b.name}\``,
          `${fmtNum(b.value)} ${b.unit}`,
          `${fmtNum(b.min)}`,
          `${fmtNum(b.p95)}`,
          ...(hasMem ? [fmtBytes(b.bytesPerOp), b.allocsPerOp !== undefined ? String(b.allocsPerOp) : "—"] : []),
          ...(hasDiff ? [diffText] : [])
        ]
        lines.push(`| ${cols.join(" | ")} |`)
      }
      lines.push("")
    }
  }
  return lines.join("\n")
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

function renderHtml(report) {
  const embedded = JSON.stringify(report).replaceAll("</script>", "<\\/script>")
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>VibeLang Performance Benchmarks</title>
<style>
  :root {
    --bg: #0b0e14; --panel: #131822; --panel-alt: #181f2c; --border: #252f42;
    --text: #e6ecf5; --muted: #93a1b7; --accent: #6aa6ff; --good: #34d399;
    --bad: #f87171; --warn: #fbbf24; --chip: #1c2536;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
  header { padding: 24px 32px; border-bottom: 1px solid var(--border); background: var(--panel); }
  h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: -0.02em; }
  .meta { color: var(--muted); font-size: 13px; }
  main { max-width: 1280px; margin: 0 auto; padding: 24px 32px 64px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 24px; }
  .kpi { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .kpi .label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
  .kpi .val { font-size: 26px; font-weight: 700; margin-top: 4px; }
  .controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 20px; }
  .pill { border: 1px solid var(--border); background: var(--chip); color: var(--text); padding: 6px 12px; border-radius: 999px; cursor: pointer; font-size: 13px; }
  .pill.active { background: var(--accent); color: #08111f; border-color: var(--accent); font-weight: 600; }
  input[type="search"] { margin-left: auto; background: var(--panel); border: 1px solid var(--border); color: var(--text); padding: 7px 12px; border-radius: 8px; width: 260px; font-size: 13px; }
  section.suite { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 18px; overflow: hidden; }
  .suite-head { display: flex; justify-content: space-between; align-items: baseline; padding: 14px 18px; background: var(--panel-alt); border-bottom: 1px solid var(--border); gap: 12px; flex-wrap: wrap; }
  .suite-head h2 { margin: 0; font-size: 16px; }
  .suite-head .cat { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; padding: 2px 8px; border-radius: 999px; background: var(--chip); color: var(--accent); border: 1px solid var(--border); }
  .suite-desc { color: var(--muted); font-size: 13px; padding: 8px 18px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 9px 14px; border-bottom: 1px solid var(--border); text-align: left; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: none; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; color: #dbeafe; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 6px; font-size: 12px; font-weight: 600; }
  .badge.improved { background: rgba(52, 211, 153, 0.16); color: var(--good); }
  .badge.regression { background: rgba(248, 113, 113, 0.16); color: var(--bad); }
  .badge.same { background: rgba(147, 161, 183, 0.12); color: var(--muted); }
  .bar-wrap { width: 110px; height: 6px; background: #1e293b; border-radius: 999px; overflow: hidden; display: inline-block; vertical-align: middle; margin-left: 8px; }
  .bar { height: 100%; background: var(--accent); border-radius: 999px; }
</style>
</head>
<body>
<header>
  <h1>VibeLang Performance Benchmarks</h1>
  <div class="meta">Generated ${escapeHtml(report.generatedAt)} · ${escapeHtml(report.machine.cpu)} (${report.machine.cores} cores, ${escapeHtml(report.machine.platform)}/${escapeHtml(report.machine.arch)})</div>
</header>
<main>
  <div class="kpis" id="kpis"></div>
  <div class="controls" id="controls"></div>
  <div id="suites"></div>
</main>
<script>
const REPORT = ${embedded};
const state = { category: "all", query: "" };
function fmt(v) {
  if (typeof v !== "number" || !isFinite(v)) return "n/a";
  if (Math.abs(v) < 10) return v.toFixed(2);
  if (Math.abs(v) < 1000) return v.toFixed(1);
  return Math.round(v).toLocaleString("en-US");
}
function fmtBytes(b) {
  if (b == null) return "—";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KiB";
  return (b / 1048576).toFixed(2) + " MiB";
}
function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function renderKpis() {
  const k = REPORT.summary;
  const items = [
    ["Suites", k.totalSuites],
    ["Benchmarks", k.totalBenchmarks],
    ["Improved (>10%)", k.improved],
    ["Regressed (>10%)", k.regressed],
    ["Total Measure Time", (k.totalDurationMs / 1000).toFixed(1) + " s"]
  ];
  document.getElementById("kpis").innerHTML = items.map(([l, v]) =>
    '<div class="kpi"><div class="label">' + esc(l) + '</div><div class="val">' + esc(v) + '</div></div>'
  ).join("");
}
function renderControls() {
  const cats = ["all", ...new Set(REPORT.suites.map(s => s.category))];
  const wrap = document.getElementById("controls");
  wrap.innerHTML = cats.map(c =>
    '<button class="pill' + (state.category === c ? " active" : "") + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>'
  ).join("") + '<input type="search" id="q" placeholder="Filter suites or benchmarks..." value="' + esc(state.query) + '" />';
  wrap.querySelectorAll(".pill").forEach(btn => btn.onclick = () => { state.category = btn.dataset.cat; renderControls(); renderSuites(); });
  const input = document.getElementById("q");
  input.oninput = (e) => { state.query = e.target.value.toLowerCase(); renderSuites(); };
}
function renderSuites() {
  const filtered = REPORT.suites.filter(s => {
    if (state.category !== "all" && s.category !== state.category) return false;
    if (!state.query) return true;
    return s.suite.toLowerCase().includes(state.query) || s.benchmarks.some(b => b.name.toLowerCase().includes(state.query));
  });
  document.getElementById("suites").innerHTML = filtered.map(s => {
    const benches = state.query && !s.suite.toLowerCase().includes(state.query)
      ? s.benchmarks.filter(b => b.name.toLowerCase().includes(state.query))
      : s.benchmarks;
    const maxVal = Math.max(...benches.map(b => b.nsPerOp || b.value || 1), 1);
    const hasMem = benches.some(b => b.bytesPerOp !== undefined);
    const hasDiff = benches.some(b => b.diff != null);
    return '<section class="suite">' +
      '<div class="suite-head"><h2>' + esc(s.suite) + '</h2><div><span class="cat">' + esc(s.category) + '</span> <span class="meta">' + esc(s.machine?.runtime || "") + ' · ' + Math.round(s.durationMs || 0) + ' ms</span></div></div>' +
      (s.description ? '<div class="suite-desc">' + esc(s.description) + '</div>' : '') +
      '<table><thead><tr><th>Benchmark</th><th class="num">Median</th><th class="num">Min</th><th class="num">P95</th>' +
      (hasMem ? '<th class="num">B/op</th><th class="num">Allocs/op</th>' : '') +
      (hasDiff ? '<th class="num">vs Baseline</th>' : '') +
      '</tr></thead><tbody>' +
      benches.map(b => {
        const pct = Math.min(100, Math.max(4, Math.round(((b.nsPerOp || b.value || 0) / maxVal) * 100)));
        const diffHtml = b.diff
          ? '<span class="badge ' + b.diff.status + '">' + (b.diff.deltaPct > 0 ? '+' : '') + b.diff.deltaPct.toFixed(1) + '%</span>'
          : '—';
        return '<tr><td><code>' + esc(b.name) + '</code></td>' +
          '<td class="num">' + fmt(b.value) + ' ' + esc(b.unit) + '<span class="bar-wrap"><span class="bar" style="width:' + pct + '%"></span></span></td>' +
          '<td class="num">' + fmt(b.min) + '</td>' +
          '<td class="num">' + fmt(b.p95) + '</td>' +
          (hasMem ? '<td class="num">' + fmtBytes(b.bytesPerOp) + '</td><td class="num">' + (b.allocsPerOp ?? "—") + '</td>' : '') +
          (hasDiff ? '<td class="num">' + diffHtml + '</td>' : '') +
          '</tr>';
      }).join("") +
      '</tbody></table></section>';
  }).join("");
}
renderKpis(); renderControls(); renderSuites();
</script>
</body>
</html>
`
}

const opts = parseArgs(process.argv.slice(2))
const inputFiles = [...opts.files]
if (opts.resultsDir && existsSync(opts.resultsDir)) {
  for (const name of readdirSync(opts.resultsDir).sort()) {
    if (name.endsWith(".json")) inputFiles.push(path.join(opts.resultsDir, name))
  }
}
const uniqueFiles = [...new Set(inputFiles)].sort()
if (uniqueFiles.length === 0) {
  console.error("report.mjs: no benchmark result JSON files supplied")
  process.exit(2)
}

const suites = uniqueFiles.map((file) => {
  const data = JSON.parse(readFileSync(file, "utf8"))
  if (data?.schemaVersion !== 1 || !data.suite || !Array.isArray(data.benchmarks)) {
    throw new Error(`report.mjs: invalid benchmark result file ${file}`)
  }
  return data
})

let baselineMap = new Map()
let baselinePath = ""
if (!opts.noBaseline && opts.baseline && existsSync(opts.baseline)) {
  baselinePath = opts.baseline
  const baseData = JSON.parse(readFileSync(opts.baseline, "utf8"))
  for (const s of baseData.suites ?? []) {
    for (const b of s.benchmarks ?? []) {
      baselineMap.set(`${s.suite}::${b.name}`, b)
    }
  }
}

let improved = 0
let regressed = 0
const failingRegressions = []
for (const suite of suites) {
  for (const bench of suite.benchmarks) {
    const base = baselineMap.get(`${suite.suite}::${bench.name}`)
    const diff = compareMetric(bench, base)
    if (diff) {
      bench.diff = diff
      if (diff.status === "improved") improved++
      if (diff.status === "regression") regressed++
      if (opts.failOnRegressionPct > 0 && diff.status === "regression" && Math.abs(diff.deltaPct) >= opts.failOnRegressionPct) {
        failingRegressions.push({ suite: suite.suite, name: bench.name, deltaPct: diff.deltaPct })
      }
    }
  }
}

const cpus = os.cpus()
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baselinePath: baselinePath || undefined,
  machine: {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    cpu: cpus[0]?.model ?? "unknown",
    cores: os.availableParallelism ? os.availableParallelism() : cpus.length
  },
  summary: {
    totalSuites: suites.length,
    totalBenchmarks: suites.reduce((acc, s) => acc + s.benchmarks.length, 0),
    totalDurationMs: Number(suites.reduce((acc, s) => acc + (s.durationMs ?? 0), 0).toFixed(2)),
    improved,
    regressed
  },
  suites
}

const markdown = renderMarkdown(report)
if (opts.jsonOut) writeAtomic(opts.jsonOut, JSON.stringify(report, null, 2) + "\n")
if (opts.mdOut) writeAtomic(opts.mdOut, markdown + "\n")
if (opts.htmlOut) writeAtomic(opts.htmlOut, renderHtml(report))
if (opts.saveBaseline) {
  const cleanSuites = suites.map((s) => ({
    ...s,
    benchmarks: s.benchmarks.map(({ diff: _diff, ...rest }) => rest)
  }))
  writeAtomic(opts.saveBaseline, JSON.stringify({ ...report, baselinePath: undefined, suites: cleanSuites }, null, 2) + "\n")
}
if (opts.print) console.log(markdown)

if (failingRegressions.length > 0) {
  for (const r of failingRegressions) {
    console.error(`REGRESSION >= ${opts.failOnRegressionPct}%: ${r.suite}::${r.name} (${r.deltaPct > 0 ? "+" : ""}${r.deltaPct}%)`)
  }
  process.exit(1)
}
