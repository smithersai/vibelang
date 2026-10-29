package vibelang

import (
	"cmp"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// VibeLang's standard library is Effect's (design D6, Chapter 11). Node.js
// reaches a .vibe file only through Effect's services, which layers inject,
// or by escaping to TypeScript: a hatch, a module block, or a .ts file
// (D310). The platform globals in platformGlobals, Node's (process, Buffer,
// require, __dirname, ...) and the web's that do I/O or read the clock or
// randomness (fetch, setTimeout, crypto, performance, localStorage, ...), are
// not in scope there, and a .vibe file does not import a Node.js or Bun
// built-in module as a value. EK4402 names the Effect API that replaces each
// one and the layer that provides it:
//
//	error EK4402: process.cwd is platform code, which VibeLang code does not use directly.
//	  Use the Path service:   Path.resolve()
//	  Provide it in main with NodeServices.layer from "@effect/platform-node", or BunServices.layer from "@effect/platform-bun".
//
// Where Effect has no API for it yet, it names VibeLang's experimental
// service (D313), as for process.pid, or says so and shows the escape, the
// boundary that remains, as for document; it never sends the program to a
// wrapper module of its own. The guide's page on platform globals lists
// every answer, and TestPlatformGlobalsDocumented keeps it equal to these
// tables.
//
// The error stands at each use of a platform global, a value use included,
// and at each value that an import declaration brings in from a platform
// module; a type-only import stays allowed. ECMAScript's built-ins and the
// web's pure helpers (URL, TextEncoder, structuredClone, AbortController,
// Blob, ...) are not platform code. A clock or randomness read, such as
// Date.now(), is EK4403 instead, an error by default that a project may lower
// (D34); a read it allows compiles as a trusted sync call. Both apply
// everywhere in a .vibe file, a boundary's callback and the module's top
// level included.

// platformService is an Effect API that replaces platform APIs.
type platformService struct {
	use      string // what to use, such as "the FileSystem service"
	example  string // a call that shows it, or ""
	imports  string // the import that brings it into a .vibe file, or "" for a prelude name
	provider string // the layers that provide it, or "" when Effect's runtime does
}

// nodeServices provides FileSystem, Path, ChildProcessSpawner, Stdio, and
// Terminal. Since Effect 4.1 it provides no crypto service: cryptoLayers do.
const nodeServices = `NodeServices.layer from "@effect/platform-node", or BunServices.layer from "@effect/platform-bun"`

// cryptoLayers provide Effect's crypto services: SecureRandom, Digest, Mac,
// Signature, Cipher, Aead and the rest of effect/crypto.
const cryptoLayers = `NodeCrypto.layer from "@effect/platform-node", BunCrypto.layer from "@effect/platform-bun", or BrowserCrypto.layer from "@effect/platform-browser"`

// The layers of the experimental services (D313), which provide Effect's
// services of the same names too. experimentalNodeBundle is the one that the
// entry of a file that names Node provides (D312).
const (
	experimentalNodeBundle = `ExperimentalNodeServices.layer from "vibelang-runtime/experimental/platform-node"`
	experimentalServices   = experimentalNodeBundle + `, or ExperimentalBunServices.layer from "vibelang-runtime/experimental/platform-bun"`
)

// platformServices are the Effect APIs that replace platform APIs (Chapter 11), by
// the names the tables below use. Each import and layer is declared by
// effect 4.1.0 or its platform packages; TestPlatformServicesTable checks
// that each example uses what its import brings in.
var platformServices = map[string]*platformService{
	"FileSystem": {"the FileSystem service", "FileSystem.readFileString(path)", "", nodeServices},
	"Path":       {"the Path service", "Path.join(directory, name)", "", nodeServices},
	"PathPosix":  {"the Path service", "Path.join(directory, name)", "", `Path.layer from "effect/Path", which is POSIX's on every platform`},
	"PathWin32":  {"the Path service", "Path.join(directory, name)", "", `NodePath.layerWin32 from "@effect/platform-node"`},
	"ChildProcess": {"the ChildProcessSpawner service", "ChildProcessSpawner.string(ChildProcess.make(command, args))",
		"", nodeServices},
	"Crypto":   {"Effect's crypto services", "SecureRandom.randomBytes(size)", "", cryptoLayers},
	"Terminal": {"the Terminal service", "Terminal.readLine()", "", nodeServices},
	"Stdio":    {"the Stdio service", "Stdio.args()", "", nodeServices},
	"HttpClient": {"HttpClient", "HttpClient.get(url)", "",
		`FetchHttpClient.layer from "effect/http", or NodeHttpClient.layerUndici from "@effect/platform-node"`},
	"HttpServer": {"HttpRouter", "HttpRouter.serve(app)", "",
		`NodeHttpServer.layer(createServer, { port }) from "@effect/platform-node", which runs createServer itself`},
	"Socket":    {"the Socket service", "", "", `NodeSocket.layerNet({ host, port }) from "@effect/platform-node"`},
	"SocketTls": {"the Socket service", "", "", `NodeSocket.layerTls(options) from "@effect/platform-node"`},
	"WebSocket": {"the Socket service", "Socket.makeWebSocket(url)", "",
		`NodeSocket.layerWebSocket(url) from "@effect/platform-node", or BrowserSocket.layerWebSocket(url) from "@effect/platform-browser"`},
	"SocketServer":    {"the SocketServer service", "", "", `NodeSocketServer.layer({ port }) from "@effect/platform-node"`},
	"SocketServerTls": {"the SocketServer service", "", "", `NodeSocketServer.layerTls(options) from "@effect/platform-node"`},
	"DatagramSocket":  {"the DatagramSocket service", "", "", `NodeDatagramSocket.layer(options) from "@effect/platform-node"`},
	"Dns":             {"the Dns service", "", "", `NodeDns.layer from "@effect/platform-node"`},
	"NetAddress":      {"NetAddress, which needs no layer", "NetAddress.ipFromString(text)", "", ""},
	"Worker": {"Worker and WorkerRunner", "", "",
		`NodeWorker.layer(spawn) from "@effect/platform-node", or BrowserWorker.layer(spawn) from "@effect/platform-browser"`},
	"KeyValueStore": {"the KeyValueStore service", "KeyValueStore.get(key)", "",
		`BrowserKeyValueStore.layerLocalStorage from "@effect/platform-browser", or KeyValueStore.layerFileSystem(directory)`},
	"SqlClient": {"the SqlClient service", "", "",
		`a driver's layer, such as SqliteClient.layer({ filename }) from "@effect/sql-sqlite-node"`},
	"UrlParams":       {"UrlParams, which needs no layer", "UrlParams.fromInput(new URLSearchParams(text))", "", ""},
	"Bytes":           {"Uint8Array and TextEncoder or TextDecoder, which need no layer, or Base64 and Hex", "new TextEncoder().encode(text)", "", ""},
	"URL":             {"the global URL and URLSearchParams, which VibeLang code may use", "new URL(text)", "", ""},
	"Inspectable":     {"Inspectable, from the prelude", "Inspectable.toStringUnknown(value)", "", ""},
	"Schedule":        {"sleep and Schedule, from the prelude", `sleep("1 second")`, "", ""},
	"Interrupt":       {"a fiber's interruption", "fiber.interrupt()", "", ""},
	"Yield":           {"yieldNow, from the prelude", "yieldNow()", "", ""},
	"Clock":           {"Clock, from the prelude", "Clock.currentTimeMillis()", "", ""},
	"Config":          {"Config, from the prelude", `Config.String("NAME")()`, "", ""},
	"Console":         {"Console, from the prelude", "Console.log(message)", "", ""},
	"Stream":          {"Stream, from the prelude", "Stream.fromIterable(values)", "", ""},
	"PubSub":          {"PubSub, or Stream.fromEventListener for an event target, from the prelude", `Stream.fromEventListener(target, "message")`, "", ""},
	"Exit":            {"return from main for exit 0; fail for exit 1; interruption exits 130", "", "", ""},
	"@effect/vitest":  {"it.effect and assert", "", `import { assert, it } from "@effect/vitest"`, ""},
	"ImportMeta":      {"import.meta, which needs no layer", "import.meta.resolve(specifier)", "", ""},
	"GlobalThis":      {"globalThis, ECMAScript's global object", "globalThis", "", ""},
	"Clipboard":       {"the Clipboard service", "Clipboard.readString()", `import { Clipboard } from "@effect/platform-browser"`, `Clipboard.layer from "@effect/platform-browser"`},
	"Geolocation":     {"the Geolocation service", "Geolocation.getCurrentPosition()", `import { Geolocation } from "@effect/platform-browser"`, `Geolocation.layer from "@effect/platform-browser"`},
	"Permissions":     {"the Permissions service", `Permissions.query("geolocation")`, `import { Permissions } from "@effect/platform-browser"`, `Permissions.layer from "@effect/platform-browser"`},
	"BrowserStream":   {"BrowserStream, a Stream of a window's or document's events", `BrowserStream.fromEventListenerWindow("resize")`, `import { BrowserStream } from "@effect/platform-browser"`, ""},
	"UserDirectories": {"the UserDirectories service", "UserDirectories.home()", "", "UserDirectories.layer"},
	// VibeLang's experimental services (D313), for what Effect lacks.
	"ExperimentalFileSystem": {"the experimental FileSystem service", "Experimental.FileSystem.access(path, { executable: true })", "", experimentalServices},
	"ExperimentalProcess":    {"the experimental Process service", "Experimental.Process.pid()", "", experimentalServices},
	"ExperimentalLocks": {"the experimental Locks service", "Experimental.Locks.hold(name)", "",
		`ExperimentalBrowserLocks.layer from "vibelang-runtime/experimental/platform-browser"; ExperimentalNodeLocks.layer from "vibelang-runtime/experimental/platform-node" locks only within one Node.js process`},
	"import": {"an import declaration", `import { name } from "./module.ts"`, "", ""},
	"export": {"an export declaration", "export const name = value", "", ""},
}

// serviceKeys are the platformServices keys of the services whose names
// differ from them.
var serviceKeys = map[string]string{"ChildProcessSpawner": "ChildProcess"}

// platformServiceOf returns the platformServices entry of service, a
// requirement that a program needs: Effect's service of that name, or
// VibeLang's experimental one (D313); or nil for any other service, such as
// one the program declares. EK3205 names its layers as EK4402 does.
func platformServiceOf(c *checker.Checker, service *checker.Type) *platformService {
	symbol := service.Symbol()
	if symbol == nil || len(symbol.Declarations()) == 0 {
		return nil
	}
	file := ast.GetSourceFileOfNode(symbol.Declarations()[0])
	if file == nil {
		return nil
	}
	name := symbol.Name()
	switch pkg := packageOf(c, file); {
	case pkg == runtimeModule && strings.Contains(string(file.FileName()), "/experimental/"):
		name = "Experimental" + name
	case pkg != "effect" && !strings.HasPrefix(pkg, "@effect/"):
		return nil
	}
	if key, ok := serviceKeys[name]; ok {
		name = key
	}
	return platformServices[name]
}

// platformAPI says what replaces a platform API.
type platformAPI struct {
	service string // the key in platformServices of what replaces it, or "" when Effect has nothing yet
	example string // the call that replaces it, when it is not the service's example
	note    string // what the replacement does differently, or what Effect lacks
}

// platformModules maps Node.js built-in modules to the platformServices that replace
// their APIs; "" means Effect has none. Node.js's other modules are platform
// APIs too when imported with the node: prefix.
var platformModules = map[string]string{
	"assert": "@effect/vitest", "assert/strict": "@effect/vitest", "async_hooks": "", "buffer": "Bytes",
	"child_process": "ChildProcess", "cluster": "Worker", "console": "Console", "constants": "",
	"crypto": "Crypto", "dgram": "DatagramSocket", "diagnostics_channel": "", "dns": "Dns",
	"dns/promises": "Dns", "domain": "", "events": "PubSub", "fs": "FileSystem",
	"fs/promises": "FileSystem", "http": "HttpClient", "http2": "HttpClient", "https": "HttpClient",
	"inspector": "", "inspector/promises": "", "module": "", "net": "Socket", "os": "",
	"path": "Path", "path/posix": "PathPosix", "path/win32": "PathWin32", "perf_hooks": "Clock",
	"process": "Config", "punycode": "", "querystring": "UrlParams", "readline": "Terminal",
	"readline/promises": "Terminal", "repl": "", "stream": "Stream", "stream/consumers": "Stream",
	"stream/promises": "Stream", "stream/web": "Stream", "string_decoder": "Bytes", "sys": "",
	"timers": "Schedule", "timers/promises": "Schedule", "tls": "SocketTls", "trace_events": "", "tty": "Terminal",
	"url": "URL", "util": "", "util/types": "", "v8": "", "vm": "", "wasi": "",
	"worker_threads": "Worker", "zlib": "",
}

// prefixOnlyModules are Node.js built-in modules that exist only with the
// node: prefix.
var prefixOnlyModules = map[string]string{"sea": "", "sqlite": "SqlClient", "test": "@effect/vitest", "test/reporters": "@effect/vitest"}

// platformGlobals maps the platform globals that .vibe code may not use to the
// platformServices that replace them. Platform-neutral web standards that touch
// nothing outside the program, such as URL, TextEncoder, AbortController, and
// structuredClone, are not in the table.
var platformGlobals = map[string]string{
	"fetch": "HttpClient", "XMLHttpRequest": "HttpClient", "EventSource": "HttpClient", "WebSocket": "WebSocket",
	"setTimeout": "Schedule", "setInterval": "Schedule", "setImmediate": "Yield", "clearTimeout": "Interrupt",
	"clearInterval": "Interrupt", "clearImmediate": "Interrupt", "queueMicrotask": "Yield",
	"requestAnimationFrame": "", "cancelAnimationFrame": "", "requestIdleCallback": "",
	"cancelIdleCallback": "",
	"process":            "Config", "console": "Console", "crypto": "Crypto", "performance": "Clock",
	"localStorage": "KeyValueStore", "sessionStorage": "KeyValueStore", "indexedDB": "KeyValueStore",
	"Worker": "Worker", "SharedWorker": "Worker", "importScripts": "Worker",
	"document": "", "window": "", "self": "GlobalThis", "navigator": "", "location": "", "history": "",
	"alert": "", "confirm": "", "prompt": "",
	"addEventListener": "PubSub", "removeEventListener": "PubSub", "dispatchEvent": "PubSub",
	"require": "import", "module": "export", "exports": "export", "__dirname": "Path", "__filename": "Path",
	"Buffer": "Bytes", "Bun": "", "Deno": "", "global": "GlobalThis", "caches": "", "BroadcastChannel": "",
}

// platformAPIs says what replaces single platform APIs. A name is a module
// without its node: prefix, or a global, then the imported name and the
// properties read in turn: "fs/promises.readFile", "path.posix.join",
// "process.env". "process.*" covers process's other members. An API the table
// lacks takes its module's or global's service.
var platformAPIs = map[string]platformAPI{
	"fs.constants":            {"FileSystem", `FileSystem.open(path, { flag: "wx" })`, ""},
	"fs.constants.X_OK":       {"ExperimentalFileSystem", "Experimental.FileSystem.access(path, { executable: true })", "FileSystem.access checks only that a path is readable or writable."},
	"fs.constants.O_NONBLOCK": {"ExperimentalFileSystem", "Experimental.FileSystem.open(path, { nonBlocking: true })", "FileSystem.open takes a flag, such as \"wx\", but no nonblocking mode."},

	"child_process.spawn":        {"ChildProcess", "ChildProcessSpawner.spawn(ChildProcess.make(command, args))", ""},
	"child_process.exec":         {"ChildProcess", "", ""},
	"child_process.execSync":     {"ChildProcess", "", ""},
	"child_process.execFile":     {"ChildProcess", "", ""},
	"child_process.execFileSync": {"ChildProcess", "", ""},
	"child_process.spawnSync":    {"ChildProcess", "", ""},

	"crypto.randomUUID":       {"Crypto", "SecureRandom.uuidV4()", ""},
	"crypto.randomBytes":      {"Crypto", "SecureRandom.randomBytes(size)", ""},
	"crypto.randomInt":        {"Crypto", "SecureRandom.intBetween(min, max)", ""},
	"crypto.getRandomValues":  {"Crypto", "SecureRandom.randomBytes(size)", "SecureRandom.randomBytes returns new bytes instead of filling an array."},
	"crypto.createHash":       {"Crypto", "Digest.digest(Digest.sha256, bytes)", "Digest.digest hashes all the bytes in one call; it has no incremental update."},
	"crypto.hash":             {"Crypto", "Digest.digest(Digest.sha256, bytes)", ""},
	"crypto.subtle.digest":    {"Crypto", "Digest.digest(Digest.sha256, bytes)", ""},
	"crypto.subtle":           {"Crypto", "Mac.sign(key, data)", cryptoFamilies},
	"crypto.subtle.sign":      {"Crypto", "Signature.sign(privateKey, data)", signatureKeys},
	"crypto.subtle.verify":    {"Crypto", "Signature.verify(publicKey, signature, data)", signatureKeys},
	"crypto.webcrypto":        {"Crypto", "Mac.sign(key, data)", cryptoFamilies},
	"crypto.createHmac":       {"Crypto", "Mac.sign(key, data)", "Mac.key(Mac.hmacSha256, bytes) makes the key, and Mac.sign takes all the data in one call."},
	"crypto.createSign":       {"Crypto", "Signature.sign(privateKey, data)", signatureKeys},
	"crypto.createVerify":     {"Crypto", "Signature.verify(publicKey, signature, data)", signatureKeys},
	"crypto.sign":             {"Crypto", "Signature.sign(privateKey, data)", signatureKeys},
	"crypto.verify":           {"Crypto", "Signature.verify(publicKey, signature, data)", signatureKeys},
	"crypto.createCipheriv":   {"Crypto", "Aead.encrypt(key, plaintext, { nonce })", aeadKeys},
	"crypto.createDecipheriv": {"Crypto", "Aead.decrypt(key, ciphertext, { nonce })", aeadKeys},
	"crypto.generateKeyPair":  {"Crypto", "Signature.generateKeyPair(Signature.ed25519)", ""},

	"http.createServer":        {"HttpServer", "", ""},
	"http.Server":              {"HttpServer", "", ""},
	"https.createServer":       {"HttpServer", "", ""},
	"https.Server":             {"HttpServer", "", ""},
	"http2.createServer":       {"HttpServer", "", ""},
	"http2.createSecureServer": {"HttpServer", "", ""},

	"net.createServer": {"SocketServer", "", ""},
	"net.Server":       {"SocketServer", "", ""},
	"net.isIP":         {"NetAddress", "", ""},
	"net.isIPv4":       {"NetAddress", "", ""},
	"net.isIPv6":       {"NetAddress", "", ""},
	"tls.createServer": {"SocketServerTls", "", ""},
	"tls.Server":       {"SocketServerTls", "", ""},

	"os.tmpdir":               {"FileSystem", "FileSystem.makeTempDirectory()", "FileSystem.makeTempDirectory creates a directory in it; nothing returns its path alone."},
	"os.hostname":             {"ExperimentalProcess", "Experimental.Process.hostname()", ""},
	"os.homedir":              {"UserDirectories", "UserDirectories.home()", "UserDirectories.home() reads HOME, or USERPROFILE on Windows; os.homedir() also falls back to the user database."},
	"os.availableParallelism": {"ExperimentalProcess", "Experimental.Process.availableParallelism()", ""},
	"os.platform":             {"ExperimentalProcess", "Experimental.Process.platform()", ""},
	"os.arch":                 {"ExperimentalProcess", "Experimental.Process.arch()", ""},

	"url.fileURLToPath": {"Path", "Path.fromFileUrl(url)", ""},
	"path.sep":          {"Path", "Path().sep", ""},
	"util.inspect":      {"Inspectable", "", "It writes values as JSON, not as util.inspect does."},
	"url.pathToFileURL": {"Path", "Path.toFileUrl(path)", ""},

	"__dirname":  {"Path", "Path.dirname(Path.fromFileUrl(new URL(import.meta.url)))", ""},
	"__filename": {"Path", "Path.fromFileUrl(new URL(import.meta.url))", ""},

	"events.once":                   {note: "Effect has no adapter for a Node.js EventEmitter; Stream.fromEventListener reads an event target."},
	"stream.Readable.from":          {"Stream", "Stream.fromIterable(values)", ""},
	"require":                       {"import", "", "A static import loads a module when the program loads."},
	"require.resolve":               {"ImportMeta", "import.meta.resolve(specifier)", ""},
	"navigator.locks":               {"ExperimentalLocks", "Experimental.Locks.hold(name)", "A Semaphore locks only within one program."},
	"navigator.clipboard":           {"Clipboard", "", ""},
	"navigator.geolocation":         {"Geolocation", "", ""},
	"navigator.permissions":         {"Permissions", "", ""},
	"navigator.hardwareConcurrency": {"ExperimentalProcess", "Experimental.Process.availableParallelism()", ""},
	"navigator":                     {note: "Effect has no service for the browser's navigator; navigator.clipboard, geolocation, permissions, and locks have services."},
	"navigator.*":                   {note: "Effect has no service for the browser's other navigator properties; read them in a .ts file."},
	"document":                      {note: domGap},
	"window":                        {note: domGap},
	"location":                      {note: domGap},
	"history":                       {note: domGap},
	"requestAnimationFrame":         {note: frameGap},
	"cancelAnimationFrame":          {note: frameGap},
	"requestIdleCallback":           {note: frameGap},
	"cancelIdleCallback":            {note: frameGap},
	"alert":                         {note: dialogGap},
	"confirm":                       {note: dialogGap},
	"prompt":                        {note: dialogGap},
	"caches":                        {note: "Effect has no service for the browser's Cache Storage; KeyValueStore stores strings by key."},
	"BroadcastChannel":              {note: "Effect has no service for messages between browser tabs; a Worker carries messages to a worker."},
	"Bun":                           {note: runtimeGap},
	"Deno":                          {note: runtimeGap},
	"performance.now":               {"Clock", "Clock.monotonicTimeNanos()", "Clock.monotonicTimeNanos() is a bigint of nanoseconds, and performance.now() a number of milliseconds."},
	"performance.timeOrigin":        {"ExperimentalProcess", "Experimental.Process.timeOrigin()", "Clock reads the time now; it has no time origin."},
	"window.addEventListener":       {"BrowserStream", `BrowserStream.fromEventListenerWindow("resize")`, ""},
	"document.addEventListener":     {"BrowserStream", `BrowserStream.fromEventListenerDocument("visibilitychange")`, ""},
	"Buffer.from":                   {"Bytes", "new TextEncoder().encode(text)", "Base64.decode(text) and Hex.decode(text) read encoded bytes."},
	"Buffer.alloc":                  {"Bytes", "new Uint8Array(size)", ""},
	"Buffer.concat":                 {"Bytes", "new Uint8Array([...a, ...b])", ""},

	"setInterval":                  {"Schedule", `repeat(program, Schedule.spaced("1 second"))`, ""},
	"timers.setInterval":           {"Schedule", `repeat(program, Schedule.spaced("1 second"))`, ""},
	"timers.setImmediate":          {"Yield", "", "yieldNow lets other fibers run; it does not queue a macrotask."},
	"timers.clearTimeout":          {"Interrupt", "", ""},
	"timers.clearInterval":         {"Interrupt", "", ""},
	"timers.clearImmediate":        {"Interrupt", "", ""},
	"timers/promises.setInterval":  {"Schedule", `repeat(program, Schedule.spaced("1 second"))`, ""},
	"timers/promises.setImmediate": {"Yield", "", "yieldNow lets other fibers run; it does not queue a macrotask."},
	"setImmediate":                 {"Yield", "", "yieldNow lets other fibers run; it does not queue a macrotask."},
	"queueMicrotask":               {"Yield", "", "yieldNow lets other fibers run; it does not queue a microtask."},

	"process.env":            {"Config", "", ""},
	"process.pid":            {"ExperimentalProcess", "Experimental.Process.pid()", ""},
	"process.platform":       {"ExperimentalProcess", "Experimental.Process.platform()", ""},
	"process.arch":           {"ExperimentalProcess", "Experimental.Process.arch()", ""},
	"process.execPath":       {"ExperimentalProcess", "Experimental.Process.execPath()", ""},
	"process.versions":       {"ExperimentalProcess", "Experimental.Process.versions()", ""},
	"process.version":        {"ExperimentalProcess", "Experimental.Process.versions()", ""},
	"process.memoryUsage":    {"ExperimentalProcess", "Experimental.Process.memoryUsage()", ""},
	"process.argv":           {"Stdio", "Stdio.args()", "Stdio.args() leaves out argv[0] and argv[1], the runtime and the script."},
	"process.cwd":            {"Path", "Path.resolve()", ""},
	"process.stdout":         {"Console", "Console.log(text)", "For bytes, Stdio.stdout() is a Sink."},
	"process.stderr":         {"Console", "Console.error(text)", "For bytes, Stdio.stderr() is a Sink."},
	"process.stdin":          {"Terminal", "Terminal.readLine()", "Stdio.stdin streams the bytes."},
	"process.hrtime":         {"Clock", "Clock.monotonicTimeNanos()", "Clock.monotonicTimeNanos() is a bigint of nanoseconds, as process.hrtime.bigint() is."},
	"process.nextTick":       {"Yield", "", "yieldNow lets other fibers run; it does not queue a microtask."},
	"process.exit":           {"Exit", "", processExit},
	"process.exitCode":       {"Exit", "", processExit},
	"process.uptime":         {note: "Clock reads the time, not the process's age: keep a Clock.monotonicTimeNanos() reading from the start."},
	"process.kill":           {"ExperimentalProcess", "Experimental.Process.kill(pid, { killSignal })", "Signal 0 is Experimental.Process.isRunning(pid); a child that ChildProcessSpawner.spawn started also stops with its handle's kill()."},
	"process.on":             {note: processEvents},
	"process.once":           {note: processEvents},
	"process.off":            {note: processEvents},
	"process.removeListener": {note: processEvents},
	"process.*":              {},

	"console.log":   {"Console", "Console.log(message)", ""},
	"console.error": {"Console", "Console.error(message)", ""},
	"console.warn":  {"Console", "Console.warn(message)", ""},
	"console.info":  {"Console", "Console.info(message)", ""},
	"console.debug": {"Console", "Console.debug(message)", ""},
	"console.trace": {"Console", "Console.trace(message)", ""},
	"console.table": {"Console", "Console.table(rows)", ""},
}

const (
	cryptoFamilies = "effect/crypto has a service for each WebCrypto family: Digest, Mac, Signature, Cipher, Aead, Kdf, KeyAgreement and KeyWrap."
	signatureKeys  = "Signature.privateKey(Signature.ed25519, bytes) and Signature.publicKey make the keys from their bytes."
	aeadKeys       = "Aead.key(Aead.aes256Gcm, bytes) makes the key; Aead also has ChaCha20-Poly1305, and Cipher has AES-CTR and AES-CBC."
	domGap         = "Effect has no service for the DOM; UI code belongs in a .ts or .tsx file, such as a React component's."
	frameGap       = "Effect has no service for the browser's animation and idle callbacks; schedule work with Schedule, or call them in a .ts file."
	dialogGap      = "Effect has no service for the browser's dialogs; a terminal program asks with Terminal.readLine()."
	runtimeGap     = "A runtime's own API belongs to its platform package's layers, such as @effect/platform-bun's, or to a .ts file."
	processExit    = "Let main return or fail: NodeRuntime.runMain, which runs it, exits with 0 when it succeeds and 1 when it fails."
	processEvents  = "NodeRuntime.runMain handles SIGINT and SIGTERM; Effect has no service for other process events."
)

// fileSystemAPIs maps the functions of fs, fs/promises, and fs.promises,
// without the Sync suffix, to the FileSystem calls that replace them.
var fileSystemAPIs = map[string]platformAPI{
	"readFile":          {"FileSystem", "FileSystem.readFileString(path)", ""},
	"writeFile":         {"FileSystem", "FileSystem.writeFileString(path, text)", ""},
	"appendFile":        {"FileSystem", `FileSystem.writeFileString(path, text, { flag: "a" })`, ""},
	"mkdir":             {"FileSystem", "FileSystem.makeDirectory(path, { recursive: true })", ""},
	"mkdtemp":           {"FileSystem", "FileSystem.makeTempDirectory()", ""},
	"rm":                {"FileSystem", "FileSystem.remove(path, { recursive: true })", ""},
	"rmdir":             {"FileSystem", "FileSystem.remove(path)", ""},
	"unlink":            {"FileSystem", "FileSystem.remove(path)", ""},
	"stat":              {"FileSystem", "FileSystem.stat(path)", ""},
	"lstat":             {"FileSystem", "FileSystem.lstat(path)", ""},
	"exists":            {"FileSystem", "FileSystem.exists(path)", ""},
	"access":            {"FileSystem", "FileSystem.access(path)", "The experimental FileSystem's access(path, { executable: true }) also checks that the file can run."},
	"readdir":           {"FileSystem", "FileSystem.readDirectory(path)", "FileSystem.readDirectory returns names; FileSystem.stat gives each one's type."},
	"opendir":           {"FileSystem", "FileSystem.readDirectory(path)", ""},
	"readlink":          {"FileSystem", "FileSystem.readLink(path)", ""},
	"realpath":          {"FileSystem", "FileSystem.realPath(path)", ""},
	"rename":            {"FileSystem", "FileSystem.rename(from, to)", ""},
	"symlink":           {"FileSystem", "FileSystem.symlink(target, path)", ""},
	"link":              {"FileSystem", "FileSystem.link(from, to)", ""},
	"chmod":             {"FileSystem", "FileSystem.chmod(path, mode)", ""},
	"chown":             {"FileSystem", "FileSystem.chown(path, uid, gid)", ""},
	"copyFile":          {"FileSystem", "FileSystem.copyFile(from, to)", ""},
	"cp":                {"FileSystem", "FileSystem.copy(from, to)", ""},
	"truncate":          {"FileSystem", "FileSystem.truncate(path)", ""},
	"utimes":            {"FileSystem", "FileSystem.utimes(path, atime, mtime)", ""},
	"open":              {"FileSystem", `FileSystem.open(path, { flag: "r" })`, ""},
	"watch":             {"FileSystem", "FileSystem.watch(path)", ""},
	"glob":              {"FileSystem", "FileSystem.glob(pattern)", ""},
	"createReadStream":  {"FileSystem", "FileSystem.stream(path)", ""},
	"createWriteStream": {"FileSystem", "FileSystem.sink(path)", ""},
}

// pathAPIs are the Path members that replace path's functions of the same
// name, with their arguments.
var pathAPIs = []string{
	"basename(path)", "dirname(path)", "extname(path)", "format(parts)", "isAbsolute(path)", "join(directory, name)",
	"normalize(path)", "parse(path)", "relative(from, to)", "resolve(path)", "toNamespacedPath(path)",
}

// timerAPIs are the timers, by their global names, that the timers modules
// also export.
var timerAPIs = []string{"setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "clearImmediate"}

func init() {
	for name, api := range fileSystemAPIs {
		platformAPIs["fs/promises."+name] = api
		platformAPIs["fs.promises."+name] = api
		platformAPIs["fs."+name] = api
		platformAPIs["fs."+name+"Sync"] = api
	}
	for _, call := range pathAPIs {
		name := call[:strings.IndexByte(call, '(')]
		for module, s := range map[string]string{"path": "Path", "path/posix": "PathPosix", "path/win32": "PathWin32", "path.posix": "PathPosix", "path.win32": "PathWin32"} {
			platformAPIs[module+"."+name] = platformAPI{s, "Path." + call, ""}
		}
	}
	for _, name := range timerAPIs {
		if _, ok := platformAPIs["timers."+name]; !ok {
			platformAPIs["timers."+name] = platformAPI{service: platformGlobals[name]}
		}
		if _, ok := platformAPIs["timers/promises."+name]; !ok {
			platformAPIs["timers/promises."+name] = platformAPI{service: platformGlobals[name]}
		}
	}
	fileChecks = append(fileChecks, checkPlatform)
}

// clockRead says what replaces a clock or randomness read.
type clockRead struct {
	use     string // the replacement, and how its value differs from the read's
	service string // the key in platformServices of the service it needs, or "" for Effect's runtime's own
	test    string // how a test controls the replacement
}

const (
	testClock  = "In a test, TestClock sets it."
	testRandom = "In a test, Random.withSeed(() => program(), seed) fixes it."
	testCrypto = `In a test, provide Layer.succeed(SecureRandom.SecureRandom, SecureRandom.make(randomBytes)) with fixed bytes; a seeded Random does not reach SecureRandom.`
)

// clockReads lists the clock and randomness reads (EK4403), by the
// declaration that a call resolves to, with what replaces each one.
var clockReads = map[string]clockRead{
	"DateConstructor.now":         {"Clock.currentTimeMillis(), the same number of milliseconds", "", testClock},
	"DateConstructor":             {"String(DateTime.nowAsDate()), since Date() returns a string", "", testClock},
	"DateConstructor.constructor": {"DateTime.nowAsDate() for a Date, or DateTime.now() for a DateTime.Utc", "", testClock}, // new Date()
	"Math.random":                 {"Random.next(), a number from 0 up to 1", "", testRandom},
	"Crypto.randomUUID":           {"SecureRandom.uuidV4()", "Crypto", testCrypto},
	"Crypto.getRandomValues":      {"SecureRandom.randomBytes(size), which returns new bytes instead of filling an array", "Crypto", testCrypto},
	"Performance.now":             {"Number(Clock.monotonicTimeNanos()) / 1e6: Clock.monotonicTimeNanos() is a bigint of nanoseconds, and performance.now() a number of milliseconds", "", testClock},
	"Now.instant":                 {"DateTime.now()", "", testClock},
	"Now.zonedDateTimeISO":        {"DateTime.nowInCurrentZone()", "", testClock},
	"Now.plainDateTimeISO":        {"DateTime.now()", "", testClock},
	"Now.plainDateISO":            {"DateTime.now()", "", testClock},
	"Now.plainTimeISO":            {"DateTime.now()", "", testClock},
	"Now.timeZoneId":              {"DateTime.CurrentTimeZone()", "", "In a test, provide DateTime.CurrentTimeZone."},
}

// platformModule is EK4402's text for an import of a platform module that
// binds nothing, and for a dynamic import of one.
var platformModule = EK4402.With("{0} is platform code, which VibeLang code does not import.")

// platformValueImport is EK4402's text for a value that an import declaration
// brings in from a platform module. {0} is the binding, {1} the module.
var platformValueImport = EK4402.With("{0} from {1} is platform code, which a .vibe file does not import as a value.")

// checkPlatform reports EK4402 where file's code runs a platform API (D108),
// and EK4403 for clock and randomness reads.
func checkPlatform(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case ast.IsImportDeclaration(node) || ast.IsExportDeclaration(node):
			checkPlatformImport(c, node)
			return false
		case ast.IsImportCall(node):
			if arguments := node.Arguments(); len(arguments) > 0 && ast.IsStringLiteral(arguments[0]) {
				if r, ok := platformModuleOf(arguments[0].Text()); ok {
					d := report(c, arguments[0], platformModule, arguments[0].Text())
					notePlatformAPI(d, platformAPI{service: r}, "sync(() => "+nodeText(file, node)+")")
				}
			}
		case hatchOf(node) != "":
			return forEachHatchVibeLang(node, visit) // a hatch's TypeScript may use the platform (D148)
		case isWrappedCode(node):
			return false // so may the code that Effect.try or Effect.tryPromise wraps (VIP-5)
		case ast.IsCallExpression(node) || ast.IsNewExpression(node):
			checkClockRead(c, file, node)
		case ast.IsIdentifier(node) || globalPlatformName(c, node) != "":
			checkPlatformUse(c, file, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkPlatformImport reports EK4402 for each value that node, an import or
// export declaration at a .vibe file's top level, brings in from a platform
// module (D310). A type-only binding stays allowed, and so does an import in
// a module block, whose body is TypeScript.
func checkPlatformImport(c *checker.Checker, node *ast.Node) {
	if node.Parent == nil || !ast.IsSourceFile(node.Parent) {
		return
	}
	specifier := node.ModuleSpecifier()
	if specifier == nil || !ast.IsStringLiteral(specifier) {
		return
	}
	module := specifier.Text()
	replacement, ok := platformModuleOf(module)
	if !ok {
		return
	}
	reportBinding := func(at *ast.Node, local string, decl *ast.Node) {
		ref := platformRef{replacement: replacement, module: module, name: importedName(module, decl)}
		d := report(c, at, platformValueImport, local, module)
		notePlatformAPI(d, platformAPIOf(ref, nil), "")
	}
	var elements []*ast.Node
	if ast.IsImportDeclaration(node) {
		clause := node.ImportClause()
		if clause == nil {
			d := report(c, specifier, platformModule, module)
			notePlatformAPI(d, platformAPI{service: replacement}, "")
			return
		}
		if clause.IsTypeOnly() {
			return
		}
		if name := clause.Name(); name != nil {
			reportBinding(name, name.Text(), clause)
		}
		switch bindings := clause.AsImportClause().NamedBindings; {
		case bindings == nil:
		case ast.IsNamespaceImport(bindings):
			reportBinding(bindings, bindings.Name().Text(), bindings)
		default:
			elements = bindings.Elements()
		}
	} else {
		declaration := node.AsExportDeclaration()
		if declaration.IsTypeOnly {
			return
		}
		if declaration.ExportClause == nil || !ast.IsNamedExports(declaration.ExportClause) {
			d := report(c, specifier, platformModule, module)
			notePlatformAPI(d, platformAPI{service: replacement}, "")
			return
		}
		elements = declaration.ExportClause.Elements()
	}
	for _, element := range elements {
		if !ast.IsTypeOnlyImportOrExportDeclaration(element) {
			reportBinding(element, element.Name().Text(), element)
		}
	}
}

// platformModuleOf returns the name of module's replacement, and whether
// module is a platform module: a Node.js built-in, with or without the node:
// prefix, or a Bun built-in.
func platformModuleOf(module string) (string, bool) {
	if strings.HasPrefix(module, "bun:") {
		return "", true
	}
	name, prefixed := strings.CutPrefix(module, "node:")
	if r, ok := platformModules[name]; ok {
		return r, true
	}
	if r, ok := prefixOnlyModules[name]; ok && prefixed {
		return r, true
	}
	return "", prefixed
}

// platformRef is what a reference to a platform API refers to.
type platformRef struct {
	replacement string // the name of what replaces it in platformServices, or ""
	module      string // the platform module it is imported from, or "" for a global
	name        string // the name platformAPIs knows it by: its module and imported name, or the global's name
	namespace   bool   // a namespace import, whose members are values until code runs them
	unresolved  bool   // a platform global's name that does not resolve
}

// platformReference reports whether id refers to a platform API: a binding
// imported from a platform module, or a global in platformGlobals that a lib
// file or a platform package declares, or that does not resolve at all, as
// process does without @types/node.
func platformReference(c *checker.Checker, id *ast.Node) (platformRef, bool) {
	name := globalPlatformName(c, id)
	if name == "" {
		return platformRef{}, false
	}
	symbol := c.GetSymbolAtLocation(id)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		for _, decl := range symbol.Declarations() {
			if module, namespace := importedFrom(decl); module != "" {
				if r, ok := platformModuleOf(module); ok {
					return platformRef{replacement: r, module: module, name: importedName(module, decl), namespace: namespace}, true
				}
			}
		}
		return platformRef{}, false
	}
	r, listed := platformGlobals[name]
	if !listed {
		return platformRef{}, false
	}
	if symbol != nil && !isGlobalOf(symbol, func(file *ast.SourceFile) bool { return isLibFile(c, file) || isPlatformPackage(packageOf(c, file)) }) {
		return platformRef{}, false // a local, or a global the program declares
	}
	return platformRef{replacement: r, name: name, unresolved: symbol == nil}, true
}

// importedName returns the name platformAPIs knows decl, an import binding's
// declaration from module, by: the module without its node: prefix, then the
// name it imports, if it imports one by name.
func importedName(module string, decl *ast.Node) string {
	name := strings.TrimPrefix(module, "node:")
	if decl.Kind == ast.KindImportSpecifier {
		imported := decl.PropertyName()
		if imported == nil {
			imported = decl.Name()
		}
		if imported != nil && imported.Text() != "default" {
			name += "." + imported.Text()
		}
	}
	return name
}

// globalPlatformName covers D102's bare globals and S6-1's globalThis
// receiver. A locally declared globalThis or process retains its own meaning.
func globalPlatformName(c *checker.Checker, node *ast.Node) string {
	if ast.IsIdentifier(node) && isValueUse(node) {
		return node.Text()
	}
	if !ast.IsPropertyAccessExpression(node) && !ast.IsElementAccessExpression(node) {
		return ""
	}
	receiver := ast.SkipParentheses(node.Expression())
	if !ast.IsIdentifier(receiver) || receiver.Text() != "globalThis" {
		return ""
	}
	symbol := c.GetSymbolAtLocation(receiver)
	if symbol == nil || symbol.Name() != "globalThis" || len(symbol.Declarations()) != 0 {
		return ""
	}
	if ast.IsPropertyAccessExpression(node) {
		return node.Name().Text()
	}
	if key := node.AsElementAccessExpression().ArgumentExpression; ast.IsStringLiteral(key) {
		return key.Text()
	}
	return ""
}

// importedFrom returns the module that decl, an import binding's
// declaration, imports from, and whether it imports the module's namespace.
func importedFrom(decl *ast.Node) (module string, namespace bool) {
	namespace = decl.Kind == ast.KindNamespaceImport || decl.Kind == ast.KindImportEqualsDeclaration
	for n := decl; n != nil; n = n.Parent {
		switch {
		case ast.IsImportDeclaration(n):
			if specifier := n.ModuleSpecifier(); specifier != nil && ast.IsStringLiteral(specifier) {
				return specifier.Text(), namespace
			}
			return "", false
		case ast.IsImportEqualsDeclaration(n):
			if reference := n.AsImportEqualsDeclaration().ModuleReference; reference != nil && ast.IsExternalModuleReference(reference) {
				if expression := reference.AsExternalModuleReference().Expression; expression != nil && ast.IsStringLiteral(expression) {
					return expression.Text(), namespace
				}
			}
			return "", false
		}
	}
	return "", false
}

// isPlatformCallee reports whether the callee of call is rooted in a
// reference to a platform API, whose run EK4402 reports.
func isPlatformCallee(c *checker.Checker, call *ast.Node) bool {
	root := ast.SkipParentheses(call.Expression())
	for ast.IsPropertyAccessExpression(root) || ast.IsElementAccessExpression(root) {
		root = ast.SkipParentheses(root.Expression())
	}
	_, ok := platformReference(c, root)
	return ok
}

// checkPlatformUse reports id, a use of a platform global (D310), where the
// code uses it: calls it, constructs it, tags a template with it, reads a
// property of it, which can run a getter, as process.env does, or holds it as
// a value. A binding imported from a platform module draws its error at the
// import (checkPlatformImport), not at each use.
func checkPlatformUse(c *checker.Checker, file *ast.SourceFile, id *ast.Node) {
	ref, ok := platformReference(c, id)
	if !ok || ref.module != "" {
		return
	}
	use, runs := platformRun(c, id)
	if !runs {
		if isClockReadMember(c, id) {
			return // EK4403 reports it
		}
		use = id // the global held as a value
	}
	name := nodeText(file, use)
	if ref.module != "" {
		name += " from " + ref.module
	}
	members, top := accessChain(id)
	d := report(c, use, EK4402, name)
	notePlatformAPI(d, platformAPIOf(ref, members), hatchExample(file, top))
	if ref.unresolved {
		cover(c, id) // EK4402 explains TypeScript's "cannot find name"
	}
}

// isClockReadMember reports whether id, a platform global, is the object of
// a clock or randomness read, as performance is in performance.now(), which
// EK4403 reports instead.
func isClockReadMember(c *checker.Checker, id *ast.Node) bool {
	parent := id.Parent
	for parent != nil && ast.IsParenthesizedExpression(parent) {
		parent = parent.Parent
	}
	if parent == nil || !(ast.IsPropertyAccessExpression(parent) || ast.IsElementAccessExpression(parent)) {
		return false
	}
	call := parent.Parent
	return call != nil && (ast.IsCallExpression(call) || ast.IsNewExpression(call)) && call.Expression() == parent && isClockRead(c, call)
}

// accessChain returns the properties that code reads from node, a reference
// to a platform API, one after another, as in process.env.PORT, and the
// outermost of those reads, or node when it reads none.
func accessChain(node *ast.Node) (members []string, top *ast.Node) {
	top = node
	for {
		parent := top.Parent
		switch {
		case parent != nil && ast.IsPropertyAccessExpression(parent) && parent.Expression() == top:
			members = append(members, parent.Name().Text())
		case parent != nil && ast.IsElementAccessExpression(parent) && parent.Expression() == top &&
			ast.IsStringLiteral(parent.AsElementAccessExpression().ArgumentExpression):
			members = append(members, parent.AsElementAccessExpression().ArgumentExpression.Text())
		default:
			return members, top
		}
		top = parent
	}
}

// platformAPIOf returns what replaces the platform API that ref names, after
// the code reads members of it: the longest name in platformAPIs that the
// two make, then the "*" entry for the module's or global's other members,
// then the module's or global's service.
func platformAPIOf(ref platformRef, members []string) platformAPI {
	root := ref.name // the global, or the module, which is a prefix of the name
	if ref.module != "" {
		root = strings.TrimPrefix(ref.module, "node:")
	}
	name := ref.name
	if len(members) > 0 {
		name += "." + strings.Join(members, ".")
	}
	for full := name; ; name = name[:strings.LastIndexByte(name, '.')] {
		if api, ok := platformAPIs[name]; ok {
			return api
		}
		if len(name) <= len(root) {
			if full != root {
				if api, ok := platformAPIs[root+".*"]; ok {
					return api
				}
			}
			return platformAPI{service: ref.replacement}
		}
	}
}

// hatchExample shows top, the outermost expression in which code reads a
// platform API, run in a sync hatch, with the call or new it makes.
func hatchExample(file *ast.SourceFile, top *ast.Node) string {
	text := nodeText(file, top)
	if parent := top.Parent; parent != nil && (ast.IsCallExpression(parent) || ast.IsNewExpression(parent)) && parent.Expression() == top {
		if ast.IsNewExpression(parent) {
			text = "new " + text
		}
		if len(parent.Arguments()) == 0 {
			text += "()"
		} else {
			text += "(...)"
		}
	}
	return "sync(() => " + text + ")"
}

// platformRun reports whether the code runs value, an expression that
// denotes a platform API, where it appears, and returns the expression that
// names what runs: value itself for a call, a new, or a tagged template, and
// the property access for a read of one of its properties.
func platformRun(c *checker.Checker, value *ast.Node) (use *ast.Node, runs bool) {
	parent := value.Parent
	for parent != nil && ast.IsParenthesizedExpression(parent) {
		value, parent = parent, parent.Parent
	}
	switch {
	case parent == nil:
		return nil, false
	case (ast.IsCallExpression(parent) || ast.IsNewExpression(parent)) && parent.Expression() == value:
		return value, true
	case ast.IsTaggedTemplateExpression(parent) && parent.AsTaggedTemplateExpression().Tag == value:
		return value, true
	case (ast.IsPropertyAccessExpression(parent) || ast.IsElementAccessExpression(parent)) && parent.Expression() == value:
		if call := parent.Parent; call != nil && (ast.IsCallExpression(call) || ast.IsNewExpression(call)) && call.Expression() == parent && isClockRead(c, call) {
			return nil, false // EK4403 reports it
		}
		return parent, true
	case ast.IsVariableDeclaration(parent) && parent.Initializer() == value && ast.IsBindingPattern(parent.Name()):
		return value, true // destructuring reads its properties
	case ast.IsBinaryExpression(parent) && parent.AsBinaryExpression().OperatorToken.Kind == ast.KindEqualsToken &&
		parent.AsBinaryExpression().Right == value && (ast.IsObjectLiteralExpression(parent.AsBinaryExpression().Left) || ast.IsArrayLiteralExpression(parent.AsBinaryExpression().Left)):
		return value, true
	case ast.IsSpreadElement(parent) || ast.IsSpreadAssignment(parent):
		return value, true // spreading reads its elements or properties
	}
	return nil, false
}

// isValueUse reports whether id, an identifier, refers to a value where it
// appears: not a declaration's name, a property name, or part of a type.
func isValueUse(id *ast.Node) bool {
	parent := id.Parent
	if parent == nil || ast.IsDeclarationName(id) || ast.IsRightSideOfQualifiedNameOrPropertyAccess(id) || ast.IsPartOfTypeNode(id) || ast.IsJSDocNode(parent) {
		return false
	}
	switch parent.Kind {
	case ast.KindPropertyAssignment, ast.KindPropertyDeclaration, ast.KindPropertySignature, ast.KindMethodDeclaration,
		ast.KindMethodSignature, ast.KindGetAccessor, ast.KindSetAccessor, ast.KindEnumMember:
		return parent.Name() != id
	case ast.KindImportSpecifier, ast.KindExportSpecifier, ast.KindLabeledStatement, ast.KindBreakStatement, ast.KindContinueStatement, ast.KindQualifiedName:
		return false
	}
	return true
}

// notePlatformAPI adds the lines that say what replaces api: the Effect API,
// the import that brings it in, and the layer that provides it. For an API
// Effect lacks, they say so and show hatch, the code that runs it in a hatch.
func notePlatformAPI(d *ast.Diagnostic, api platformAPI, hatch string) {
	s := platformServices[api.service]
	if s == nil {
		note(d, "Effect, VibeLang's standard library, has no service for it yet, so escape to TypeScript for now.")
		if api.note != "" {
			note(d, api.note)
		}
		if hatch == "" {
			note(d, "Import it in a module block or a .ts file, and use it there or in a hatch.")
		} else {
			note(d, "Run it in a hatch:   {0}, or with try when it can throw; or move it to a module block or a .ts file.", hatch)
		}
		return
	}
	if example := cmp.Or(api.example, s.example); example != "" {
		note(d, "Use {0}:   {1}", s.use, example)
	} else {
		note(d, "Use {0}.", s.use)
	}
	noteService(d, s)
	if api.note != "" {
		note(d, api.note)
	}
}

// noteService adds the lines that say how to bring s into a .vibe file.
func noteService(d *ast.Diagnostic, s *platformService) {
	if s.imports != "" {
		note(d, "Import it with   {0}", s.imports)
	}
	if s.provider != "" {
		note(d, "Provide it in main with {0}.", s.provider)
	}
}

// clockReadOf returns the key in clockReads of the clock or randomness read
// that call, a call or new expression, makes, or "".
func clockReadOf(c *checker.Checker, call *ast.Node) string {
	decl := signatureDeclaration(c, call)
	if decl == nil {
		return ""
	}
	file := ast.GetSourceFileOfNode(decl)
	if !isLibFile(c, file) && !isPlatformPackage(packageOf(c, file)) {
		return ""
	}
	owner := ownerOf(decl)
	if owner == nil {
		return ""
	}
	key := declarationName(owner)
	if container := containerName(owner); container != "" {
		key = container + "." + key
	}
	switch {
	case ast.IsNewExpression(call):
		// new Date() reads the clock; new Date(value) parses value.
		if key == "DateConstructor" && decl.Kind == ast.KindConstructSignature && len(call.Arguments()) == 0 {
			return "DateConstructor.constructor"
		}
		return ""
	case key == "DateConstructor" && decl.Kind != ast.KindCallSignature:
		return ""
	}
	if _, ok := clockReads[key]; ok {
		return key
	}
	return ""
}

func isClockRead(c *checker.Checker, call *ast.Node) bool {
	return clockReadOf(c, call) != ""
}

// checkClockRead reports EK4403 for a clock or randomness read.
func checkClockRead(c *checker.Checker, file *ast.SourceFile, call *ast.Node) {
	key := clockReadOf(c, call)
	if key == "" {
		return
	}
	text := nodeText(file, call.Expression()) + "()"
	if ast.IsNewExpression(call) {
		text = "new " + text
	}
	read := clockReads[key]
	d := report(c, call, EK4403, text)
	note(d, "Use {0}.", read.use)
	if s := platformServices[read.service]; s != nil {
		noteService(d, s)
	}
	note(d, read.test)
	note(d, "To allow it, set \"EK4403\": \"warning\" or \"off\" in \"vibelang\": { \"diagnostics\": { ... } } at the top level of tsconfig.json.")
}
