# Metrics in VibeLang

Effect's `Metric` module counts events, records current values, and measures distributions over time. Metric constructors build values exactly as in Effect; updates, state reads, and instrumented programs return Effects that run with `try`.

## Recording counters and gauges

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-14
// run: try Console.log(try stringify(try recordBatch())); try Console.log(String((try Metric.value(bytes)).count)); try Console.log(try stringify(try recordBatch()))
const requests = Metric.counter("guide_requests", { incremental: true })
const queued = Metric.gauge("guide_queued")
const bytes = Metric.counter("guide_bytes", { bigint: true })

effect recordBatch() {
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

effect stringify(value: unknown) {
  return try Effect.try(() => JSON.stringify(value))
}

```

```output
{"requests":4,"queued":5}
4096
{"requests":8,"queued":5}
```

A counter accumulates changes; a gauge keeps its latest value. `incremental: true` ignores negative counter inputs; without it, a counter also decrements. Counters and gauges both have bigint variants. Updates to the same metric identity share state, so the totals above accumulate across runs.

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14
// run: try Console.log(try instrumentedValue(), (try Metric.value(completions)).count)
const completions = Metric.withConstantInput(
  Metric.counter("guide_completions", { incremental: true }),
  1
)

effect instrumentedValue() {
  return try trackSuccesses(effect { return "processed" }, completions)
}
```

```output
processed 1
```

`trackSuccesses` sends a successful return value to a metric and leaves the program's result unchanged. `withConstantInput` replaces that input with one, so this metric counts successes whatever the string.

## Measuring distributions

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: const result = try recordSizes(); try Console.log(try stringify({ count: result.histogram.count, sum: result.histogram.sum, min: result.histogram.min, max: result.histogram.max, buckets: result.histogram.buckets })); try Console.log(result.summary.count, result.summary.sum, result.summary.min, result.summary.max)
const batchSizes = Metric.histogram("guide_batch_size", {
  boundaries: Metric.linearBoundaries({ start: 0, width: 20, count: 6 })
})
const recentSizes = Metric.summary("guide_recent_batch_size", {
  maxAge: "10 minutes",
  maxSize: 200,
  quantiles: [0.5, 0.9, 0.99]
})

effect recordSizes() {
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

A histogram sorts observations into configured buckets and tracks count, sum, minimum, and maximum; its boundaries set precision and allow aggregation across instances. A summary keeps recent samples, bounded by `maxAge` and `maxSize`, and computes quantiles over that window; don't average its quantiles across instances.

## Timing computations

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-12, VIP-14, VIP-17
// run: provide TestClock.layer() { const worker = fork render(); try TestClock.adjust("30 millis"); try Console.log(join worker); const state = try Metric.value(renderTime); try Console.log(state.count, state.sum, state.min, state.max) }
const renderTime = Metric.timer("guide_render_duration", {
  boundaries: [5, 20, 50, 100, 500]
})

effect render() {
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

`trackDuration` records the wrapped computation's duration, time spent waiting included, and keeps its return value. `Metric.timer` is a duration-input histogram whose bucket boundaries and stored values are milliseconds.

## Counting categorical events

```vibe
// pending: VIP-1, VIP-5, VIP-14
// run: try Console.log(try stringify(Array.from(try recordOutcomes()).sort(([a], [b]) => Order.String(a, b))))
const outcomes = Metric.frequency("guide_validation_outcomes")

effect recordOutcomes() {
  try Metric.update(outcomes, "accepted")
  try Metric.update(outcomes, "rejected")
  try Metric.update(outcomes, "accepted")
  return (try Metric.value(outcomes)).occurrences
}
```

```output
[["accepted",2],["rejected",1]]
```

A frequency metric counts each observed string. Use a bounded set of categories, such as result kinds or error tags; user and request IDs are unbounded and belong in logs or span attributes.

## Attaching attributes to metrics and regions

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-12, VIP-14
// run: const result = try attributed(); try Console.log(result.requests.count, result.failures.count); try Console.log((try Metric.value(apiRequests)).count, (try Metric.value(failures)).count)
const apiRequests = Metric.withAttributes(
  Metric.counter("guide_api_requests", { incremental: true }),
  { route: "/reports" }
)
const failures = Metric.counter("guide_api_failures", { incremental: true })

effect attributed() {
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

`withAttributes` adds attributes to one metric. `CurrentMetricAttributes` adds attributes to every metric operation in a region, reads included, so read state under the attributes you updated it with. Each attribute combination is a separate series; prefer bounded categories such as deployment and route.
