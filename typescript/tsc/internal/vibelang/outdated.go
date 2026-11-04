package vibelang

// effect3API lists names removed by Effect 4 (EK4813), from the migration
// table of @effect/language-service 0.87.5 (outdatedApi). An entry names its
// replacement and notes any changed callback or result contract. Only an
// equivalent rename has an automatic fix; a noted contract change or a
// removed name requires a manual migration.
var effect3API = map[string]apiChange{
	"catchAll":               {renamed: "catch"},
	"catchAllCause":          {renamed: "catchCause"},
	"catchAllDefect":         {renamed: "catchDefect"},
	"ensureErrorType":        {renamed: "satisfiesErrorType"},
	"ensureRequirementsType": {renamed: "satisfiesServicesType"},
	"ensureSuccessType":      {renamed: "satisfiesSuccessType"},
	"fork":                   {renamed: "forkChild"},
	"forkDaemon":             {renamed: "forkDetach"},
	"scopeWith":              {renamed: "scopedWith"},
	"serviceOptional":        {renamed: "serviceOption"},
	"tapErrorCause":          {renamed: "tapCause"},
	"async":                  {renamed: "callback", note: "Effect 4's callback also passes the Scheduler as this."},
	"either":                 {renamed: "result", note: "It succeeds with a Result, not an Either; use the Result module on it."},
	"withFiberRuntime":       {renamed: "withFiber", note: "Its function receives only the Fiber, without a status."},

	"EffectTypeId": {}, "Service": {}, "Tag": {}, "acquireReleaseInterruptible": {}, "allSuccesses": {},
	"allWith": {}, "allowInterrupt": {}, "ap": {}, "asSomeError": {}, "asyncEffect": {}, "bindAll": {},
	"blocked": {}, "cacheRequestResult": {}, "cachedFunction": {}, "catchSome": {}, "catchSomeCause": {},
	"catchSomeDefect": {}, "cause": {}, "checkInterruptible": {}, "clock": {}, "configProviderWith": {},
	"console": {}, "consoleWith": {}, "contextWithEffect": {}, "custom": {}, "daemonChildren": {},
	"descriptor": {}, "descriptorWith": {}, "dieMessage": {}, "dieSync": {}, "diffFiberRefs": {},
	"disconnect": {}, "dropUntil": {}, "dropWhile": {}, "ensuringChild": {}, "ensuringChildren": {},
	"every": {}, "exists": {}, "fiberIdWith": {}, "filterEffectOrElse": {}, "filterEffectOrFail": {},
	"filterOrDie": {}, "filterOrDieMessage": {}, "finalizersMask": {}, "flipWith": {}, "forkAll": {},
	"forkWithErrorHandler": {}, "fromFiber": {}, "fromFiberEffect": {}, "fromNullable": {},
	"functionWithSpan": {}, "getFiberRefs": {}, "getRuntimeFlags": {}, "if": {}, "ignoreLogged": {},
	"inheritFiberRefs": {}, "interruptWith": {}, "intoDeferred": {}, "iterate": {}, "labelMetrics": {},
	"labelMetricsScoped": {}, "liftPredicate": {}, "linkSpanCurrent": {}, "locally": {}, "locallyScoped": {},
	"locallyScopedWith": {}, "locallyWith": {}, "logAnnotations": {}, "loop": {}, "makeLatch": {},
	"makeSemaphore": {}, "mapAccum": {}, "mapErrorCause": {}, "mapInputContext": {}, "merge": {},
	"mergeAll": {}, "metricLabels": {}, "negate": {}, "none": {}, "once": {}, "optionFromOptional": {},
	"orDieWith": {}, "orElse": {}, "orElseFail": {}, "parallelErrors": {}, "parallelFinalizers": {},
	"patchFiberRefs": {}, "patchRuntimeFlags": {}, "raceWith": {}, "random": {}, "randomWith": {},
	"reduceEffect": {}, "reduceRight": {}, "reduceWhile": {}, "repeatN": {}, "runRequestBlock": {},
	"runtime": {}, "scheduleForked": {}, "sequentialFinalizers": {}, "serviceConstants": {},
	"serviceFunction": {}, "serviceFunctionEffect": {}, "serviceFunctions": {}, "serviceMembers": {},
	"setFiberRefs": {}, "step": {}, "summarized": {}, "supervised": {}, "tagMetrics": {},
	"tagMetricsScoped": {}, "takeUntil": {}, "takeWhile": {}, "tapBoth": {}, "timedWith": {}, "timeoutFail": {},
	"timeoutFailCause": {}, "timeoutTo": {}, "tracerWith": {}, "transplant": {}, "transposeMapOption": {},
	"tryMap": {}, "tryMapPromise": {}, "unless": {}, "unlessEffect": {}, "unsafeMakeLatch": {},
	"unsafeMakeSemaphore": {}, "unsandbox": {}, "updateFiberRefs": {}, "using": {}, "validateAll": {},
	"validateFirst": {}, "validateWith": {}, "whenEffect": {}, "whenFiberRef": {}, "whenLogLevel": {},
	"whenRef": {}, "withClock": {}, "withClockScoped": {}, "withConcurrency": {}, "withConfigProvider": {},
	"withConfigProviderScoped": {}, "withConsole": {}, "withConsoleScoped": {}, "withEarlyRelease": {},
	"withMaxOpsBeforeYield": {}, "withMetric": {}, "withRandom": {}, "withRandomFixed": {},
	"withRandomScoped": {}, "withRequestBatching": {}, "withRequestCache": {}, "withRequestCaching": {},
	"withRuntimeFlagsPatch": {}, "withRuntimeFlagsPatchScoped": {}, "withScheduler": {},
	"withSchedulingPriority": {}, "withTracerScoped": {}, "withUnhandledErrorLogLevel": {}, "zipLeft": {},
	"zipRight": {},
}

// apiChange is what Effect 4 did with one of Effect 3's names.
type apiChange struct {
	renamed string // the Effect 4 name, or "" when Effect 4 removed it
	note    string // how the renamed function differs, or ""
}
