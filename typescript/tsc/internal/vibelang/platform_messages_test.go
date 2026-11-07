package vibelang

import (
	"regexp"
	"slices"
	"strings"
	"testing"
)

// platformTypes stands in for @types/node: the modules and globals that the
// tests run, declared in a platform package.
const platformTypes = `declare module "node:fs/promises" {
  export function readFile(path: string, encoding: string): Promise<string>
  export function mkdtemp(prefix: string): Promise<string>
  export function lstat(path: string): Promise<unknown>
}
declare module "node:path" { export function join(...paths: string[]): string }
declare module "node:child_process" { export function execFileSync(command: string, args: string[]): string }
declare module "node:net" { export function isIPv6(address: string): boolean }
declare module "node:http" { export function createServer(): unknown }
declare module "node:os" { export function tmpdir(): string; export function hostname(): string; export function uptime(): number; export function homedir(): string }
declare module "node:events" { export function once(emitter: unknown, name: string): Promise<unknown[]> }
declare module "node:fs" { export const constants: { X_OK: number; O_NONBLOCK: number } }
declare module "node:crypto" { export function createHmac(algorithm: string, key: Uint8Array): unknown }
declare var process: { cwd(): string; env: Record<string, string | undefined>; pid: number; argv: string[]; kill(pid: number, signal?: string | number): true; umask(): number; getuid?(): number }
declare var Buffer: { from(text: string): Uint8Array }
declare var document: { title: string }
declare var window: { matchMedia(query: string): { matches: boolean } }
declare var matchMedia: typeof window.matchMedia
declare var requestAnimationFrame: (callback: (time: number) => void) => number
declare var cancelAnimationFrame: (id: number) => void
declare var FileReader: { new(): unknown }
declare var ResizeObserver: { new(callback: () => void): unknown }
declare var AudioContext: { new(): unknown }
declare var crossOriginIsolated: boolean
declare type Element = unknown
declare var getComputedStyle: (element: Element) => unknown
declare var HTMLElement: { new(): unknown }
declare var CSS: { escape(value: string): string }`

const (
	provideNodeServices        = `Provide it in main with NodeServices.layer from "@effect/platform-node", or BunServices.layer from "@effect/platform-bun".`
	provideCrypto              = `Provide it in main with NodeCrypto.layer from "@effect/platform-node", BunCrypto.layer from "@effect/platform-bun", or BrowserCrypto.layer from "@effect/platform-browser".`
	provideExperimental        = `Provide it in main with ExperimentalNodeServices.layer from "vibelang-runtime/experimental/platform-node", or ExperimentalBunServices.layer from "vibelang-runtime/experimental/platform-bun".`
	provideExperimentalBrowser = `Provide it in main with ExperimentalBrowserServices.layer from "vibelang-runtime/experimental/platform-browser".`
	noServiceYet               = "Effect, VibeLang's standard library, has no service for it yet, so escape to TypeScript for now."
)

