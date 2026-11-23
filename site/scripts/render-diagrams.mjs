#!/usr/bin/env node
// Generates theme-paired SVG diagrams (light + dark) in site/public/diagrams/.
// Run from site/: node scripts/render-diagrams.mjs
import fs from 'node:fs'
import path from 'node:path'

const outDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public/diagrams')
fs.mkdirSync(outDir, { recursive: true })

const THEMES = {
  light: {
    bg: '#f8fafc',
    card: '#ffffff',
    cardAlt: '#f1f5f9',
    border: '#d6dde8',
    text: '#16202e',
    muted: '#4b5563',
    faint: '#6b7280',
    line: '#94a3b8',
    indigo: '#4338ca',
    indigoBg: '#eef2ff',
    indigoBorder: '#a5b4fc',
    red: '#b91c1c',
    redBg: '#fef2f2',
    redBorder: '#fca5a5',
    teal: '#0f766e',
    tealBg: '#f0fdfa',
    tealBorder: '#5eead4',
    amber: '#92400e',
    amberBg: '#fffbeb',
    amberBorder: '#fcd34d',
    slateBg: '#f1f5f9',
    slateBorder: '#cbd5e1',
  },
  dark: {
    bg: '#14151a',
    card: '#1c1d24',
    cardAlt: '#242630',
    border: '#323544',
    text: '#eef1f6',
    muted: '#b3bac7',
    faint: '#8a93a6',
    line: '#64708a',
    indigo: '#a5b4fc',
    indigoBg: '#232445',
    indigoBorder: '#6366f1',
    red: '#fda4af',
    redBg: '#3a1d24',
    redBorder: '#e11d48',
    teal: '#5eead4',
    tealBg: '#133230',
    tealBorder: '#14b8a6',
    amber: '#fcd34d',
    amberBg: '#382a14',
    amberBorder: '#d97706',
    slateBg: '#242630',
    slateBorder: '#43485c',
  },
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function wrapSvg({ width = 880, height, title, desc, theme, body }) {
  const t = THEMES[theme]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="t d">
  <title id="t">${esc(title)}</title>
  <desc id="d">${esc(desc)}</desc>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 1 1 L 9 5 L 1 9 z" fill="${t.line}"/>
    </marker>
    <marker id="arrow-indigo" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 1 1 L 9 5 L 1 9 z" fill="${t.indigo}"/>
    </marker>
    <marker id="arrow-red" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 1 1 L 9 5 L 1 9 z" fill="${t.red}"/>
    </marker>
    <marker id="arrow-teal" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 1 1 L 9 5 L 1 9 z" fill="${t.teal}"/>
    </marker>
    <marker id="arrow-amber" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 1 1 L 9 5 L 1 9 z" fill="${t.amber}"/>
    </marker>
  </defs>
  <style>
    text { font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .mono { font-family: "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace; }
    .h { font-size: 18px; font-weight: 700; fill: ${t.text}; }
    .sub { font-size: 13px; fill: ${t.muted}; }
    .k { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; }
    .b { font-size: 14px; font-weight: 600; fill: ${t.text}; }
    .p { font-size: 12.5px; fill: ${t.muted}; }
    .code { font-family: "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace; font-size: 13px; font-weight: 600; }
    .code-sm { font-family: "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace; font-size: 11.5px; }
  </style>
  <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="${t.bg}"/>
  ${body(t)}
</svg>
`
}

const box = (x, y, w, h, fill, stroke, rx = 10) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`

const pill = (x, y, w, h, fill, stroke, text, textFill) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
   <text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" class="k" fill="${textFill}">${esc(text)}</text>`

const DIAGRAMS = {
  // 1. The Three-Channel Effect Type: A!E!R
  'effect-three-channels': {
    height: 360,
    title: 'Anatomy of an Effect type: A!E!R',
    desc: 'Shows how User!UserNotFound!Users maps to Success (A), Expected Error (E), and Required Services (R), and how try, catch, and provide transform those channels.',
    body: (t) => `
      <text x="36" y="42" class="h">Every Effect carries three compile-time channels</text>
      <text x="36" y="64" class="sub">Write A!E!R (short for Effect.Effect&lt;A, E, R&gt;). Omit the annotation and the compiler infers all three.</text>

      <!-- Big signature bar -->
      ${box(36, 86, 808, 66, t.card, t.border, 10)}
      <text x="440" y="128" text-anchor="middle" class="mono" font-size="26" font-weight="700">
        <tspan fill="${t.indigo}">User</tspan><tspan fill="${t.faint}"> ! </tspan><tspan fill="${t.red}">UserNotFound</tspan><tspan fill="${t.faint}"> ! </tspan><tspan fill="${t.teal}">Users</tspan>
      </text>

      <!-- Connector arrows down -->
      <line x1="255" y1="152" x2="164" y2="188" stroke="${t.indigo}" stroke-width="1.8" marker-end="url(#arrow-indigo)"/>
      <line x1="440" y1="152" x2="440" y2="188" stroke="${t.red}" stroke-width="1.8" marker-end="url(#arrow-red)"/>
      <line x1="625" y1="152" x2="716" y2="188" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>

      <!-- Card A -->
      ${box(36, 194, 256, 138, t.indigoBg, t.indigoBorder)}
      <text x="54" y="220" class="k" fill="${t.indigo}">A · SUCCESS VALUE</text>
      <text x="54" y="244" class="b">What it returns</text>
      <text x="54" y="266" class="p">Unwrapped by <tspan class="code-sm" fill="${t.indigo}">try expr</tspan></text>
      <text x="54" y="288" class="p"><tspan class="code-sm" fill="${t.text}">void</tspan> = side effect only</text>
      <text x="54" y="310" class="p"><tspan class="code-sm" fill="${t.text}">never</tspan> = never succeeds</text>

      <!-- Card E -->
      ${box(312, 194, 256, 138, t.redBg, t.redBorder)}
      <text x="330" y="220" class="k" fill="${t.red}">E · EXPECTED ERRORS</text>
      <text x="330" y="244" class="b">How it can fail</text>
      <text x="330" y="266" class="p">Added by <tspan class="code-sm" fill="${t.red}">throw new Err()</tspan></text>
      <text x="330" y="288" class="p">Removed by <tspan class="code-sm" fill="${t.red}">catch</tspan></text>
      <text x="330" y="310" class="p"><tspan class="code-sm" fill="${t.text}">never</tspan> (empty slot) = cannot fail</text>

      <!-- Card R -->
      ${box(588, 194, 256, 138, t.tealBg, t.tealBorder)}
      <text x="606" y="220" class="k" fill="${t.teal}">R · REQUIREMENTS</text>
      <text x="606" y="244" class="b">Services it needs</text>
      <text x="606" y="266" class="p">Added by <tspan class="code-sm" fill="${t.teal}">try Users</tspan></text>
      <text x="606" y="288" class="p">Removed by <tspan class="code-sm" fill="${t.teal}">provide</tspan></text>
      <text x="606" y="310" class="p"><tspan class="code-sm" fill="${t.text}">never</tspan> (omitted) = ready to run</text>
    `,
  },

  // 2. Cold Blueprint vs Running Execution
  'cold-vs-running': {
    height: 310,
    title: 'Description vs. execution: calling an effect function does not run it',
    desc: 'Calling loadUser(id) creates an inert Effect blueprint. Combinators like retry and timeout wrap that blueprint. Only try inside an effect function or a runner at the app edge executes it.',
    body: (t) => `
      <text x="36" y="42" class="h">Calling an effect function builds a blueprint — it runs zero work</text>
      <text x="36" y="64" class="sub">Because Effects are plain values until executed, you can store, retry, timeout, or race them before a single line runs.</text>

      <!-- Stage 1: Construct -->
      ${box(36, 94, 232, 166, t.card, t.border)}
      ${pill(52, 110, 110, 22, t.slateBg, t.slateBorder, '1. DESCRIBE', t.muted)}
      <text x="52" y="158" class="code" fill="${t.indigo}">const job = load("42")</text>
      <text x="52" y="186" class="p">Builds an Effect value.</text>
      <text x="52" y="206" class="p">No I/O, no logs, no fiber.</text>
      <text x="52" y="236" class="code-sm" fill="${t.faint}">type: User!NotFound!Users</text>

      <line x1="268" y1="177" x2="314" y2="177" stroke="${t.line}" stroke-width="2" marker-end="url(#arrow)"/>

      <!-- Stage 2: Compose -->
      ${box(322, 94, 236, 166, t.indigoBg, t.indigoBorder)}
      ${pill(338, 110, 110, 22, t.card, t.indigoBorder, '2. COMPOSE', t.indigo)}
      <text x="338" y="154" class="code" fill="${t.text}">job</text>
      <text x="338" y="174" class="code" fill="${t.indigo}">  |&gt; retry(%, policy)</text>
      <text x="338" y="194" class="code" fill="${t.indigo}">  |&gt; timeout(%, "2s")</text>
      <text x="338" y="226" class="p">Still a cold blueprint.</text>
      <text x="338" y="244" class="p">Reusable as many times as needed.</text>

      <line x1="558" y1="177" x2="604" y2="177" stroke="${t.teal}" stroke-width="2" marker-end="url(#arrow-teal)"/>

      <!-- Stage 3: Execute -->
      ${box(612, 94, 232, 166, t.tealBg, t.tealBorder)}
      ${pill(628, 110, 108, 22, t.card, t.tealBorder, '3. EXECUTE', t.teal)}
      <text x="628" y="156" class="code" fill="${t.teal}">try resilientJob</text>
      <text x="628" y="176" class="p">Inside an effect function</text>
      <line x1="628" y1="194" x2="824" y2="194" stroke="${t.tealBorder}" stroke-width="1" stroke-dasharray="4 3"/>
      <text x="628" y="218" class="code" fill="${t.teal}">NodeRuntime.runMain(…)</text>
      <text x="628" y="238" class="p">Once, at the program edge</text>

      <text x="440" y="290" text-anchor="middle" class="p">Rule of thumb: pass <tspan class="code-sm" fill="${t.indigo}">load("42")</tspan> to combinators; run it with <tspan class="code-sm" fill="${t.teal}">try</tspan> when you want its value.</text>
    `,
  },

  // 3. Two Error Tracks + Interruption
  'two-error-rails': {
    height: 340,
    title: 'Three outcomes of an Effect: Success, Expected Failure, and Defect / Interruption',
    desc: 'Expected failures travel on the typed E channel and are caught by catch. Defects and interruptions bypass catch and trigger cleanup finalizers.',
    body: (t) => `
      <text x="36" y="42" class="h">Expected errors vs. defects vs. interruption</text>
      <text x="36" y="64" class="sub">Only expected failures enter the type channel E and reach catch. Bugs (defects) and cancellation bypass catch — while still running cleanup.</text>

      <!-- Track 1: Success -->
      ${box(36, 88, 808, 66, t.indigoBg, t.indigoBorder)}
      ${pill(52, 108, 126, 26, t.card, t.indigoBorder, 'SUCCESS (A)', t.indigo)}
      <text x="200" y="117" class="b">Normal return value</text>
      <text x="200" y="137" class="p"><tspan class="code-sm" fill="${t.indigo}">return value</tspan>  →  unwrapped by <tspan class="code-sm" fill="${t.indigo}">const x = try work()</tspan></text>
      <text x="720" y="126" text-anchor="middle" class="code-sm" fill="${t.indigo}">Tracked in A</text>

      <!-- Track 2: Expected failure -->
      ${box(36, 168, 808, 72, t.redBg, t.redBorder)}
      ${pill(52, 191, 126, 26, t.card, t.redBorder, 'EXPECTED (E)', t.red)}
      <text x="200" y="196" class="b">Recoverable domain failure</text>
      <text x="200" y="216" class="p"><tspan class="code-sm" fill="${t.red}">throw new NotFound({ id })</tspan>  →  caught &amp; narrowed by <tspan class="code-sm" fill="${t.red}">catch</tspan></text>
      <text x="200" y="232" class="p">Examples: missing record, bad input, network timeout, permission denied</text>
      <text x="720" y="208" text-anchor="middle" class="code-sm" fill="${t.red}">Tracked in E</text>

      <!-- Track 3: Defect / Interrupt -->
      ${box(36, 254, 808, 66, t.amberBg, t.amberBorder)}
      ${pill(52, 274, 126, 26, t.card, t.amberBorder, 'DEFECT / CANCEL', t.amber)}
      <text x="200" y="282" class="b">Broken invariant or fiber cancellation</text>
      <text x="200" y="302" class="p"><tspan class="code-sm" fill="${t.amber}">try die(err)</tspan>, null deref, <tspan class="code-sm" fill="${t.amber}">Fiber.interrupt</tspan>  →  bypasses <tspan class="code-sm" fill="${t.text}">catch</tspan>, runs <tspan class="code-sm" fill="${t.amber}">ensuring</tspan> / <tspan class="code-sm" fill="${t.amber}">scoped</tspan></text>
      <text x="720" y="291" text-anchor="middle" class="code-sm" fill="${t.amber}">In Cause (not E)</text>
    `,
  },

  // 4. Typed Recovery & Narrowing with catch + match
  'try-catch-flow': {
    height: 300,
    title: 'How catch and match shrink the error union E',
    desc: 'findItem fails with InvalidCode | ItemMissing. Catching ItemMissing and rethrowing the rest narrows the caller return type to string!InvalidCode.',
    body: (t) => `
      <text x="36" y="42" class="h">Handle one failure, and the compiler removes it from E</text>
      <text x="36" y="64" class="sub">Each unhandled branch stays in the return type. Forget a case in an exhaustive match and the compiler stops you.</text>

      <!-- Box 1: Source Effect -->
      ${box(36, 96, 214, 152, t.card, t.border)}
      <text x="54" y="122" class="k" fill="${t.faint}">CALLEE</text>
      <text x="54" y="148" class="code" fill="${t.text}">findItem(input)</text>
      <text x="54" y="180" class="code-sm" fill="${t.indigo}">A: Item</text>
      <text x="54" y="202" class="code-sm" fill="${t.red}">E: InvalidCode</text>
      <text x="54" y="220" class="code-sm" fill="${t.red}"> | ItemMissing</text>

      <line x1="250" y1="172" x2="296" y2="172" stroke="${t.line}" stroke-width="2" marker-end="url(#arrow)"/>

      <!-- Box 2: catch + match -->
      ${box(304, 96, 286, 152, t.indigoBg, t.indigoBorder)}
      <text x="322" y="122" class="k" fill="${t.indigo}">CATCH EFFECT + MATCH</text>
      <text x="322" y="148" class="code-sm" fill="${t.text}">catch effect (err) =&gt; match (err) {</text>
      <text x="322" y="172" class="code-sm" fill="${t.teal}">  when ItemMissing: fallback;</text>
      <text x="322" y="196" class="code-sm" fill="${t.red}">  default: throw err;</text>
      <text x="322" y="218" class="code-sm" fill="${t.text}">}</text>
      <text x="322" y="238" class="p">ItemMissing is recovered; default rethrows</text>

      <!-- Two outgoing arrows -->
      <line x1="590" y1="146" x2="636" y2="146" stroke="${t.teal}" stroke-width="2" marker-end="url(#arrow-teal)"/>
      <line x1="590" y1="204" x2="636" y2="204" stroke="${t.red}" stroke-width="2" marker-end="url(#arrow-red)"/>

      <!-- Box 3: Caller contract -->
      ${box(644, 96, 200, 152, t.card, t.border)}
      <text x="662" y="122" class="k" fill="${t.faint}">CALLER TYPE</text>
      <text x="662" y="152" class="code" fill="${t.indigo}">string!InvalidCode</text>
      <text x="662" y="182" class="p">✓ ItemMissing handled</text>
      <text x="662" y="206" class="p">→ InvalidCode stays in E</text>
      <text x="662" y="230" class="p">Zero runtime tag typos</text>

      <text x="440" y="280" text-anchor="middle" class="p">Handle every case with <tspan class="code-sm" fill="${t.indigo}">catch () =&gt; defaultVal</tspan> and E collapses all the way to <tspan class="code-sm" fill="${t.teal}">never</tspan>.</text>
    `,
  },

  // 5. Concurrency modes timeline
  'concurrency-modes': {
    height: 340,
    title: 'Timeline comparison: sequential, bounded concurrency, and unbounded try.all',
    desc: 'Compares execution timelines for 4 tasks under sequential all, bounded for concurrent(2), and unbounded try.all.',
    body: (t) => `
      <text x="36" y="42" class="h">Three ways to run multiple Effects</text>
      <text x="36" y="64" class="sub">Time flows left to right. All three preserve result order and cancel active siblings if one fails.</text>

      <!-- Row 1: Sequential -->
      <text x="36" y="108" class="code" fill="${t.text}">try all([a, b, c, d])</text>
      <text x="36" y="126" class="p">Sequential (default)</text>
      ${box(270, 90, 130, 38, t.slateBg, t.slateBorder, 6)}
      <text x="335" y="114" text-anchor="middle" class="code-sm" fill="${t.text}">a</text>
      ${box(406, 90, 130, 38, t.slateBg, t.slateBorder, 6)}
      <text x="471" y="114" text-anchor="middle" class="code-sm" fill="${t.text}">b</text>
      ${box(542, 90, 130, 38, t.slateBg, t.slateBorder, 6)}
      <text x="607" y="114" text-anchor="middle" class="code-sm" fill="${t.text}">c</text>
      ${box(678, 90, 130, 38, t.slateBg, t.slateBorder, 6)}
      <text x="743" y="114" text-anchor="middle" class="code-sm" fill="${t.text}">d</text>

      <!-- Row 2: Bounded -->
      <text x="36" y="176" class="code" fill="${t.teal}">for concurrent(2) (…)</text>
      <text x="36" y="194" class="p">At most 2 active fibers</text>
      ${box(270, 154, 150, 26, t.tealBg, t.tealBorder, 6)}
      <text x="345" y="171" text-anchor="middle" class="code-sm" fill="${t.teal}">a</text>
      ${box(270, 184, 116, 26, t.tealBg, t.tealBorder, 6)}
      <text x="328" y="201" text-anchor="middle" class="code-sm" fill="${t.teal}">b</text>
      ${box(392, 184, 140, 26, t.tealBg, t.tealBorder, 6)}
      <text x="462" y="201" text-anchor="middle" class="code-sm" fill="${t.teal}">c (starts when b finishes)</text>
      ${box(426, 154, 130, 26, t.tealBg, t.tealBorder, 6)}
      <text x="491" y="171" text-anchor="middle" class="code-sm" fill="${t.teal}">d (starts when a finishes)</text>

      <!-- Row 3: Unbounded -->
      <text x="36" y="256" class="code" fill="${t.indigo}">try.all [a, b, c, d]</text>
      <text x="36" y="274" class="p">Unbounded (all at once)</text>
      ${box(270, 234, 150, 18, t.indigoBg, t.indigoBorder, 4)}
      <text x="345" y="247" text-anchor="middle" class="code-sm" fill="${t.indigo}">a</text>
      ${box(270, 255, 116, 18, t.indigoBg, t.indigoBorder, 4)}
      <text x="328" y="268" text-anchor="middle" class="code-sm" fill="${t.indigo}">b</text>
      ${box(270, 276, 168, 18, t.indigoBg, t.indigoBorder, 4)}
      <text x="354" y="289" text-anchor="middle" class="code-sm" fill="${t.indigo}">c</text>
      ${box(270, 297, 130, 18, t.indigoBg, t.indigoBorder, 4)}
      <text x="335" y="310" text-anchor="middle" class="code-sm" fill="${t.indigo}">d</text>

      <!-- Time axis -->
      <line x1="270" y1="326" x2="824" y2="326" stroke="${t.line}" stroke-width="1.5" marker-end="url(#arrow)"/>
      <text x="826" y="330" class="k" fill="${t.faint}">TIME</text>
    `,
  },

  // 6. try.race vs try.any
  'race-vs-any': {
    height: 300,
    title: 'Difference between try.race and try.any when the first branch fails',
    desc: 'try.race takes the earliest completion even if it fails and interrupts slower branches. try.any ignores early failures and waits for the first success, interrupting remaining losers.',
    body: (t) => `
      <text x="36" y="42" class="h">try.race vs. try.any when the fastest branch fails</text>
      <text x="36" y="64" class="sub">Both cancel losing fibers and wait for their cleanup before returning.</text>

      <!-- Left: try.race -->
      ${box(36, 90, 392, 182, t.card, t.border)}
      <text x="56" y="118" class="code" fill="${t.red}">try.race [primary(), backup()]</text>
      <text x="56" y="138" class="p">First completion wins — failure included</text>

      ${box(56, 158, 124, 30, t.redBg, t.redBorder, 6)}
      <text x="118" y="177" text-anchor="middle" class="code-sm" fill="${t.red}">primary: FAIL ✕</text>

      ${box(56, 198, 124, 30, t.amberBg, t.amberBorder, 6)}
      <text x="118" y="217" text-anchor="middle" class="code-sm" fill="${t.amber}">backup: CANCEL</text>
      <line x1="184" y1="152" x2="184" y2="236" stroke="${t.red}" stroke-width="1.8" stroke-dasharray="4 3"/>
      <text x="196" y="198" class="code-sm" fill="${t.red}">Result: FAIL</text>
      <text x="196" y="218" class="p">backup interrupted</text>

      <!-- Right: try.any -->
      ${box(452, 90, 392, 182, t.card, t.border)}
      <text x="472" y="118" class="code" fill="${t.teal}">try.any [primary(), backup()]</text>
      <text x="472" y="138" class="p">First success wins — early failures keep racing</text>

      ${box(472, 158, 110, 30, t.redBg, t.redBorder, 6)}
      <text x="527" y="177" text-anchor="middle" class="code-sm" fill="${t.red}">primary: FAIL</text>

      ${box(472, 198, 210, 30, t.tealBg, t.tealBorder, 6)}
      <text x="577" y="217" text-anchor="middle" class="code-sm" fill="${t.teal}">backup: OK ✓</text>
      <line x1="686" y1="152" x2="686" y2="236" stroke="${t.teal}" stroke-width="1.8" stroke-dasharray="4 3"/>
      <text x="698" y="200" class="code-sm" fill="${t.teal}">Result: OK</text>
      <text x="698" y="218" class="p">slower peers cancelled</text>
    `,
  },

  // 7. Structured Concurrency & Fiber Tree
  'fiber-tree': {
    height: 320,
    title: 'Fiber lifetimes: fork, fork.scoped, and fork.detached',
    desc: 'Shows how fork ties a child fiber lifetime to its parent, fork.scoped ties it to a Scope, and fork.detached runs independently.',
    body: (t) => `
      <text x="36" y="42" class="h">Structured concurrency: every fiber has an owner</text>
      <text x="36" y="64" class="sub">Choose the fork form that matches how long background work should live.</text>

      <!-- Parent fiber -->
      ${box(316, 86, 248, 52, t.indigoBg, t.indigoBorder)}
      <text x="440" y="110" text-anchor="middle" class="b">Parent Fiber</text>
      <text x="440" y="128" text-anchor="middle" class="p">ends or is interrupted</text>

      <!-- Connectors -->
      <line x1="360" y1="138" x2="164" y2="182" stroke="${t.indigo}" stroke-width="1.8" marker-end="url(#arrow-indigo)"/>
      <line x1="440" y1="138" x2="440" y2="182" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>
      <line x1="520" y1="138" x2="716" y2="182" stroke="${t.amber}" stroke-width="1.8" stroke-dasharray="5 4" marker-end="url(#arrow-amber)"/>

      <!-- Child 1: fork -->
      ${box(36, 188, 256, 108, t.card, t.indigoBorder)}
      <text x="54" y="214" class="code" fill="${t.indigo}">fork work()</text>
      <text x="54" y="238" class="b">Child of parent</text>
      <text x="54" y="258" class="p">Automatically interrupted when</text>
      <text x="54" y="276" class="p">the parent fiber exits. Use <tspan class="code-sm" fill="${t.text}">join f</tspan>.</text>

      <!-- Child 2: fork.scoped -->
      ${box(312, 188, 256, 108, t.card, t.tealBorder)}
      <text x="330" y="214" class="code" fill="${t.teal}">fork.scoped work()</text>
      <text x="330" y="238" class="b">Bound to enclosing Scope</text>
      <text x="330" y="258" class="p">Lives until <tspan class="code-sm" fill="${t.text}">scoped(…)</tspan> closes.</text>
      <text x="330" y="276" class="p">Adds <tspan class="code-sm" fill="${t.teal}">Scope</tspan> to channel R.</text>

      <!-- Child 3: fork.detached -->
      ${box(588, 188, 256, 108, t.card, t.amberBorder)}
      <text x="606" y="214" class="code" fill="${t.amber}">fork.detached work()</text>
      <text x="606" y="238" class="b">Independent daemon</text>
      <text x="606" y="258" class="p">Outlives parent exit. You own</text>
      <text x="606" y="276" class="p">its shutdown via <tspan class="code-sm" fill="${t.text}">Fiber.interrupt</tspan>.</text>
    `,
  },

  // 8. Services, Layers, and provide
  'services-and-layers': {
    height: 330,
    title: 'Services declare contracts, Layers build implementations, provide wires them once',
    desc: 'Shows Config feeding DatabaseLive, DatabaseLive feeding UsersLive, and provide supplying the whole layer graph to main() so R becomes never.',
    body: (t) => `
      <text x="36" y="42" class="h">Services, Layers, and provide: wire dependencies once at the edge</text>
      <text x="36" y="64" class="sub">Business logic asks for capabilities by service key. Layers capture their own dependencies when constructed.</text>

      <!-- Left column: Layers -->
      ${box(36, 94, 200, 68, t.tealBg, t.tealBorder)}
      <text x="54" y="120" class="k" fill="${t.teal}">LAYER</text>
      <text x="54" y="140" class="code" fill="${t.text}">DbLive</text>
      <text x="54" y="154" class="code-sm" fill="${t.muted}">provides Database</text>

      <line x1="236" y1="128" x2="288" y2="128" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>

      ${box(296, 94, 240, 68, t.tealBg, t.tealBorder)}
      <text x="314" y="120" class="k" fill="${t.teal}">LAYER.EFFECT</text>
      <text x="314" y="140" class="code" fill="${t.text}">UsersLive</text>
      <text x="314" y="154" class="code-sm" fill="${t.muted}">uses Database → provides Users</text>

      <!-- Bottom left: business logic -->
      ${box(36, 204, 500, 92, t.card, t.indigoBorder)}
      <text x="54" y="228" class="k" fill="${t.indigo}">APPLICATION CODE</text>
      <text x="54" y="252" class="code" fill="${t.text}">effect function greet(id: string)</text>
      <text x="54" y="274" class="p">Reads <tspan class="code-sm" fill="${t.teal}">const users = try Users</tspan> — never mentions Database!</text>
      <text x="54" y="290" class="code-sm" fill="${t.indigo}">inferred type: string!NotFound!Users</text>

      <!-- Merge arrow into provide -->
      <line x1="536" y1="128" x2="584" y2="178" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>
      <line x1="536" y1="250" x2="584" y2="206" stroke="${t.indigo}" stroke-width="1.8" marker-end="url(#arrow-indigo)"/>

      <!-- Right: provide boundary -->
      ${box(592, 124, 252, 144, t.card, t.border)}
      <text x="610" y="150" class="k" fill="${t.faint}">AT MAIN()</text>
      <text x="610" y="176" class="code" fill="${t.teal}">provide AppLive {</text>
      <text x="610" y="198" class="code" fill="${t.indigo}">  try greet("ada")</text>
      <text x="610" y="220" class="code" fill="${t.teal}">}</text>
      <text x="610" y="250" class="p">Requirements satisfied: <tspan class="code-sm" fill="${t.teal}">R = never</tspan></text>
    `,
  },

  // 9. Scope Lifecycle (LIFO acquire/release)
  'scope-lifecycle': {
    height: 300,
    title: 'Scope lifecycle: resources acquire in order and release in reverse order',
    desc: 'Inside scoped(), acquiring File then Lock guarantees Lock releases before File, whether the body succeeds, fails, or is interrupted.',
    body: (t) => `
      <text x="36" y="42" class="h">Guaranteed cleanup in reverse order (LIFO)</text>
      <text x="36" y="64" class="sub">acquireRelease binds each resource to the enclosing Scope. Even on error or cancellation, every acquired finalizer runs.</text>

      <!-- Outer scope frame -->
      ${box(36, 88, 808, 184, t.card, t.tealBorder, 12)}
      <text x="56" y="114" class="code" fill="${t.teal}">try scoped(effect { … })</text>

      <!-- Step 1 -->
      ${box(56, 134, 140, 88, t.tealBg, t.tealBorder, 8)}
      <text x="126" y="160" text-anchor="middle" class="k" fill="${t.teal}">1. ACQUIRE</text>
      <text x="126" y="184" text-anchor="middle" class="b">Open File</text>
      <text x="126" y="204" text-anchor="middle" class="p">uninterruptible</text>

      <line x1="196" y1="178" x2="220" y2="178" stroke="${t.line}" stroke-width="1.8" marker-end="url(#arrow)"/>

      <!-- Step 2 -->
      ${box(228, 134, 140, 88, t.tealBg, t.tealBorder, 8)}
      <text x="298" y="160" text-anchor="middle" class="k" fill="${t.teal}">2. ACQUIRE</text>
      <text x="298" y="184" text-anchor="middle" class="b">Take Lock</text>
      <text x="298" y="204" text-anchor="middle" class="p">uninterruptible</text>

      <line x1="368" y1="178" x2="392" y2="178" stroke="${t.line}" stroke-width="1.8" marker-end="url(#arrow)"/>

      <!-- Step 3 -->
      ${box(400, 134, 126, 88, t.indigoBg, t.indigoBorder, 8)}
      <text x="463" y="160" text-anchor="middle" class="k" fill="${t.indigo}">3. USE</text>
      <text x="463" y="184" text-anchor="middle" class="b">Work</text>
      <text x="463" y="204" text-anchor="middle" class="p">ok / fail / cancel</text>

      <line x1="526" y1="178" x2="550" y2="178" stroke="${t.amber}" stroke-width="1.8" marker-end="url(#arrow-amber)"/>

      <!-- Step 4 -->
      ${box(558, 134, 126, 88, t.amberBg, t.amberBorder, 8)}
      <text x="621" y="160" text-anchor="middle" class="k" fill="${t.amber}">4. RELEASE</text>
      <text x="621" y="184" text-anchor="middle" class="b">Drop Lock</text>
      <text x="621" y="204" text-anchor="middle" class="p">runs first</text>

      <line x1="684" y1="178" x2="708" y2="178" stroke="${t.amber}" stroke-width="1.8" marker-end="url(#arrow-amber)"/>

      <!-- Step 5 -->
      ${box(716, 134, 110, 88, t.amberBg, t.amberBorder, 8)}
      <text x="771" y="160" text-anchor="middle" class="k" fill="${t.amber}">5. RELEASE</text>
      <text x="771" y="184" text-anchor="middle" class="b">Close File</text>
      <text x="771" y="204" text-anchor="middle" class="p">runs last</text>

      <text x="440" y="254" text-anchor="middle" class="p">If step 2 fails, step 5 still closes the file and step 4 is skipped because the lock was never acquired.</text>
    `,
  },

  // 10. VibeLang <-> TypeScript Interop & Compilation
  'vibe-ts-interop': {
    height: 315,
    title: 'How VibeLang compiles alongside TypeScript in one program',
    desc: 'The vibelang compiler typechecks .vibe and .ts files together, emitting standard JavaScript and .d.vibe.ts declarations so TypeScript sees ordinary Effect functions.',
    body: (t) => `
      <text x="36" y="42" class="h">One compiler, ordinary Effect output, zero ecosystem wall</text>
      <text x="36" y="64" class="sub">.vibe and .ts files live side by side, import each other, and compile to plain JavaScript + Effect declarations.</text>

      <!-- Source files -->
      ${box(36, 94, 212, 78, t.indigoBg, t.indigoBorder)}
      <text x="54" y="120" class="code" fill="${t.indigo}">app.vibe</text>
      <text x="54" y="142" class="p">effect functions, errors,</text>
      <text x="54" y="158" class="p">services, try, catch, match</text>

      ${box(36, 192, 212, 78, t.slateBg, t.slateBorder)}
      <text x="54" y="218" class="code" fill="${t.text}">adapter.ts</text>
      <text x="54" y="240" class="p">npm SDKs, Promises, Node APIs</text>
      <text x="54" y="256" class="p">called via Effect.try / tryPromise</text>

      <!-- Arrows to compiler -->
      <line x1="248" y1="133" x2="314" y2="168" stroke="${t.indigo}" stroke-width="1.8" marker-end="url(#arrow-indigo)"/>
      <line x1="248" y1="231" x2="314" y2="196" stroke="${t.line}" stroke-width="1.8" marker-end="url(#arrow)"/>

      <!-- Compiler -->
      ${box(322, 126, 224, 112, t.card, t.indigoBorder)}
      <text x="434" y="156" text-anchor="middle" class="k" fill="${t.indigo}">COMPILER (TS 7 FORK)</text>
      <text x="434" y="182" text-anchor="middle" class="code" fill="${t.text}">vibelang</text>
      <text x="434" y="206" text-anchor="middle" class="p">Checks .vibe + .ts together</text>
      <text x="434" y="224" text-anchor="middle" class="p">Tracks A, E, R &amp; @throws</text>

      <!-- Arrows to outputs -->
      <line x1="546" y1="162" x2="612" y2="133" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>
      <line x1="546" y1="202" x2="612" y2="231" stroke="${t.indigo}" stroke-width="1.8" marker-end="url(#arrow-indigo)"/>

      <!-- Outputs -->
      ${box(620, 94, 224, 78, t.tealBg, t.tealBorder)}
      <text x="638" y="120" class="code" fill="${t.teal}">app.js + source maps</text>
      <text x="638" y="142" class="p">Standard Effect 4.1.1 code.</text>
      <text x="638" y="158" class="p">Runs on Node, Bun, Workers, Web.</text>

      ${box(620, 192, 224, 78, t.card, t.border)}
      <text x="638" y="218" class="code" fill="${t.indigo}">app.d.vibe.ts</text>
      <text x="638" y="240" class="p">Stock tsc sees ordinary</text>
      <text x="638" y="256" class="code-sm" fill="${t.muted}">Effect.Effect&lt;A, E, R&gt;</text>

      <text x="440" y="298" text-anchor="middle" class="p">TypeScript calls VibeLang via <tspan class="code-sm" fill="${t.teal}">await Effect.runPromise(fn())</tspan>; VibeLang calls TypeScript via <tspan class="code-sm" fill="${t.indigo}">Effect.try</tspan> / <tspan class="code-sm" fill="${t.indigo}">tryPromise</tspan>.</text>
    `,
  },

  // 11. Pull-Based Streams & Producers
  'stream-producer-flow': {
    height: 300,
    title: 'Pull-based Streams: producers yield values on demand into consumers',
    desc: 'An effect function* producer yields items lazily under backpressure through Stream operators into a for try loop or Sink.',
    body: (t) => `
      <text x="36" y="42" class="h">Producers &amp; Streams: pull-based data with built-in backpressure</text>
      <text x="36" y="64" class="sub">The consumer pulls the next item only when ready — the producer pauses between yields.</text>

      <!-- Producer -->
      ${box(36, 100, 238, 138, t.indigoBg, t.indigoBorder)}
      <text x="54" y="126" class="k" fill="${t.indigo}">PRODUCER</text>
      <text x="54" y="150" class="code" fill="${t.text}">effect function* pages()</text>
      <text x="54" y="176" class="code-sm" fill="${t.indigo}">  yield row</text>
      <text x="54" y="200" class="p">Returns <tspan class="code-sm" fill="${t.text}">Stream&lt;A, E, R&gt;</tspan></text>
      <text x="54" y="220" class="p">Owns its own cleanup Scope</text>

      <!-- Arrows (data right, pull left) -->
      <line x1="274" y1="154" x2="326" y2="154" stroke="${t.indigo}" stroke-width="1.8" marker-end="url(#arrow-indigo)"/>
      <text x="300" y="144" text-anchor="middle" class="k" fill="${t.indigo}">ITEM</text>
      <line x1="326" y1="186" x2="274" y2="186" stroke="${t.line}" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#arrow)"/>
      <text x="300" y="204" text-anchor="middle" class="k" fill="${t.faint}">PULL</text>

      <!-- Operators -->
      ${box(334, 100, 212, 138, t.card, t.border)}
      <text x="352" y="126" class="k" fill="${t.faint}">TRANSFORM</text>
      <text x="352" y="152" class="code-sm" fill="${t.text}">Stream.filter(…)</text>
      <text x="352" y="174" class="code-sm" fill="${t.text}">Stream.map(…)</text>
      <text x="352" y="196" class="code-sm" fill="${t.text}">Stream.take(10)</text>
      <text x="352" y="222" class="p">Lazy — zero buffering surge</text>

      <!-- Arrows -->
      <line x1="546" y1="154" x2="598" y2="154" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>
      <text x="572" y="144" text-anchor="middle" class="k" fill="${t.teal}">ITEM</text>
      <line x1="598" y1="186" x2="546" y2="186" stroke="${t.line}" stroke-width="1.5" stroke-dasharray="4 3" marker-end="url(#arrow)"/>
      <text x="572" y="204" text-anchor="middle" class="k" fill="${t.faint}">PULL</text>

      <!-- Consumer -->
      ${box(606, 100, 238, 138, t.tealBg, t.tealBorder)}
      <text x="624" y="126" class="k" fill="${t.teal}">CONSUMER</text>
      <text x="624" y="152" class="code" fill="${t.text}">for try (const x of s)</text>
      <text x="624" y="176" class="p">or <tspan class="code-sm" fill="${t.teal}">try Stream.runCollect(s)</tspan></text>
      <text x="624" y="200" class="p"><tspan class="code-sm" fill="${t.text}">break</tspan> stops early &amp; closes</text>
      <text x="624" y="220" class="p">every upstream resource.</text>

      <text x="440" y="274" text-anchor="middle" class="p">Compare with <tspan class="code-sm" fill="${t.indigo}">for concurrent</tspan>: use <tspan class="code-sm" fill="${t.indigo}">for concurrent</tspan> for finite Iterables, <tspan class="code-sm" fill="${t.teal}">for try</tspan> for Streams.</text>
    `,
  },

  // 12. Schema Decode & Encode Boundary
  'schema-codec-flow': {
    height: 300,
    title: 'Schema declarations validate untrusted input and encode typed domain values',
    desc: 'One schema User declaration generates both the TypeScript type and runtime decoder/encoder between untrusted wire data and typed domain objects.',
    body: (t) => `
      <text x="36" y="42" class="h">One schema declaration = runtime codec + TypeScript type</text>
      <text x="36" y="64" class="sub">Validate untrusted JSON once at the edge; inside your app, work with plain typed values.</text>

      <!-- Wire input -->
      ${box(36, 98, 200, 144, t.slateBg, t.slateBorder)}
      <text x="54" y="124" class="k" fill="${t.faint}">EXTERNAL / WIRE</text>
      <text x="54" y="150" class="code" fill="${t.text}">unknown</text>
      <text x="54" y="176" class="code-sm" fill="${t.muted}">{ "id": "42",</text>
      <text x="54" y="194" class="code-sm" fill="${t.muted}">  "role": "admin" }</text>
      <text x="54" y="224" class="p">HTTP body, env, DB row</text>

      <!-- Decode / Encode arrows -->
      <line x1="236" y1="142" x2="314" y2="142" stroke="${t.teal}" stroke-width="2" marker-end="url(#arrow-teal)"/>
      <text x="275" y="132" text-anchor="middle" class="k" fill="${t.teal}">DECODE</text>

      <line x1="314" y1="196" x2="236" y2="196" stroke="${t.indigo}" stroke-width="2" marker-end="url(#arrow-indigo)"/>
      <text x="275" y="216" text-anchor="middle" class="k" fill="${t.indigo}">ENCODE</text>

      <!-- Schema declaration -->
      ${box(322, 98, 236, 144, t.indigoBg, t.indigoBorder)}
      <text x="340" y="124" class="k" fill="${t.indigo}">SCHEMA DECLARATION</text>
      <text x="340" y="150" class="code-sm" fill="${t.text}">schema User {</text>
      <text x="340" y="170" class="code-sm" fill="${t.text}">  readonly id: string</text>
      <text x="340" y="190" class="code-sm" fill="${t.text}">  role: "admin" | "member"</text>
      <text x="340" y="210" class="code-sm" fill="${t.text}">}</text>
      <text x="340" y="232" class="p">Value + Type, zero duplication</text>

      <!-- Success & Failure arrows -->
      <line x1="558" y1="138" x2="626" y2="138" stroke="${t.teal}" stroke-width="2" marker-end="url(#arrow-teal)"/>
      <line x1="558" y1="204" x2="626" y2="204" stroke="${t.red}" stroke-width="2" marker-end="url(#arrow-red)"/>

      <!-- Valid domain value -->
      ${box(634, 98, 210, 64, t.tealBg, t.tealBorder)}
      <text x="652" y="122" class="k" fill="${t.teal}">VALID (A)</text>
      <text x="652" y="144" class="code" fill="${t.text}">User</text>

      <!-- SchemaError -->
      ${box(634, 178, 210, 64, t.redBg, t.redBorder)}
      <text x="652" y="202" class="k" fill="${t.red}">INVALID (E)</text>
      <text x="652" y="224" class="code" fill="${t.red}">Schema.SchemaError</text>

      <text x="440" y="276" text-anchor="middle" class="p">Need a serializable failure? Write <tspan class="code-sm" fill="${t.red}">schema error NotFound { id: string }</tspan>.</text>
    `,
  },

  // 13. Retrying with Schedules
  'retry-schedule-flow': {
    height: 310,
    title: 'Retrying an Effect with a composable Schedule',
    desc: 'Shows how retry(program, schedule) reruns a cold Effect on expected errors with exponential backoff and a retry cap until success or final failure.',
    body: (t) => `
      <text x="36" y="42" class="h">Retry composes a cold Effect with a Schedule policy</text>
      <text x="36" y="64" class="sub">Each expected failure asks the Schedule whether to wait and rerun. Defects and interruption stop immediately.</text>

      <!-- Attempt 1 -->
      ${box(36, 96, 150, 88, t.redBg, t.redBorder)}
      <text x="52" y="122" class="k" fill="${t.red}">ATTEMPT 1</text>
      <text x="52" y="146" class="code-sm" fill="${t.text}">fetchRate()</text>
      <text x="52" y="168" class="p">fails: RateLimited</text>

      <!-- Backoff 1 -->
      <line x1="186" y1="140" x2="254" y2="140" stroke="${t.amber}" stroke-width="2" marker-end="url(#arrow-amber)"/>
      ${pill(190, 108, 60, 22, t.amberBg, t.amberBorder, '100ms', t.amber)}

      <!-- Attempt 2 -->
      ${box(262, 96, 150, 88, t.redBg, t.redBorder)}
      <text x="278" y="122" class="k" fill="${t.red}">ATTEMPT 2</text>
      <text x="278" y="146" class="code-sm" fill="${t.text}">fetchRate()</text>
      <text x="278" y="168" class="p">fails: RateLimited</text>

      <!-- Backoff 2 -->
      <line x1="412" y1="140" x2="480" y2="140" stroke="${t.amber}" stroke-width="2" marker-end="url(#arrow-amber)"/>
      ${pill(416, 108, 60, 22, t.amberBg, t.amberBorder, '200ms', t.amber)}

      <!-- Attempt 3 -->
      ${box(488, 96, 156, 88, t.tealBg, t.tealBorder)}
      <text x="504" y="122" class="k" fill="${t.teal}">ATTEMPT 3</text>
      <text x="504" y="146" class="code-sm" fill="${t.text}">fetchRate()</text>
      <text x="504" y="168" class="p">succeeds: Quote</text>

      <!-- Arrow to Result -->
      <line x1="644" y1="140" x2="692" y2="140" stroke="${t.teal}" stroke-width="2" marker-end="url(#arrow-teal)"/>
      ${box(700, 96, 144, 88, t.card, t.tealBorder)}
      <text x="716" y="122" class="k" fill="${t.teal}">RETURN</text>
      <text x="716" y="148" class="code" fill="${t.text}">Quote</text>
      <text x="716" y="170" class="p">or last E if cap hit</text>

      <!-- Policy strip -->
      ${box(36, 212, 808, 68, t.indigoBg, t.indigoBorder)}
      <text x="56" y="238" class="k" fill="${t.indigo}">COMPOSABLE SCHEDULE</text>
      <text x="56" y="262" class="code-sm" fill="${t.text}">const policy = Schedule.both(Schedule.exponential("100 millis"), Schedule.recurs(3))</text>
      <text x="748" y="262" text-anchor="end" class="code-sm" fill="${t.indigo}">try retry(fetchRate(), policy)</text>
    `,
  },

  // 14. Queue vs PubSub
  'queue-vs-pubsub': {
    height: 330,
    title: 'Queue vs. PubSub message delivery',
    desc: 'Compares point-to-point Queue delivery (each item taken by one consumer with backpressure) against broadcast PubSub delivery (every subscriber receives each message).',
    body: (t) => `
      <text x="36" y="42" class="h">Queue distributes work; PubSub broadcasts events</text>
      <text x="36" y="64" class="sub">Choose Queue when each job should run once. Choose PubSub when every listener needs every event.</text>

      <!-- Left: Queue -->
      ${box(36, 88, 392, 214, t.card, t.indigoBorder)}
      ${pill(54, 104, 150, 24, t.indigoBg, t.indigoBorder, 'QUEUE (1-TO-1)', t.indigo)}
      <text x="54" y="150" class="p">Each offered item goes to exactly one worker.</text>

      ${box(54, 168, 86, 54, t.cardAlt, t.border, 8)}
      <text x="97" y="191" text-anchor="middle" class="b">Producer</text>
      <text x="97" y="210" text-anchor="middle" class="code-sm" fill="${t.indigo}">offer(j)</text>

      <line x1="140" y1="195" x2="170" y2="195" stroke="${t.indigo}" stroke-width="2" marker-end="url(#arrow-indigo)"/>
      ${box(176, 173, 92, 44, t.indigoBg, t.indigoBorder, 8)}
      <text x="222" y="200" text-anchor="middle" class="code-sm" fill="${t.indigo}">[j1, j2, j3]</text>

      <line x1="268" y1="184" x2="306" y2="174" stroke="${t.indigo}" stroke-width="1.8" marker-end="url(#arrow-indigo)"/>
      <line x1="268" y1="206" x2="306" y2="220" stroke="${t.indigo}" stroke-width="1.8" marker-end="url(#arrow-indigo)"/>

      ${box(312, 156, 98, 38, t.tealBg, t.tealBorder, 8)}
      <text x="361" y="180" text-anchor="middle" class="code-sm" fill="${t.teal}">W1 ← j1</text>
      ${box(312, 204, 98, 38, t.tealBg, t.tealBorder, 8)}
      <text x="361" y="228" text-anchor="middle" class="code-sm" fill="${t.teal}">W2 ← j2</text>

      <text x="54" y="276" class="p">Bounded queues apply backpressure when full.</text>

      <!-- Right: PubSub -->
      ${box(452, 88, 392, 214, t.card, t.tealBorder)}
      ${pill(470, 104, 164, 24, t.tealBg, t.tealBorder, 'PUBSUB (1-TO-MANY)', t.teal)}
      <text x="470" y="150" class="p">Every active subscriber receives every message.</text>

      ${box(470, 168, 92, 54, t.cardAlt, t.border, 8)}
      <text x="516" y="191" text-anchor="middle" class="b">Publisher</text>
      <text x="516" y="210" text-anchor="middle" class="code-sm" fill="${t.teal}">publish(e)</text>

      <line x1="562" y1="195" x2="594" y2="195" stroke="${t.teal}" stroke-width="2" marker-end="url(#arrow-teal)"/>
      ${box(600, 173, 76, 44, t.tealBg, t.tealBorder, 8)}
      <text x="638" y="200" text-anchor="middle" class="code-sm" fill="${t.teal}">topic</text>

      <line x1="676" y1="182" x2="718" y2="164" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>
      <line x1="676" y1="195" x2="718" y2="195" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>
      <line x1="676" y1="208" x2="718" y2="226" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>

      ${box(724, 148, 102, 28, t.indigoBg, t.indigoBorder, 6)}
      <text x="775" y="166" text-anchor="middle" class="code-sm" fill="${t.indigo}">Sub A ← e</text>
      ${box(724, 181, 102, 28, t.indigoBg, t.indigoBorder, 6)}
      <text x="775" y="199" text-anchor="middle" class="code-sm" fill="${t.indigo}">Sub B ← e</text>
      ${box(724, 214, 102, 28, t.indigoBg, t.indigoBorder, 6)}
      <text x="775" y="232" text-anchor="middle" class="code-sm" fill="${t.indigo}">Sub C ← e</text>

      <text x="470" y="276" class="p">Subscriptions are Scoped and auto-unsubscribe on exit.</text>
    `,
  },

  // 15. Deferred & Semaphore
  'deferred-and-semaphore': {
    height: 315,
    title: 'Fiber coordination with Deferred and Semaphore',
    desc: 'Shows Deferred as a one-shot async value completed once by one fiber and awaited by others, and Semaphore as a bounded permit gate limiting concurrency.',
    body: (t) => `
      <text x="36" y="42" class="h">Coordinate fibers cleanly with Deferred and Semaphore</text>
      <text x="36" y="64" class="sub">Deferred passes one future result between fibers. Semaphore caps how many fibers enter a critical section at once.</text>

      <!-- Left: Deferred -->
      ${box(36, 88, 392, 198, t.card, t.indigoBorder)}
      ${pill(54, 104, 188, 24, t.indigoBg, t.indigoBorder, 'DEFERRED (ONE-SHOT)', t.indigo)}
      ${box(54, 144, 114, 42, t.cardAlt, t.border, 8)}
      <text x="111" y="169" text-anchor="middle" class="code-sm" fill="${t.text}">Deferred.succeed</text>
      <line x1="168" y1="165" x2="210" y2="165" stroke="${t.indigo}" stroke-width="2" marker-end="url(#arrow-indigo)"/>
      ${box(216, 144, 68, 42, t.indigoBg, t.indigoBorder, 8)}
      <text x="250" y="170" text-anchor="middle" class="code" fill="${t.indigo}">v</text>
      <line x1="284" y1="158" x2="316" y2="148" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>
      <line x1="284" y1="172" x2="316" y2="184" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>
      ${box(322, 134, 88, 28, t.tealBg, t.tealBorder, 6)}
      <text x="366" y="152" text-anchor="middle" class="code-sm" fill="${t.teal}">await → v</text>
      ${box(322, 170, 88, 28, t.tealBg, t.tealBorder, 6)}
      <text x="366" y="188" text-anchor="middle" class="code-sm" fill="${t.teal}">await → v</text>
      <text x="54" y="232" class="p">Completed at most once; subsequent calls return false.</text>
      <text x="54" y="254" class="p">Waiters park without blocking an OS thread.</text>

      <!-- Right: Semaphore -->
      ${box(452, 88, 392, 198, t.card, t.amberBorder)}
      ${pill(470, 104, 196, 24, t.amberBg, t.amberBorder, 'SEMAPHORE (N PERMITS)', t.amber)}
      ${box(470, 144, 96, 56, t.cardAlt, t.border, 8)}
      <text x="518" y="168" text-anchor="middle" class="b">4 fibers</text>
      <text x="518" y="188" text-anchor="middle" class="code-sm" fill="${t.amber}">withPermits(1)</text>
      <line x1="566" y1="172" x2="604" y2="172" stroke="${t.amber}" stroke-width="2" marker-end="url(#arrow-amber)"/>
      ${box(610, 136, 98, 72, t.amberBg, t.amberBorder, 8)}
      <text x="659" y="160" text-anchor="middle" class="k" fill="${t.amber}">PERMITS: 2</text>
      <text x="659" y="182" text-anchor="middle" class="code-sm" fill="${t.text}">2 running</text>
      <text x="659" y="198" text-anchor="middle" class="p">2 queued</text>
      <line x1="708" y1="172" x2="736" y2="172" stroke="${t.teal}" stroke-width="2" marker-end="url(#arrow-teal)"/>
      ${box(742, 144, 84, 56, t.tealBg, t.tealBorder, 8)}
      <text x="784" y="168" text-anchor="middle" class="code-sm" fill="${t.teal}">DB pool</text>
      <text x="784" y="188" text-anchor="middle" class="p">bounded</text>
      <text x="470" y="232" class="p">Permits release automatically on success, error, or cancel.</text>
      <text x="470" y="254" class="p">Use Latch when fibers wait for a gate to open once.</text>
    `,
  },

  // 16. Ref vs SubscriptionRef
  'ref-and-subscriptionref': {
    height: 300,
    title: 'Atomic Ref vs. reactive SubscriptionRef',
    desc: 'Shows Ref providing atomic compare-and-swap state updates across fibers, and SubscriptionRef extending Ref with a changes Stream for subscribers.',
    body: (t) => `
      <text x="36" y="42" class="h">Share mutable state safely with Ref and SubscriptionRef</text>
      <text x="36" y="64" class="sub">Ref makes concurrent updates atomic. SubscriptionRef also streams every state change to listeners.</text>

      <!-- Left: Ref -->
      ${box(36, 88, 386, 184, t.card, t.indigoBorder)}
      ${pill(54, 104, 152, 24, t.indigoBg, t.indigoBorder, 'REF (ATOMIC CELL)', t.indigo)}
      ${box(54, 144, 104, 48, t.cardAlt, t.border, 8)}
      <text x="106" y="166" text-anchor="middle" class="code-sm" fill="${t.text}">Ref.update</text>
      <text x="106" y="183" text-anchor="middle" class="p">n =&gt; n + 1</text>
      <line x1="158" y1="168" x2="202" y2="168" stroke="${t.indigo}" stroke-width="2" marker-end="url(#arrow-indigo)"/>
      ${box(208, 142, 92, 52, t.indigoBg, t.indigoBorder, 8)}
      <text x="254" y="164" text-anchor="middle" class="k" fill="${t.indigo}">STATE</text>
      <text x="254" y="184" text-anchor="middle" class="code" fill="${t.text}">42 → 43</text>
      <line x1="300" y1="168" x2="330" y2="168" stroke="${t.teal}" stroke-width="2" marker-end="url(#arrow-teal)"/>
      ${box(336, 148, 68, 40, t.tealBg, t.tealBorder, 8)}
      <text x="370" y="173" text-anchor="middle" class="code-sm" fill="${t.teal}">get</text>
      <text x="54" y="226" class="p">Need an effectful update? Use <tspan class="code-sm" fill="${t.indigo}">SynchronizedRef</tspan>.</text>
      <text x="54" y="248" class="p">Zero race conditions across concurrent fibers.</text>

      <!-- Right: SubscriptionRef -->
      ${box(444, 88, 400, 184, t.card, t.tealBorder)}
      ${pill(462, 104, 212, 24, t.tealBg, t.tealBorder, 'SUBSCRIPTIONREF (REACTIVE)', t.teal)}
      ${box(462, 142, 96, 52, t.tealBg, t.tealBorder, 8)}
      <text x="510" y="164" text-anchor="middle" class="k" fill="${t.teal}">CELL</text>
      <text x="510" y="184" text-anchor="middle" class="code-sm" fill="${t.text}">v0 → v1</text>
      <line x1="558" y1="168" x2="604" y2="168" stroke="${t.teal}" stroke-width="2" marker-end="url(#arrow-teal)"/>
      ${box(610, 144, 104, 48, t.cardAlt, t.tealBorder, 8)}
      <text x="662" y="166" text-anchor="middle" class="code-sm" fill="${t.teal}">ref.changes</text>
      <text x="662" y="183" text-anchor="middle" class="p">Stream&lt;A&gt;</text>
      <line x1="714" y1="158" x2="748" y2="148" stroke="${t.indigo}" stroke-width="1.8" marker-end="url(#arrow-indigo)"/>
      <line x1="714" y1="178" x2="748" y2="188" stroke="${t.indigo}" stroke-width="1.8" marker-end="url(#arrow-indigo)"/>
      ${box(754, 134, 74, 28, t.indigoBg, t.indigoBorder, 6)}
      <text x="791" y="152" text-anchor="middle" class="code-sm" fill="${t.indigo}">UI view</text>
      ${box(754, 172, 74, 28, t.indigoBg, t.indigoBorder, 6)}
      <text x="791" y="190" text-anchor="middle" class="code-sm" fill="${t.indigo}">Logger</text>
      <text x="462" y="226" class="p">New subscribers receive the current value first,</text>
      <text x="462" y="248" class="p">then every subsequent update in order.</text>
    `,
  },

  // 17. Stream + Operators + Sink Pipeline
  'stream-and-sink-pipeline': {
    height: 300,
    title: 'Pull-based Stream pipeline into a Sink',
    desc: 'Shows how chunks flow lazily from a Stream source through transform operators into a Sink, which folds them into a value and preserves unconsumed leftovers.',
    body: (t) => `
      <text x="36" y="42" class="h">Streams pull chunks lazily through operators into a Sink</text>
      <text x="36" y="64" class="sub">Nothing runs until a Sink or for-try loop demands chunks. Sinks return a result plus any unconsumed leftovers.</text>

      <!-- Source -->
      ${box(36, 98, 174, 96, t.indigoBg, t.indigoBorder)}
      <text x="54" y="124" class="k" fill="${t.indigo}">STREAM SOURCE</text>
      <text x="54" y="148" class="code-sm" fill="${t.text}">Stream.fromIterable</text>
      <text x="54" y="168" class="code-sm" fill="${t.text}">effect function* ()</text>
      <text x="54" y="186" class="p">emits Chunk&lt;A&gt;</text>

      <line x1="210" y1="146" x2="254" y2="146" stroke="${t.indigo}" stroke-width="2" marker-end="url(#arrow-indigo)"/>

      <!-- Operators -->
      ${box(262, 98, 224, 96, t.card, t.border)}
      <text x="280" y="124" class="k" fill="${t.muted}">TRANSFORM OPERATORS</text>
      <text x="280" y="148" class="code-sm" fill="${t.text}">Stream.filter(valid)</text>
      <text x="280" y="168" class="code-sm" fill="${t.text}">Stream.mapEffect(enrich)</text>
      <text x="280" y="186" class="p">bounded memory &amp; backpressure</text>

      <line x1="486" y1="146" x2="530" y2="146" stroke="${t.teal}" stroke-width="2" marker-end="url(#arrow-teal)"/>

      <!-- Sink -->
      ${box(538, 98, 152, 96, t.tealBg, t.tealBorder)}
      <text x="556" y="124" class="k" fill="${t.teal}">SINK&lt;A, In, L&gt;</text>
      <text x="556" y="148" class="code-sm" fill="${t.text}">Sink.sum</text>
      <text x="556" y="168" class="code-sm" fill="${t.text}">Sink.take(3)</text>
      <text x="556" y="186" class="p">folds &amp; stops early</text>

      <line x1="690" y1="130" x2="726" y2="130" stroke="${t.teal}" stroke-width="2" marker-end="url(#arrow-teal)"/>
      <line x1="690" y1="168" x2="726" y2="168" stroke="${t.amber}" stroke-width="2" marker-end="url(#arrow-amber)"/>

      ${box(732, 104, 112, 42, t.tealBg, t.tealBorder, 8)}
      <text x="788" y="129" text-anchor="middle" class="code-sm" fill="${t.teal}">Result A</text>

      ${box(732, 152, 112, 42, t.amberBg, t.amberBorder, 8)}
      <text x="788" y="177" text-anchor="middle" class="code-sm" fill="${t.amber}">Leftover L</text>

      ${box(36, 218, 808, 52, t.cardAlt, t.border, 8)}
      <text x="440" y="249" text-anchor="middle" class="p">Run with <tspan class="code-sm" fill="${t.indigo}">try Stream.run(stream, sink)</tspan> or consume inline with <tspan class="code-sm" fill="${t.teal}">for try (const item of stream) { ... }</tspan>.</text>
    `,
  },

  // 18. Observability Pillars
  'observability-pillars': {
    height: 320,
    title: 'Built-in observability: Logging, Metrics, and Tracing',
    desc: 'Shows how a single Effect fiber automatically propagates annotations, updates metrics, and nests spans across Logging, Metrics, and Tracing.',
    body: (t) => `
      <text x="36" y="42" class="h">One Effect fiber feeds Logging, Metrics, and Tracing</text>
      <text x="36" y="64" class="sub">Fiber context propagates log annotations and parent spans automatically across every try call and forked child.</text>

      <!-- Fiber source -->
      ${box(36, 116, 224, 132, t.indigoBg, t.indigoBorder)}
      <text x="54" y="144" class="k" fill="${t.indigo}">RUNNING EFFECT FIBER</text>
      <text x="54" y="170" class="code-sm" fill="${t.text}">try log("order created")</text>
      <text x="54" y="192" class="code-sm" fill="${t.text}">try Metric.update(c, 1)</text>
      <text x="54" y="214" class="code-sm" fill="${t.text}">try withSpan(work, "pay")</text>
      <text x="54" y="236" class="p">carries FiberRefs + TraceId</text>

      <!-- 3 arrows -->
      <line x1="260" y1="146" x2="342" y2="122" stroke="${t.teal}" stroke-width="2" marker-end="url(#arrow-teal)"/>
      <line x1="260" y1="182" x2="342" y2="182" stroke="${t.amber}" stroke-width="2" marker-end="url(#arrow-amber)"/>
      <line x1="260" y1="218" x2="342" y2="242" stroke="${t.indigo}" stroke-width="2" marker-end="url(#arrow-indigo)"/>

      <!-- Logging -->
      ${box(350, 88, 494, 58, t.tealBg, t.tealBorder)}
      <text x="370" y="112" class="k" fill="${t.teal}">STRUCTURED LOGGING</text>
      <text x="370" y="134" class="p">Level-filtered logs with automatic fiber ID, span, and <tspan class="code-sm" fill="${t.text}">annotateLogs</tspan> fields.</text>

      <!-- Metrics -->
      ${box(350, 154, 494, 58, t.amberBg, t.amberBorder)}
      <text x="370" y="178" class="k" fill="${t.amber}">METRICS (COUNTERS, GAUGES, HISTOGRAMS)</text>
      <text x="370" y="200" class="p">Tagged in-memory measurements exported to Prometheus or OpenTelemetry.</text>

      <!-- Tracing -->
      ${box(350, 220, 494, 58, t.card, t.indigoBorder)}
      <text x="370" y="244" class="k" fill="${t.indigo}">DISTRIBUTED TRACING</text>
      <text x="370" y="266" class="p">Nested parent-child spans with timing, attributes, and error causes.</text>
    `,
  },

  // 19. TestClock Time Travel
  'testclock-time-travel': {
    height: 300,
    title: 'Deterministic virtual time with TestClock',
    desc: 'Compares real wall-clock sleep taking 5 minutes against TestClock.adjust advancing virtual time instantaneously in tests.',
    body: (t) => `
      <text x="36" y="42" class="h">TestClock turns 5-minute sleeps into 0 ms unit tests</text>
      <text x="36" y="64" class="sub">Fork the timed Effect, jump virtual time with TestClock.adjust, and join the exact result deterministically.</text>

      <!-- Real Clock -->
      ${box(36, 92, 808, 72, t.redBg, t.redBorder)}
      ${pill(54, 114, 128, 26, t.card, t.redBorder, 'REAL CLOCK', t.red)}
      <text x="200" y="124" class="code-sm" fill="${t.text}">try sleep("5 minutes")</text>
      <text x="200" y="146" class="p">Blocks the test suite for 300,000 ms — slow and flaky on CI.</text>

      <!-- TestClock -->
      ${box(36, 180, 808, 92, t.tealBg, t.tealBorder)}
      ${pill(54, 202, 128, 26, t.card, t.tealBorder, 'TESTCLOCK', t.teal)}

      ${box(200, 196, 178, 56, t.card, t.indigoBorder, 8)}
      <text x="216" y="218" class="k" fill="${t.indigo}">1. FORK</text>
      <text x="216" y="238" class="code-sm" fill="${t.text}">const f = fork work()</text>

      <line x1="378" y1="224" x2="416" y2="224" stroke="${t.teal}" stroke-width="2" marker-end="url(#arrow-teal)"/>

      ${box(424, 196, 214, 56, t.card, t.tealBorder, 8)}
      <text x="440" y="218" class="k" fill="${t.teal}">2. JUMP VIRTUAL TIME</text>
      <text x="440" y="238" class="code-sm" fill="${t.text}">TestClock.adjust("5 minutes")</text>

      <line x1="638" y1="224" x2="676" y2="224" stroke="${t.teal}" stroke-width="2" marker-end="url(#arrow-teal)"/>

      ${box(684, 196, 142, 56, t.card, t.tealBorder, 8)}
      <text x="700" y="218" class="k" fill="${t.teal}">3. JOIN (0 ms)</text>
      <text x="700" y="238" class="code-sm" fill="${t.text}">const v = join f</text>
    `,
  },

  // 20. Batching & Caching
  'batching-and-caching': {
    height: 315,
    title: 'Request batching and TTL Cache',
    desc: 'Shows concurrent Request calls collapsed by a RequestResolver into a single batched backend query, with a Cache serving repeat lookups within TTL.',
    body: (t) => `
      <text x="36" y="42" class="h">Eliminate N+1 queries with RequestResolver batching and Cache</text>
      <text x="36" y="64" class="sub">Concurrent Effect requests automatically group into one batch; Cache deduplicates repeated lookups in memory.</text>

      <!-- Callers -->
      ${box(36, 94, 176, 46, t.card, t.indigoBorder, 8)}
      <text x="124" y="122" text-anchor="middle" class="code-sm" fill="${t.text}">getUser(1)</text>
      ${box(36, 152, 176, 46, t.card, t.indigoBorder, 8)}
      <text x="124" y="180" text-anchor="middle" class="code-sm" fill="${t.text}">getUser(2)</text>
      ${box(36, 210, 176, 46, t.card, t.indigoBorder, 8)}
      <text x="124" y="238" text-anchor="middle" class="code-sm" fill="${t.text}">getUser(1)  (dup)</text>

      <!-- Arrows to Cache -->
      <line x1="212" y1="117" x2="274" y2="152" stroke="${t.indigo}" stroke-width="1.8" marker-end="url(#arrow-indigo)"/>
      <line x1="212" y1="175" x2="274" y2="175" stroke="${t.indigo}" stroke-width="1.8" marker-end="url(#arrow-indigo)"/>
      <line x1="212" y1="233" x2="274" y2="198" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>

      <!-- Cache / Dedupe -->
      ${box(282, 118, 174, 114, t.tealBg, t.tealBorder)}
      <text x="300" y="146" class="k" fill="${t.teal}">CACHE &amp; DEDUPE</text>
      <text x="300" y="170" class="p">TTL + capacity bound</text>
      <text x="300" y="192" class="code-sm" fill="${t.teal}">key 1 hit / shared</text>
      <text x="300" y="214" class="p">misses forward keys [1, 2]</text>

      <line x1="456" y1="175" x2="506" y2="175" stroke="${t.amber}" stroke-width="2" marker-end="url(#arrow-amber)"/>

      <!-- Batched Resolver -->
      ${box(514, 118, 172, 114, t.amberBg, t.amberBorder)}
      <text x="532" y="146" class="k" fill="${t.amber}">REQUESTRESOLVER</text>
      <text x="532" y="170" class="code-sm" fill="${t.text}">makeBatched</text>
      <text x="532" y="192" class="p">1 round trip:</text>
      <text x="532" y="214" class="code-sm" fill="${t.amber}">WHERE id IN (1,2)</text>

      <line x1="686" y1="175" x2="726" y2="175" stroke="${t.indigo}" stroke-width="2" marker-end="url(#arrow-indigo)"/>

      <!-- Backend -->
      ${box(734, 134, 110, 82, t.card, t.border)}
      <text x="789" y="168" text-anchor="middle" class="b">Database</text>
      <text x="789" y="190" text-anchor="middle" class="p">or HTTP API</text>

      <text x="440" y="290" text-anchor="middle" class="p">Run callers concurrently with <tspan class="code-sm" fill="${t.indigo}">try.all</tspan> or <tspan class="code-sm" fill="${t.indigo}">for concurrent</tspan> so Effect can batch them together.</text>
    `,
  },

  // 21. HTTP & Platform Layer Stack
  'http-layer-stack': {
    height: 325,
    title: 'Platform and HTTP server layer stack',
    desc: 'Shows portable application routes and handlers depending only on abstract HttpRouter and Platform services, wired once at main to Node, Bun, or Browser layers.',
    body: (t) => `
      <text x="36" y="42" class="h">Write portable handlers; wire the host platform once at main()</text>
      <text x="36" y="64" class="sub">Business routes depend on abstract Effect services. Swap Node, Bun, or test layers without editing handlers.</text>

      <!-- Top layer: App Routes -->
      ${box(36, 88, 808, 62, t.indigoBg, t.indigoBorder)}
      <text x="56" y="114" class="k" fill="${t.indigo}">1. APPLICATION ROUTES &amp; HANDLERS (.vibe)</text>
      <text x="56" y="136" class="p">HttpRouter routes, Schema request validation, typed errors, and domain services (Users, Clock, FileSystem).</text>

      <line x1="440" y1="150" x2="440" y2="172" stroke="${t.indigo}" stroke-width="2" marker-end="url(#arrow-indigo)"/>

      <!-- Middle layer: Abstract Platform Services -->
      ${box(36, 178, 808, 56, t.card, t.tealBorder)}
      <text x="56" y="202" class="k" fill="${t.teal}">2. PORTABLE SERVICE CONTRACTS (R CHANNEL)</text>
      <text x="56" y="222" class="code-sm" fill="${t.text}">HttpServer   ·   HttpClient   ·   FileSystem   ·   Path   ·   Terminal   ·   ChildProcessSpawner</text>

      <line x1="200" y1="234" x2="200" y2="254" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>
      <line x1="440" y1="234" x2="440" y2="254" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>
      <line x1="680" y1="234" x2="680" y2="254" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>

      <!-- Bottom: Host Adapters -->
      ${box(36, 260, 254, 46, t.tealBg, t.tealBorder, 8)}
      <text x="163" y="288" text-anchor="middle" class="code-sm" fill="${t.teal}">NodeHttpServer / NodeServices</text>

      ${box(313, 260, 254, 46, t.amberBg, t.amberBorder, 8)}
      <text x="440" y="288" text-anchor="middle" class="code-sm" fill="${t.amber}">BunHttpServer / BunServices</text>

      ${box(590, 260, 254, 46, t.cardAlt, t.border, 8)}
      <text x="717" y="288" text-anchor="middle" class="code-sm" fill="${t.muted}">In-memory Test Layers</text>
    `,
  },

  // 22. Exhaustive Match & Narrowing
  'match-exhaustiveness': {
    height: 315,
    title: 'Exhaustive match narrowing across tagged unions',
    desc: 'Shows a tagged error union entering match (e), branching into narrowed when arms, and failing at compile time if any variant is omitted.',
    body: (t) => `
      <text x="36" y="42" class="h">match narrows each variant and catches missing cases at compile time</text>
      <text x="36" y="64" class="sub">Add a new error or data variant anywhere, and the compiler points straight to every match that must handle it.</text>

      <!-- Input union -->
      ${box(36, 114, 210, 134, t.indigoBg, t.indigoBorder)}
      <text x="54" y="142" class="k" fill="${t.indigo}">INPUT UNION</text>
      <text x="54" y="168" class="code-sm" fill="${t.text}">NotFound</text>
      <text x="54" y="190" class="code-sm" fill="${t.text}">| RateLimited</text>
      <text x="54" y="212" class="code-sm" fill="${t.text}">| Timeout</text>
      <text x="54" y="236" class="p">3 known variants</text>

      <!-- Branches -->
      <line x1="246" y1="150" x2="318" y2="118" stroke="${t.indigo}" stroke-width="2" marker-end="url(#arrow-indigo)"/>
      <line x1="246" y1="181" x2="318" y2="181" stroke="${t.indigo}" stroke-width="2" marker-end="url(#arrow-indigo)"/>
      <line x1="246" y1="212" x2="318" y2="244" stroke="${t.indigo}" stroke-width="2" marker-end="url(#arrow-indigo)"/>

      <!-- Arms -->
      ${box(326, 92, 272, 52, t.card, t.tealBorder, 8)}
      <text x="344" y="114" class="code-sm" fill="${t.teal}">when NotFound(let id):</text>
      <text x="344" y="134" class="p">404 — binds id as string</text>

      ${box(326, 155, 272, 52, t.card, t.tealBorder, 8)}
      <text x="344" y="177" class="code-sm" fill="${t.teal}">when RateLimited(let retryAfter):</text>
      <text x="344" y="197" class="p">429 — binds retryAfter as number</text>

      ${box(326, 218, 272, 52, t.card, t.tealBorder, 8)}
      <text x="344" y="240" class="code-sm" fill="${t.teal}">when Timeout:</text>
      <text x="344" y="260" class="p">504 — remaining union is never</text>

      <!-- Gate -->
      <line x1="598" y1="118" x2="648" y2="165" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>
      <line x1="598" y1="181" x2="648" y2="181" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>
      <line x1="598" y1="244" x2="648" y2="197" stroke="${t.teal}" stroke-width="1.8" marker-end="url(#arrow-teal)"/>

      ${box(656, 122, 188, 118, t.tealBg, t.tealBorder)}
      <text x="674" y="150" class="k" fill="${t.teal}">EXHAUSTIVE CHECK</text>
      <text x="674" y="174" class="b">All 3 covered</text>
      <text x="674" y="198" class="p">Miss any variant →</text>
      <text x="674" y="218" class="code-sm" fill="${t.red}">compile error</text>
    `,
  },
}

let written = 0
for (const [name, spec] of Object.entries(DIAGRAMS)) {
  for (const theme of ['light', 'dark']) {
    const suffix = theme === 'dark' ? '-dark' : ''
    const file = path.join(outDir, `${name}${suffix}.svg`)
    fs.writeFileSync(file, wrapSvg({ ...spec, theme }))
    written++
  }
}
console.log(`render-diagrams: wrote ${written} SVG files (${Object.keys(DIAGRAMS).length} diagrams x light/dark) to ${outDir}`)
