# Metrics

Effect's `Metric` module instruments counts, current levels, durations, and distributions. Metric definitions are pure values shared by identity (name + type + attributes); updating a metric, inspecting its value, or wrapping a computation with tracking returns an Effect executed with `try`.

| Metric | Tracks | Typical use |
| --- | --- | --- |
| `Metric.counter` | Cumulative sum (number or `bigint`) | Request totals, bytes transferred |
| `Metric.gauge` | Latest scalar value (number or `bigint`) | Queue depth, active connections |
| `Metric.histogram` | Bucketed distribution + count/sum/min/max | Payload sizes, cross-instance latency |
| `Metric.timer` | Millisecond histogram over `Duration` | Operation latency via `trackDuration` |
| `Metric.summary` | Sliding-window quantiles (`maxAge`, `maxSize`) | Single-instance percentile snapshots |
| `Metric.frequency` | Occurrences per string category | Error tags, bounded status codes |

## Recording counters and gauges

```vibe
// run: { const jsonValue = try recordBatch(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(String((try Metric.value(bytes)).count)); { const jsonValue = try recordBatch(); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const requests = Metric.counter("guide_requests", { incremental: true })
const queued = Metric.gauge("guide_queued")
const bytes = Metric.counter("guide_bytes", { bigint: true })

effect function recordBatch() {
  try Metric.update(requests, 1)
  try Metric.update(requests, 3)
  try Metric.update(queued, 12)
  try Metric.update(queued, 5)
  try Metric.update(bytes, 4096n)
  return {
    requests: (try Metric.value(requests)).count,
    queued: (try Metric.value(queued)).value
  }
}

```

```output
{"requests":4,"queued":5}
4096
{"requests":8,"queued":5}
```

Counters sum updates over time; gauges retain only their latest value. Setting `incremental: true` makes a counter monotonic by ignoring negative deltas, and `bigint: true` enables 64-bit-plus counts on both counters and gauges. Metric state is keyed by identity in the runtime registry, so the second call to `recordBatch()` advances `requests` from `4` to `8`.

```vibe
// run: try Console.log(try instrumentedValue(), (try Metric.value(completions)).count)
const completions = Metric.withConstantInput(
  Metric.counter("guide_completions", { incremental: true }),
  1
)

effect function instrumentedValue() {
  return try trackSuccesses(effect { return "processed" }, completions)
}
```

```output
processed 1
```

`trackSuccesses` forwards a program's return value to a metric without altering the result. Wrapping a counter in `Metric.withConstantInput(..., 1)` ignores the return type and increments by `1` on every success.

## Measuring distributions

```vibe
// run: const result = try recordSizes(); { const jsonValue = { count: result.histogram.count, sum: result.histogram.sum, min: result.histogram.min, max: result.histogram.max, buckets: result.histogram.buckets }; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }; try Console.log(result.summary.count, result.summary.sum, result.summary.min, result.summary.max)
const batchSizes = Metric.histogram("guide_batch_size", {
  boundaries: Metric.linearBoundaries({ start: 0, width: 20, count: 6 })
})
const recentSizes = Metric.summary("guide_recent_batch_size", {
  maxAge: "10 minutes",
  maxSize: 200,
  quantiles: [0.5, 0.9, 0.99]
})

effect function recordSizes() {
  for (const size of [12, 36, 8, 91]) {
    try Metric.update(batchSizes, size)
    try Metric.update(recentSizes, size)
  }
  return {
    histogram: try Metric.value(batchSizes),
    summary: try Metric.value(recentSizes)
  }
}
```

```output
{"count":4,"sum":147,"min":8,"max":91,"buckets":[[20,2],[40,3],[60,3],[80,3],[null,4]]}
4 147 8 91
```

Histograms group values into fixed cumulative buckets (`Metric.linearBoundaries`, `exponentialBoundaries`, or explicit arrays), making them safe to merge across servers. Summaries compute quantiles over a bounded rolling sample (`maxAge`, `maxSize`)—accurate locally, but never mathematically valid to average across instances.

## Timing computations

```vibe
// run: provide TestClock.layer() { const worker = fork render(); try TestClock.adjust("30 millis"); try Console.log(join worker); const state = try Metric.value(renderTime); try Console.log(state.count, state.sum, state.min, state.max) }
const renderTime = Metric.timer("guide_render_duration", {
  boundaries: [5, 20, 50, 100, 500]
})

effect function render() {
  return try trackDuration(effect {
    try sleep("30 millis")
    return "rendered"
  }, renderTime)
}
```

```output
rendered
1 30 30 30
```

`trackDuration` measures wall-clock (or `TestClock`) elapsed time—including suspension and I/O waits—and passes the computation's return value through unchanged. `Metric.timer` is a histogram whose boundaries and recorded values are in milliseconds.

## Counting categorical events

```vibe
// run: { const jsonValue = Array.from(try recordOutcomes()).sort(([a], [b]) => Order.String(a, b)); try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
const outcomes = Metric.frequency("guide_validation_outcomes")

effect function recordOutcomes() {
  try Metric.update(outcomes, "accepted")
  try Metric.update(outcomes, "rejected")
  try Metric.update(outcomes, "accepted")
  return (try Metric.value(outcomes)).occurrences
}
```

```output
[["accepted",2],["rejected",1]]
```

`Metric.frequency` counts occurrences per distinct string key. Restrict inputs to a small, bounded vocabulary (status kinds, error tags); high-cardinality identifiers like user or request IDs belong in logs or span attributes, never metric series.

## Attaching attributes to metrics and regions

```vibe
// run: const result = try attributed(); try Console.log(result.requests.count, result.failures.count); try Console.log((try Metric.value(apiRequests)).count, (try Metric.value(failures)).count)
const apiRequests = Metric.withAttributes(
  Metric.counter("guide_api_requests", { incremental: true }),
  { route: "/reports" }
)
const failures = Metric.counter("guide_api_failures", { incremental: true })

effect function attributed() {
  provide Metric.CurrentMetricAttributes = { environment: "staging" } {
    try Metric.update(apiRequests, 1)
    try Metric.update(failures, 1)
    return {
      requests: try Metric.value(apiRequests),
      failures: try Metric.value(failures)
    }
  }
}
```

```output
1 1
0 0
```

`Metric.withAttributes` binds static attributes to one metric definition. `Metric.CurrentMetricAttributes` attaches ambient attributes to *every* metric operation in its `provide` block—reads included. Because each unique attribute set defines a separate time series, reading `apiRequests` outside the `staging` block returns `0`, not `1`. Keep attribute cardinality bounded (environment, route, region).
