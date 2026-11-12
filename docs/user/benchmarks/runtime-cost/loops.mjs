// The loops the runner times, in the order of the docs table. Each `label`
// is that loop's row label on the "Runtime cost" docs page.
export const loops = [
  {
    id: "vibelang-try",
    label: "200,000 Effect-contracted VibeLang calls without `catch`",
    module: "vibe-loops.js",
    exportName: "tryLoop",
    calls: 200_000,
  },
  {
    id: "effect-fn",
    label: "200,000 `Effect.fn` generator calls",
    module: "effect-loops.js",
    exportName: "fnLoop",
    calls: 200_000,
  },
  {
    id: "vibelang-catch",
    label: "1,000,000 `step(n) catch () => 0` expressions",
    module: "vibe-loops.js",
    exportName: "catchLoop",
    calls: 1_000_000,
  },
  {
    id: "effect-or-else-succeed",
    label: "1,000,000 `Effect.succeed`/`Effect.fail` steps with `Effect.orElseSucceed`",
    module: "effect-loops.js",
    exportName: "orElseSucceedLoop",
    calls: 1_000_000,
  },
  {
    id: "plain-function",
    label: "1,000,000 `plainStep(n)` plain-function calls from effect code",
    module: "vibe-loops.js",
    exportName: "plainLoop",
    calls: 1_000_000,
  },
]

// The value each loop returns after `count` calls. The step fails when the
// next value is a multiple of 250,000; recovery and `plainStep` reset to zero.
export const expected = (loop, count) => (loop.calls === 200_000 ? count : count % 250_000)

const ms = (value) =>
  value < 10 ? `${value.toFixed(1)} ms` : `${Math.round(value).toLocaleString("en-US")} ms`
const ns = (value) =>
  value < 10 ? `${value.toFixed(1)} ns` : `${Math.round(value).toLocaleString("en-US")} ns`

// The docs table rows for a results file, one per loop, in table order.
export const tableRows = (results) =>
  results.loops.map(
    (loop) => `| ${loop.label} | ${ms(loop.minMs)} | ${ms(loop.medianMs)} | ${ms(loop.maxMs)} | ${ns(loop.medianNsPerCall)} |`,
  )

export const tableHeader = ["| Loop | Min | Median | Max | Median per call |", "| --- | ---: | ---: | ---: | ---: |"]