// EK4402 name the Effect API that replaces a platform API and
// the layer that provides it; Effect's modules need no import (D310, D311).
// For an API Effect lacks, they name VibeLang's experimental service, or show
// the escape to TypeScript, never a wrapper module. A platform global is an
// error wherever .vibe code uses it, and an import of a platform module at
// each value it binds; a type-only import, and an import in a module block,
// stay allowed (D310).
func TestPlatformReplacementMessages(t *testing.T) {
	tests := []struct {
		name   string
		source string
		want   []string // EK4402's lines; none for code that runs no platform API
	}{
		{"fs", `import { readFile } from "node:fs/promises"
export const run = (path: string) => readFile(path, "utf8")`, []string{
			"readFile from node:fs/promises is platform code, which a .vibe file does not import as a value.",
			"Use the FileSystem service:   (try FileSystem.FileSystem).readFileString(path)", provideNodeServices,
		}},
		{"path", `import * as path from "node:path"
export const run = (name: string) => path.join("dist", name)`, []string{
			"path from node:path is platform code, which a .vibe file does not import as a value.",
			"Use the Path service:   (try Path.Path).join(directory, name)", provideNodeServices,
		}},
		{"child process", `import { execFileSync } from "node:child_process"
export const run = () => execFileSync("git", ["status"])`, []string{
			"execFileSync from node:child_process is platform code, which a .vibe file does not import as a value.",
			"Use the ChildProcessSpawner service:   try (try ChildProcessSpawner.ChildProcessSpawner).string(ChildProcess.make(command, args))",
			provideNodeServices,
		}},
		// rule-evidence: docs/design/vips/0033-platform-stdlib.md#af700d45440d7ea1 | Its quick fix and the codemod move the body into a sibling `.ts` module, or point to the Effect service (`HttpClient` for `fetch`).
		{"http client inside tryPromise", `export const run = (url: string) => Effect.tryPromise(() => fetch(url))`, []string{
			"fetch is platform code, which VibeLang code does not use directly.",
			"Use HttpClient:   HttpClient.get(url)",
			`Provide it in main with FetchHttpClient.layer from "effect/http", or NodeHttpClient.layerUndici from "@effect/platform-node".`,
		}},
		{"http client", `export const run = (url: string) => fetch(url)`, []string{
			"fetch is platform code, which VibeLang code does not use directly.",
			"Use HttpClient:   HttpClient.get(url)",
			`Provide it in main with FetchHttpClient.layer from "effect/http", or NodeHttpClient.layerUndici from "@effect/platform-node".`,
		}},
		{"a global as a value", `export const client = fetch`, []string{
			"fetch is platform code, which VibeLang code does not use directly.",
			"Use HttpClient:   HttpClient.get(url)",
			`Provide it in main with FetchHttpClient.layer from "effect/http", or NodeHttpClient.layerUndici from "@effect/platform-node".`,
		}},
		{"scoped IPv6", `import { isIPv6 } from "node:net"
export const run = (address: string) => isIPv6(address)`, []string{
			"isIPv6 from node:net is platform code, which a .vibe file does not import as a value.",
			"Use the pure Experimental.NetAddress predicate, which needs no layer:   Experimental.NetAddress.isIPv6(address)",
			"Effect parses the address; this predicate preserves Node's numeric and ASCII zone syntax.",
		}},
		{"http server", `import { createServer } from "node:http"
export const run = () => createServer()`, []string{
			"createServer from node:http is platform code, which a .vibe file does not import as a value.",
			"Use HttpRouter:   HttpRouter.serve(app)",
			`Provide it in main with ExperimentalNodeHttpServer.layer({ port }) from "vibelang-runtime/experimental/platform-node", or BunHttpServer.layer({ port }) from "@effect/platform-bun".`,
		}},
		{"type-only import", `import type { Server } from "node:http"
import { type Server as Other } from "node:http"
export const same = (server: Server, other: Other) => server === other`, nil},
		{"import in a module block", `module host {
  import { createServer } from "node:http"
  export const server = createServer
}
import { server } from host
export const run = () => typeof server`, nil},
		{"import for its effects", `import "node:http"`, []string{
			"node:http is platform code, which VibeLang code does not import.",
			"Use HttpClient:   HttpClient.get(url)",
			`Provide it in main with FetchHttpClient.layer from "effect/http", or NodeHttpClient.layerUndici from "@effect/platform-node".`,
		}},
		{"process.cwd", `export const run = () => process.cwd()`, []string{
			"process.cwd is platform code, which VibeLang code does not use directly.",
			"Use the Path service:   (try Path.Path).resolve()", provideNodeServices,
		}},
		{"process.env", `export const run = () => process.env.PORT`, []string{
			"process.env is platform code, which VibeLang code does not use directly.",
			`Use Config, from the prelude:   try Config.String("NAME")`,
		}},
		{"process.getuid", `export const run = () => process.getuid?.()`, []string{
			"process.getuid is platform code, which VibeLang code does not use directly.",
			"Use the experimental Process service:   try (try Experimental.Process.Process).currentUid", provideExperimental,
			"Process.currentUid preserves undefined when getuid is unavailable, uid 0, and the original host error as a typed failure.",
		}},
		{"process.argv", `export const run = () => process.argv`, []string{
			"process.argv is platform code, which VibeLang code does not use directly.",
			"Use the Stdio service:   try (try Stdio.Stdio).args", provideNodeServices,
			"The args effect leaves out argv[0] and argv[1], the runtime and the script.",
		}},
		{"tmpdir", `import { tmpdir } from "node:os"
export const run = () => tmpdir()`, []string{
			"tmpdir from node:os is platform code, which a .vibe file does not import as a value.",
			"Use the experimental Process service:   try (try Experimental.Process.Process).temporaryDirectory", provideExperimental,
			"Process.temporaryDirectory queries the native temporary directory without creating a directory or file.",
		}},
		{"mkdtemp", `import { mkdtemp } from "node:fs/promises"
export const run = () => mkdtemp("build-")`, []string{
			"mkdtemp from node:fs/promises is platform code, which a .vibe file does not import as a value.",
			"Use the FileSystem service:   (try FileSystem.FileSystem).makeTempDirectory()", provideNodeServices,
		}},
		{"crypto digest", `export const run = (bytes: Uint8Array) => crypto.subtle.digest("SHA-256", bytes)`, []string{
			"crypto.subtle is platform code, which VibeLang code does not use directly.",
			`Use Effect's crypto services:   try (try Digest.Digest).digest(Digest.sha256, bytes)`, provideCrypto,
		}},
		{"timers", `export const run = (f: () => void) => setTimeout(f, 10)`, []string{
			"setTimeout is platform code, which VibeLang code does not use directly.",
			`Use sleep and Schedule, from the prelude:   sleep("1 second")`,
		}},
		{"bytes", `export const run = (text: string) => Buffer.from(text)`, []string{
			"Buffer.from is platform code, which VibeLang code does not use directly.",
			"Use Uint8Array and TextEncoder or TextDecoder, which need no layer, or Base64 and Hex:   new TextEncoder().encode(text)",
			"Base64.decode(text) and Hex.decode(text) read encoded bytes.",
		}},
		{"gap", `import { uptime } from "node:os"
export const run = () => uptime()`, []string{
			"uptime from node:os is platform code, which a .vibe file does not import as a value.",
			noServiceYet, "Move the platform code into a .ts module and expose it through an Effect; wrapping it inside a .vibe file does not grant host access.",
		}},
		{"experimental", `import { hostname } from "node:os"
export const run = () => hostname()`, []string{
			"hostname from node:os is platform code, which a .vibe file does not import as a value.",
			"Use the experimental Process service:   try (try Experimental.Process.Process).hostname", provideExperimental,
		}},
		{"home directory", `import { homedir } from "node:os"
export const run = () => homedir()`, []string{
			"homedir from node:os is platform code, which a .vibe file does not import as a value.",
			"Use the experimental Process service:   try (try Experimental.Process.Process).homeDirectory", provideExperimental,
			"homeDirectory delegates to os.homedir, including native account fallback; UserDirectories.home remains an environment resolver.",
		}},
		{"experimental service with a note", `export const run = (pid: number) => process.kill(pid, "SIGINT")`, []string{
			"process.kill is platform code, which VibeLang code does not use directly.",
			"Use the experimental Process service:   try (try Experimental.Process.Process).kill(pid, { killSignal })", provideExperimental,
			"Signal 0 is (try Experimental.Process.Process).isRunning(pid); a child that the injected ChildProcessSpawner service started also stops with its handle's kill().",
		}},
		{"experimental locks", `export const run = (name: string) => navigator.locks.request(name, () => undefined)`, []string{
			"navigator.locks is platform code, which VibeLang code does not use directly.",
			"Use the experimental Locks service:   try (try Experimental.Locks.Locks).hold(name)",
			`Provide it in main with ExperimentalBrowserLocks.layer from "vibelang-runtime/experimental/platform-browser"; ExperimentalNodeLocks.layer from "vibelang-runtime/experimental/platform-node" locks only within one Node.js process.`,
			"A Semaphore locks only within one program.",
		}},
		{"gap with a near miss", `import { once } from "node:events"
export const run = (emitter: unknown) => once(emitter, "exit")`, []string{
			"once from node:events is platform code, which a .vibe file does not import as a value.",
			noServiceYet, "Effect has no adapter for a Node.js EventEmitter; Stream.fromEventListener reads an event target.",
			"Move the platform code into a .ts module and expose it through an Effect; wrapping it inside a .vibe file does not grant host access.",
		}},
		{"lstat", `import { lstat } from "node:fs/promises"
export const run = (path: string) => lstat(path)`, []string{
			"lstat from node:fs/promises is platform code, which a .vibe file does not import as a value.",
			"Use the FileSystem service:   (try FileSystem.FileSystem).lstat(path)", provideNodeServices,
		}},
		{"file system constants", `import { constants } from "node:fs"
export const run = () => constants.O_NONBLOCK`, []string{
			"constants from node:fs is platform code, which a .vibe file does not import as a value.",
			`Use the FileSystem service:   (try FileSystem.FileSystem).open(path, { flag: "wx" })`, provideNodeServices,
		}},
		{"hmac", `import { createHmac } from "node:crypto"
export const run = (key: Uint8Array) => createHmac("sha256", key)`, []string{
			"createHmac from node:crypto is platform code, which a .vibe file does not import as a value.",
			"Use Effect's crypto services:   try (try Mac.Mac).sign(key, data)", provideCrypto,
			"try Mac.key(Mac.hmacSha256, bytes) makes the key, and the sign method takes all the data in one call.",
		}},
		{"signatures", `export const run = (key: CryptoKey, data: Uint8Array) => crypto.subtle.sign("Ed25519", key, data)`, []string{
			"crypto.subtle is platform code, which VibeLang code does not use directly.",
			"Use Effect's crypto services:   try (try Signature.Signature).sign(privateKey, data)", provideCrypto,
			"try Signature.privateKey(Signature.ed25519, bytes) and try Signature.publicKey(Signature.ed25519, bytes) make the keys from their bytes.",
		}},
		{"gap of a property", `export const run = () => process.umask()`, []string{
			"process.umask is platform code, which VibeLang code does not use directly.",
			noServiceYet, "Move the platform code into a .ts module and expose it through an Effect; wrapping it inside a .vibe file does not grant host access.",
		}},
		{"experimental property", `export const run = () => process.pid`, []string{
			"process.pid is platform code, which VibeLang code does not use directly.",
			"Use the experimental Process service:   try (try Experimental.Process.Process).pid", provideExperimental,
		}},
		{"experimental browser global", `export const run = (query: string) => matchMedia(query)`, []string{
			"matchMedia is platform code, which VibeLang code does not use directly.",
			"Use the experimental MediaQuery service:   try (try Experimental.MediaQuery.MediaQuery).matches(query)", provideExperimentalBrowser,
		}},
		{"experimental browser member of window", `export const run = (query: string) => window.matchMedia(query)`, []string{
			"window.matchMedia is platform code, which VibeLang code does not use directly.",
			"Use the experimental MediaQuery service:   try (try Experimental.MediaQuery.MediaQuery).matches(query)", provideExperimentalBrowser,
		}},
		{"animation frame", `export const run = (draw: (time: number) => void) => requestAnimationFrame(draw)`, []string{
			"requestAnimationFrame is platform code, which VibeLang code does not use directly.",
			"Use the experimental Animations service:   try (try Experimental.Animations.Animations).nextFrame", provideExperimentalBrowser,
		}},
		{"cancelling an animation frame", `export const run = (id: number) => cancelAnimationFrame(id)`, []string{
			"cancelAnimationFrame is platform code, which VibeLang code does not use directly.",
			"Use the experimental Animations service:   try (try Experimental.Animations.Animations).nextFrame", provideExperimentalBrowser,
			"Interrupting nextFrame cancels its frame; nextFrameUnless atomically chooses a pending commit or a frame.",
		}},
		{"file reader", `export const run = () => new FileReader()`, []string{
			"FileReader is platform code, which VibeLang code does not use directly.",
			"Use the experimental FileReader service:   try (try Experimental.FileReader.FileReader).readAsText(blob)", provideExperimentalBrowser,
		}},
		{"resize observer", `export const run = () => new ResizeObserver(() => {})`, []string{
			"ResizeObserver is platform code, which VibeLang code does not use directly.",
			"Use the experimental ResizeObserver service:   try (try Experimental.ResizeObserver.ResizeObserver).observe(element, onResize)", provideExperimentalBrowser,
		}},
		{"audio context", `export const run = () => new AudioContext()`, []string{
			"AudioContext is platform code, which VibeLang code does not use directly.",
			"Use the experimental AudioContext service:   try (try Experimental.AudioContext.AudioContext).acquire", provideExperimentalBrowser,
		}},
		{"cross-origin isolation", `export const run = () => crossOriginIsolated`, []string{
			"crossOriginIsolated is platform code, which VibeLang code does not use directly.",
			"Use the experimental BrowserInfo service:   try (try Experimental.BrowserInfo.BrowserInfo).crossOriginIsolated", provideExperimentalBrowser,
		}},
		{"user agent", `export const run = () => navigator.userAgent`, []string{
			"navigator.userAgent is platform code, which VibeLang code does not use directly.",
			"Use the experimental BrowserInfo service:   try (try Experimental.BrowserInfo.BrowserInfo).userAgent", provideExperimentalBrowser,
		}},
		{"computed style", `export const run = (element: Element) => getComputedStyle(element)`, []string{
			"getComputedStyle is platform code, which VibeLang code does not use directly.",
			"Use the experimental Window service:   try (try Experimental.Window.Window).computedStyle(element)", provideExperimentalBrowser,
		}},
		{"element predicate", `export const run = (value: unknown) => value instanceof HTMLElement`, []string{
			"HTMLElement is platform code, which VibeLang code does not use directly.",
			"Use the experimental Document service:   (try Experimental.Document.Document).isHTMLElement(value)", provideExperimentalBrowser,
			"It narrows as instanceof does, and throws as instanceof does on a host without HTMLElement.",
		}},
		{"css escape", `export const run = (value: string) => CSS.escape(value)`, []string{
			"CSS.escape is platform code, which VibeLang code does not use directly.",
			"Use the experimental Document service:   try (try Experimental.Document.Document).escapeSelector(value)", provideExperimentalBrowser,
		}},
		{"gap", `export const run = () => document.title`, []string{
			"document.title is platform code, which VibeLang code does not use directly.",
			noServiceYet, "Effect has no service for the DOM; try (try Experimental.Document.Document).current gives an API that takes it the page's Document, and other UI code belongs in a .ts or .tsx file, such as a React component's.",
			"Move the platform code into a .ts module and expose it through an Effect; wrapping it inside a .vibe file does not grant host access.",
		}},
		{"clock", `export const run = () => Date.now()`, nil},
		{"monotonic clock", `export const run = () => performance.now()`, []string{
			"performance.now() is platform code, which VibeLang code does not use directly.",
			"Use Number(try Clock.monotonicTimeNanos) / 1e6: Clock.monotonicTimeNanos yields bigint nanoseconds, and performance.now() returns number milliseconds.",
			"In a test, TestClock sets it.",
		}},
		{"date call", `export const run = () => Date()`, nil},
		{"date", `export const run = () => new Date()`, nil},
		{"random", `export const run = () => Math.random()`, nil},
		{"crypto", `export const run = () => crypto.randomUUID()`, []string{
			"crypto.randomUUID() is platform code, which VibeLang code does not use directly.",
			"Use try (try SecureRandom.SecureRandom).uuidV4().", provideCrypto,
			"In a test, provide Layer.succeed(SecureRandom.SecureRandom, SecureRandom.make(randomBytes)) with fixed bytes; a seeded Random does not reach SecureRandom.",
		}},
		{"pure web helpers", `export const run = (text: string, url: string) => [
  new TextEncoder().encode(text), new TextDecoder().decode(new Uint8Array()), new URL(url).host, new URLSearchParams(text).size,
  structuredClone({ text }), atob(btoa(text)), new Headers().has(text), new AbortController().signal.aborted,
]`, nil},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			files := computedKeyFiles(false)
			files["/workspace/x/src/node_modules/@types/node/package.json"] = `{"name":"@types/node","types":"index.d.ts"}`
			files["/workspace/x/src/node_modules/@types/node/index.d.ts"] = platformTypes
			files["/workspace/x/src/main.vibe"] = test.source
			// Load the host declarations: these test replacement messages, not missing names.
			files["/workspace/x/src/tsconfig.json"] = strings.Replace(files["/workspace/x/src/tsconfig.json"], `"files":["main.vibe"]`, `"files":["main.vibe","node_modules/@types/node/index.d.ts"]`, 1)
			var got []string
			for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
				if d.Code() == EK4402.Code {
					got = append(got, diagnosticWithNotes(d))
				}
			}
			var want []string
			if test.want != nil {
				want = []string{strings.Join(test.want, "\n")}
			}
			if !slices.Equal(got, want) {
				t.Errorf("got:\n%s\nwant:\n%s", strings.Join(got, "\n--\n"), strings.Join(want, "\n--\n"))
			}
		})
	}
}

