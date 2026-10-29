# Logging

Effect's structured logging records progress, failures, and diagnostic context. Log functions return Effects; run them with `try` inside an effect function or block. The current logging configuration decides which records are emitted and where.

## Emitting structured records

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-6, VIP-12, VIP-14
// run: const records: unknown[] = []; const capture = Logger.make(({ logLevel, message }) => { records.push([logLevel, message]) }); provide Logger.layer([capture]) { try reportProgress() }; try Console.log(try stringify(records))
effect reportProgress() {
  try log("export started", { format: "csv", stage: "prepare" })
  try logInfo("export completed", { rows: 240 })
}

effect stringify(value: unknown) {
  return try Effect.try(() => JSON.stringify(value))
}

```

```output
[["Info",["export started",{"format":"csv","stage":"prepare"}]],["Info",["export completed",{"rows":240}]]]
```

`log` logs at Info and takes several messages or structured values. Default output shows time, severity, fiber identity, and messages. Pass a `Cause` beside a message to keep failure detail; don't flatten it to a string.

## Selecting severity thresholds

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-12, VIP-14
// run: const records: unknown[] = []; const capture = Logger.make(({ logLevel, message }) => { records.push([logLevel, message]) }); provide Logger.layer([capture]) { try diagnostics() }; try Console.log(try stringify(records))
effect diagnostics() {
  provide References.MinimumLogLevel = "Debug" {
    try logTrace("entered parser")
    try logDebug("parsed header")
    try logInfo("input accepted")
    try logWarning("using fallback settings")
    try logError("destination unavailable")
    try logFatal("application cannot start")
  }
}
```

```output
[["Debug",["parsed header"]],["Info",["input accepted"]],["Warn",["using fallback settings"]],["Error",["destination unavailable"]],["Fatal",["application cannot start"]]]
```

The default threshold, Info, filters Debug and Trace. Providing Debug enables Debug in this region only; Trace stays filtered. Severity only labels a record: even `logFatal` doesn't fail or end the program.

## Annotating logs and scoped regions

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-12, VIP-14
// run: const records: unknown[] = []; const capture = Logger.make(({ message, fiber }) => { records.push([message, fiber.getRef(References.CurrentLogAnnotations)]) }); provide Logger.layer([capture]) { try annotatedExport(); try scopedAnnotations() }; try Console.log(try stringify(records))
effect annotatedExport() {
  try annotateLogs(effect {
    try logInfo("preparing")
    try annotateLogs(logInfo("writing"), "stage", "write")
  }, { operation: "weekly-export", format: "csv" })
  try logInfo("outside annotated operation")
}

effect scopedAnnotations() {
  try scoped(effect {
    try annotateLogsScoped({ component: "importer" })
    try logInfo("reading input")
    try logInfo("validating rows")
  })
  try logInfo("outside importer scope")
}
```

```output
[[["preparing"],{"operation":"weekly-export","format":"csv"}],[["writing"],{"operation":"weekly-export","format":"csv","stage":"write"}],[["outside annotated operation"],{}],[["reading input"],{"component":"importer"}],[["validating rows"],{"component":"importer"}],[["outside importer scope"],{}]]
```

`annotateLogs` adds key/value metadata to every record in its program, nested calls and inherited child context included. `annotateLogsScoped` annotates until the supplied runtime scope closes; plain braces supply no scope, so use `try scoped(effect { ... })`.

## Measuring log spans

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-12, VIP-14, VIP-17
// run: const records: unknown[] = []; const capture = Logger.make(({ message, fiber, date }) => { records.push([message, fiber.getRef(References.CurrentLogSpans).map(([label, start]) => [label, date.getTime() - start])]) }); provide TestClock.layer() { try TestClock.setTime(0); provide Logger.layer([capture]) { const worker = fork timedExport(); try TestClock.adjust("30 millis"); join worker } }; try Console.log(try stringify(records))
effect timedExport() {
  try withLogSpan(effect {
    try logInfo("opening output")
    try sleep("30 millis")
    try logInfo("output written")
  }, "write-output")
}
```

```output
[[["opening output"],[["write-output",0]]],[["output written"],[["write-output",30]]]]
```

Each record inside the log span carries the time elapsed since the span began, so the second includes the wait. A log span only enriches logs; use tracing spans for parent/child relationships and exportable traces.

