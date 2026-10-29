package vibelang

// The root of effect (design decision D146). Every export of the effect
// package's root is in scope in a .vibe file without an import, after the
// names the runtime's prelude supplies (prelude.go): Console, Stream, Option,
// Schedule, Duration, and the rest. A local declaration or an import shadows
// one, as it does a prelude name. A global value that JavaScript itself
// defines wins, so Array, String, Number, Boolean, Symbol, BigInt, Function,
// and RegExp keep their meaning, as do shared web globals such as Request
// (D264); a DOM-only global such as Option does not (isBuiltinGlobal). The
// emitted JavaScript imports each used name from its own module, never from
// the root, which would load every module.
//
// effectRootNames is generated from effect@4.1.0's dist/index.d.ts, the
// version VibeLang pins (D1); TestEffectRootNamesMatchEffect checks it against
// the installed package.

// effectRootModule is the effect package's root, which a .vibe file that
// uses one of its exports resolves as an implicit import.
const effectRootModule = "effect"

// effectRootExport is where the emitted JavaScript imports an effect root
// export from: a module's namespace (import * as Console from
// "effect/Console") or a named export (import { flow } from "effect/Function").
type effectRootExport struct {
	module    string
	namespace bool
}

// effectFunctionNames are the functions of effect's Effect module that a
// .vibe file sees without the Effect. prefix (D151): the ones the docs and
// examples call most, whose names read clearly alone. The emitted JavaScript
// imports each one used from effect/Effect. Operations that VibeLang spells
// another way stay qualified: Effect.fail is throw, Effect.provide is with,
// Effect.scoped and acquireRelease are using, and Effect.sync, promise, try,
// and tryPromise are the hatches.
var effectFunctionNames = map[string]bool{
	"all": true, "die": true, "exit": true, "forEach": true, "log": true, "logDebug": true, "logError": true,
	"logInfo": true, "logWarning": true, "race": true, "repeat": true, "retry": true, "sleep": true,
	"timeout": true, "withSpan": true,
}