// Every service the tables name exists, and each example calls only what
// its service's import brings in, Effect's modules, which need no import
// (D310), the experimental services (D313), or a value the program has.
func TestPlatformServicesTable(t *testing.T) {
	named := func(where, service string) {
		if service != "" && platformServices[service] == nil {
			t.Errorf("%s names %q, which is not in platformServices", where, service)
		}
	}
	for module, service := range platformModules {
		named("platformModules["+module+"]", service)
	}
	for module, service := range prefixOnlyModules {
		named("prefixOnlyModules["+module+"]", service)
	}
	for global, service := range platformGlobals {
		named("platformGlobals["+global+"]", service)
	}
	for api, entry := range platformAPIs {
		named("platformAPIs["+api+"]", entry.service)
	}
	for read, entry := range clockReads {
		named("clockReads["+read+"]", entry.service)
	}
	imported := regexp.MustCompile(`import \{ ([^}]*) \}|import \* as (\w+)`)
	receiver := regexp.MustCompile(`(?:^|[^.\w/])([A-Za-z_]\w*)\.`) // not a path's or a member's
	prelude := []string{"Number", "String", "fiber", "import", "Experimental", "globalThis"}
	for name := range preludeModules {
		prelude = append(prelude, name)
	}
	for name := range effectRootNames {
		prelude = append(prelude, name)
	}
	for name := range effectSubpathNames {
		prelude = append(prelude, name)
	}
	check := func(where, example string, s *platformService) {
		names := slices.Clone(prelude)
		for _, m := range imported.FindAllStringSubmatch(s.imports, -1) {
			for _, name := range strings.Split(m[1]+m[2], ",") {
				names = append(names, strings.TrimSpace(name))
			}
		}
		for _, m := range receiver.FindAllStringSubmatch(example, -1) {
			if !slices.Contains(names, m[1]) {
				t.Errorf("%s: %s uses %s, which %q does not import", where, example, m[1], s.imports)
			}
		}
	}
	for name, s := range platformServices {
		check("platformServices["+name+"]", s.example, s)
	}
	for api, entry := range platformAPIs {
		if s := platformServices[entry.service]; s != nil {
			check("platformAPIs["+api+"]", entry.example, s)
		}
	}
	for read, entry := range clockReads {
		if s := platformServices[entry.service]; s != nil {
			check("clockReads["+read+"]", entry.use, s)
		}
	}
}

// VIP-33 platform diagnostics name the replacement service or TypeScript boundary; rule: docs/design/vips/0033-platform-stdlib.md#af700d45440d7ea1

// VIP-33 platform diagnostics name the replacement service or TypeScript boundary; rule: docs/design/vips/0033-platform-stdlib.md#62d8805f69f4827a

// VIP-33 platform diagnostics name the replacement service or TypeScript boundary; rule: docs/design/vips/0033-platform-stdlib.md#7d95861f74bde022