## Disabling and configuring logging

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-12, VIP-14
// run: const records: unknown[] = []; const capture = Logger.make(({ logLevel, message }) => { records.push([logLevel, message]) }); provide Logger.layer([capture]) { try quiet(); provide ConfigProvider.layer(ConfigProvider.fromUnknown({ LOG_LEVEL: "Debug" })) { try configured() } }; try Console.log(try stringify(records))
const Silent = Layer.succeed(References.MinimumLogLevel, "None")
const LogLevel = Config.LogLevel("LOG_LEVEL")

const ConfiguredLevel = Layer.unwrap(effect {
  const minimum = try LogLevel
  return Layer.succeed(References.MinimumLogLevel, minimum)
})

effect quiet() {
  provide Silent { try logInfo("suppressed") }
}

effect configured() {
  provide ConfiguredLevel { try logDebug("configuration loaded") }
}
```

```output
[["Debug",["configuration loaded"]]]
```

The None threshold silences the provided region. `Config.LogLevel` builds a configuration value; `try LogLevel` reads and validates it when the layer builds, and reports configuration errors then. Supply the configuration layer once at the application boundary, or in a shared `ManagedRuntime` for several entry points.

## Defining a custom output handler

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-12, VIP-14
// run: try Console.log(try stringify(try captureLogs()))
effect captureLogs() {
  const records: Array<{ level: string; message: unknown }> = []
  const capture = Logger.make(({ logLevel, message }) => {
    records.push({ level: logLevel, message })
  })
  provide Logger.layer([capture, Logger.tracerLogger]) {
    try logInfo("batch accepted", { count: 3 })
    try logWarning("one retry required")
  }
  return records
}
```

```output
[{"level":"Info","message":["batch accepted",{"count":3}]},{"level":"Warn","message":["one retry required"]}]
```

`Logger.make` takes a synchronous callback that receives the message, level, cause, emitting fiber, and date. This one only stores values in memory, so it can be a plain JavaScript callback. Don't call a pausing service inside it; for asynchronous output, use an Effect-aware destination such as an exporter layer.

## Choosing text, structured, and JSON formats

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-12, VIP-14
// run: const records: unknown[] = []; const original = try Console.Console; try provideService(jsonExample(), Console.Console, { ...original, log: (line: string) => { const record = JSON.parse(line); records.push([record.level, record.message]) } }); try Console.log(try stringify(records))
const TextLogs = Logger.layer([Logger.consoleLogFmt, Logger.tracerLogger])
const PrettyLogs = Logger.layer([Logger.consolePretty(), Logger.tracerLogger])
const ObjectLogs = Logger.layer([Logger.consoleStructured, Logger.tracerLogger])
const JsonLogs = Logger.layer([Logger.consoleJson, Logger.tracerLogger])

effect jsonExample() {
  provide JsonLogs { try logInfo("started", { workers: 4 }) }
}
```

```output
[["INFO",["started",{"workers":4}]]]
```

The default logger emits readable text, LogFmt compact key/value pairs, and Pretty visual formatting. Structured output keeps an object of messages, level, timestamp, annotations, cause, log spans, and fiber identity; JSON serializes it for ingestion. For formatted output without console delivery, a custom handler uses the matching formatter loggers `formatSimple`, `formatLogFmt`, `formatStructured`, and `formatJson`.

## Sending records to multiple destinations

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-12, VIP-14
// run: const lines: unknown[][] = []; const original = try Console.Console; const audit = try provideService(consoleAndCapture(), Console.Console, { ...original, log: (...args: ReadonlyArray<unknown>) => { lines.push([...args]) } }); try Console.log(try stringify(audit), lines.length, (try stringify(lines)).includes("job finished"))
effect consoleAndCapture() {
  const auditMessages: unknown[] = []
  const audit = Logger.make(({ message }) => { auditMessages.push(message) })
  const destinations = Logger.layer([
    Logger.defaultLogger,
    audit,
    Logger.tracerLogger
  ])
  provide destinations { try logInfo("job finished") }
  return auditMessages
}
```

```output
[["job finished"]] 1 true
```

Every active logger receives each record that passes the threshold. `Logger.layer` replaces the active loggers; `mergeWithExisting: true` adds to them instead. Include `tracerLogger` to also record logs as events on the current tracing span.