var effectRootNames = map[string]effectRootExport{
	"Arbitrary":            {module: "effect/Arbitrary", namespace: true},
	"Array":                {module: "effect/Array", namespace: true},
	"BigDecimal":           {module: "effect/BigDecimal", namespace: true},
	"BigInt":               {module: "effect/BigInt", namespace: true},
	"Boolean":              {module: "effect/Boolean", namespace: true},
	"Brand":                {module: "effect/Brand", namespace: true},
	"ByteSize":             {module: "effect/ByteSize", namespace: true},
	"Bytes":                {module: "effect/Bytes", namespace: true},
	"Cache":                {module: "effect/Cache", namespace: true},
	"Cause":                {module: "effect/Cause", namespace: true},
	"Channel":              {module: "effect/Channel", namespace: true},
	"ChannelSchema":        {module: "effect/ChannelSchema", namespace: true},
	"Chunk":                {module: "effect/Chunk", namespace: true},
	"Clock":                {module: "effect/Clock", namespace: true},
	"Combiner":             {module: "effect/Combiner", namespace: true},
	"Config":               {module: "effect/Config", namespace: true},
	"ConfigProvider":       {module: "effect/ConfigProvider", namespace: true},
	"Console":              {module: "effect/Console", namespace: true},
	"Context":              {module: "effect/Context", namespace: true},
	"Cron":                 {module: "effect/Cron", namespace: true},
	"Data":                 {module: "effect/Data", namespace: true},
	"DateTime":             {module: "effect/DateTime", namespace: true},
	"Deferred":             {module: "effect/Deferred", namespace: true},
	"Differ":               {module: "effect/Differ", namespace: true},
	"Duration":             {module: "effect/Duration", namespace: true},
	"Effectable":           {module: "effect/Effectable", namespace: true},
	"Equal":                {module: "effect/Equal", namespace: true},
	"Equivalence":          {module: "effect/Equivalence", namespace: true},
	"ErrorReporter":        {module: "effect/ErrorReporter", namespace: true},
	"ExecutionPlan":        {module: "effect/ExecutionPlan", namespace: true},
	"Exit":                 {module: "effect/Exit", namespace: true},
	"Fiber":                {module: "effect/Fiber", namespace: true},
	"FiberHandle":          {module: "effect/FiberHandle", namespace: true},
	"FiberMap":             {module: "effect/FiberMap", namespace: true},
	"FiberSet":             {module: "effect/FiberSet", namespace: true},
	"FileSystem":           {module: "effect/FileSystem", namespace: true},
	"Filter":               {module: "effect/Filter", namespace: true},
	"Formatter":            {module: "effect/Formatter", namespace: true},
	"Function":             {module: "effect/Function", namespace: true},
	"Glob":                 {module: "effect/Glob", namespace: true},
	"Graph":                {module: "effect/Graph", namespace: true},
	"Hash":                 {module: "effect/Hash", namespace: true},
	"HashMap":              {module: "effect/HashMap", namespace: true},
	"HashRing":             {module: "effect/HashRing", namespace: true},
	"HashSet":              {module: "effect/HashSet", namespace: true},
	"HKT":                  {module: "effect/HKT", namespace: true},
	"Inspectable":          {module: "effect/Inspectable", namespace: true},
	"Iterable":             {module: "effect/Iterable", namespace: true},
	"JsonPatch":            {module: "effect/JsonPatch", namespace: true},
	"JsonPointer":          {module: "effect/JsonPointer", namespace: true},
	"JsonSchema":           {module: "effect/JsonSchema", namespace: true},
	"Latch":                {module: "effect/Latch", namespace: true},
	"LayerMap":             {module: "effect/LayerMap", namespace: true},
	"LayerRef":             {module: "effect/LayerRef", namespace: true},
	"Logger":               {module: "effect/Logger", namespace: true},
	"LogLevel":             {module: "effect/LogLevel", namespace: true},
	"ManagedRuntime":       {module: "effect/ManagedRuntime", namespace: true},
	"Match":                {module: "effect/Match", namespace: true},
	"Metric":               {module: "effect/Metric", namespace: true},
	"MutableHashMap":       {module: "effect/MutableHashMap", namespace: true},
	"MutableHashSet":       {module: "effect/MutableHashSet", namespace: true},
	"MutableList":          {module: "effect/MutableList", namespace: true},
	"MutableRef":           {module: "effect/MutableRef", namespace: true},
	"Newtype":              {module: "effect/Newtype", namespace: true},
	"NonEmptyIterable":     {module: "effect/NonEmptyIterable", namespace: true},
	"Number":               {module: "effect/Number", namespace: true},
	"Optic":                {module: "effect/Optic", namespace: true},
	"Option":               {module: "effect/Option", namespace: true},
	"Order":                {module: "effect/Order", namespace: true},
	"Ordering":             {module: "effect/Ordering", namespace: true},
	"PartitionedSemaphore": {module: "effect/PartitionedSemaphore", namespace: true},
	"Path":                 {module: "effect/Path", namespace: true},
	"Pipeable":             {module: "effect/Pipeable", namespace: true},
	"PlatformError":        {module: "effect/PlatformError", namespace: true},
	"Pool":                 {module: "effect/Pool", namespace: true},
	"Predicate":            {module: "effect/Predicate", namespace: true},
	"PrimaryKey":           {module: "effect/PrimaryKey", namespace: true},
	"PubSub":               {module: "effect/PubSub", namespace: true},
	"Pull":                 {module: "effect/Pull", namespace: true},
	"Queue":                {module: "effect/Queue", namespace: true},
	"Random":               {module: "effect/Random", namespace: true},
	"RcMap":                {module: "effect/RcMap", namespace: true},
	"RcRef":                {module: "effect/RcRef", namespace: true},
	"Record":               {module: "effect/Record", namespace: true},
	"Redactable":           {module: "effect/Redactable", namespace: true},
	"Redacted":             {module: "effect/Redacted", namespace: true},
	"Reducer":              {module: "effect/Reducer", namespace: true},
	"Ref":                  {module: "effect/Ref", namespace: true},
	"References":           {module: "effect/References", namespace: true},
	"RegExp":               {module: "effect/RegExp", namespace: true},
	"Request":              {module: "effect/Request", namespace: true},
	"RequestResolver":      {module: "effect/RequestResolver", namespace: true},
	"Resource":             {module: "effect/Resource", namespace: true},
	"Result":               {module: "effect/Result", namespace: true},
	"Runtime":              {module: "effect/Runtime", namespace: true},
	"Schedule":             {module: "effect/Schedule", namespace: true},
	"Scheduler":            {module: "effect/Scheduler", namespace: true},
	"SchemaAST":            {module: "effect/SchemaAST", namespace: true},
	"SchemaGetter":         {module: "effect/SchemaGetter", namespace: true},
	"SchemaIssue":          {module: "effect/SchemaIssue", namespace: true},
	"SchemaParser":         {module: "effect/SchemaParser", namespace: true},
	"SchemaRepresentation": {module: "effect/SchemaRepresentation", namespace: true},
	"SchemaTransformation": {module: "effect/SchemaTransformation", namespace: true},
	"ScopedCache":          {module: "effect/ScopedCache", namespace: true},
	"ScopedRef":            {module: "effect/ScopedRef", namespace: true},
	"Semaphore":            {module: "effect/Semaphore", namespace: true},
	"SemVer":               {module: "effect/SemVer", namespace: true},
	"SemVerRange":          {module: "effect/SemVerRange", namespace: true},
	"Sink":                 {module: "effect/Sink", namespace: true},
	"StandardSchema":       {module: "effect/StandardSchema", namespace: true},
	"Stdio":                {module: "effect/Stdio", namespace: true},
	"Stream":               {module: "effect/Stream", namespace: true},
	"String":               {module: "effect/String", namespace: true},
	"Struct":               {module: "effect/Struct", namespace: true},
	"SubscriptionRef":      {module: "effect/SubscriptionRef", namespace: true},
	"Symbol":               {module: "effect/Symbol", namespace: true},
	"SynchronizedRef":      {module: "effect/SynchronizedRef", namespace: true},
	"Take":                 {module: "effect/Take", namespace: true},
	"Terminal":             {module: "effect/Terminal", namespace: true},
	"TextDiff":             {module: "effect/TextDiff", namespace: true},
	"Tracer":               {module: "effect/Tracer", namespace: true},
	"Trie":                 {module: "effect/Trie", namespace: true},
	"Tuple":                {module: "effect/Tuple", namespace: true},
	"TxChunk":              {module: "effect/TxChunk", namespace: true},
	"TxDeferred":           {module: "effect/TxDeferred", namespace: true},
	"TxHashMap":            {module: "effect/TxHashMap", namespace: true},
	"TxHashSet":            {module: "effect/TxHashSet", namespace: true},
	"TxPriorityQueue":      {module: "effect/TxPriorityQueue", namespace: true},
	"TxPubSub":             {module: "effect/TxPubSub", namespace: true},
	"TxQueue":              {module: "effect/TxQueue", namespace: true},
	"TxReentrantLock":      {module: "effect/TxReentrantLock", namespace: true},
	"TxRef":                {module: "effect/TxRef", namespace: true},
	"TxSemaphore":          {module: "effect/TxSemaphore", namespace: true},
	"TxSubscriptionRef":    {module: "effect/TxSubscriptionRef", namespace: true},
	"Types":                {module: "effect/Types", namespace: true},
	"UndefinedOr":          {module: "effect/UndefinedOr", namespace: true},
	"Unify":                {module: "effect/Unify", namespace: true},
	"Utils":                {module: "effect/Utils", namespace: true},
	"Version":              {module: "effect/Version", namespace: true},
	"absurd":               {module: "effect/Function"},
	"cast":                 {module: "effect/Function"},
	"flow":                 {module: "effect/Function"},
	"hole":                 {module: "effect/Function"},
	"identity":             {module: "effect/Function"},
}
