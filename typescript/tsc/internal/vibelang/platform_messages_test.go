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
declare module "node:http" { export function createServer(): unknown }
declare module "node:os" { export function tmpdir(): string; export function hostname(): string; export function uptime(): number; export function homedir(): string }
declare module "node:events" { export function once(emitter: unknown, name: string): Promise<unknown[]> }
declare module "node:fs" { export const constants: { X_OK: number; O_NONBLOCK: number } }
declare module "node:crypto" { export function createHmac(algorithm: string, key: Uint8Array): unknown }
declare var process: { cwd(): string; env: Record<string, string | undefined>; pid: number; argv: string[]; kill(pid: number, signal?: string | number): true; umask(): number }
declare var Buffer: { from(text: string): Uint8Array }
declare var document: { title: string }`

const (
	provideNodeServices = `Provide it in main with NodeServices.layer from "@effect/platform-node", or BunServices.layer from "@effect/platform-bun".`
	provideCrypto       = `Provide it in main with NodeCrypto.layer from "@effect/platform-node", BunCrypto.layer from "@effect/platform-bun", or BrowserCrypto.layer from "@effect/platform-browser".`
	provideExperimental = `Provide it in main with ExperimentalNodeServices.layer from "vibelang-runtime/experimental/platform-node", or ExperimentalBunServices.layer from "vibelang-runtime/experimental/platform-bun".`
	noServiceYet        = "Effect, VibeLang's standard library, has no service for it yet, so escape to TypeScript for now."
	allowEK4403         = `To allow it, set "EK4403": "warning" or "off" in "vibelang": { "diagnostics": { ... } } at the top level of tsconfig.json.`
)

// EK4402 and EK4403 name the Effect API that replaces a platform API and
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
		want   []string // EK4402's or EK4403's lines; none for code that runs no platform API
	}{
		{"fs", `import { readFile } from "node:fs/promises"
export const run = (path: string) => readFile(path, "utf8")`, []string{
			"readFile from node:fs/promises is platform code, which a .vibe file does not import as a value.",
			"Use the FileSystem service:   FileSystem.readFileString(path)", provideNodeServices,
		}},
		{"path", `import * as path from "node:path"
export const run = (name: string) => path.join("dist", name)`, []string{
			"path from node:path is platform code, which a .vibe file does not import as a value.",
			"Use the Path service:   Path.join(directory, name)", provideNodeServices,
		}},
		{"child process", `import { execFileSync } from "node:child_process"
export const run = () => execFileSync("git", ["status"])`, []string{
			"execFileSync from node:child_process is platform code, which a .vibe file does not import as a value.",
			"Use the ChildProcessSpawner service:   ChildProcessSpawner.string(ChildProcess.make(command, args))",
			provideNodeServices,
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
		{"http server", `import { createServer } from "node:http"
export const run = () => createServer()`, []string{
			"createServer from node:http is platform code, which a .vibe file does not import as a value.",
			"Use HttpRouter:   HttpRouter.serve(app)",
			`Provide it in main with NodeHttpServer.layer(createServer, { port }) from "@effect/platform-node", which runs createServer itself.`,
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
			"Use the Path service:   Path.resolve()", provideNodeServices,
		}},
		{"process.env", `export const run = () => process.env.PORT`, []string{
			"process.env is platform code, which VibeLang code does not use directly.",
			`Use Config, from the prelude:   Config.String("NAME")()`,
		}},
		{"process.argv", `export const run = () => process.argv`, []string{
			"process.argv is platform code, which VibeLang code does not use directly.",
			"Use the Stdio service:   Stdio.args()", provideNodeServices,
			"Stdio.args() leaves out argv[0] and argv[1], the runtime and the script.",
		}},
		{"tmpdir", `import { tmpdir } from "node:os"
export const run = () => tmpdir()`, []string{
			"tmpdir from node:os is platform code, which a .vibe file does not import as a value.",
			"Use the FileSystem service:   FileSystem.makeTempDirectory()", provideNodeServices,
			"FileSystem.makeTempDirectory creates a directory in it; nothing returns its path alone.",
		}},
		{"mkdtemp", `import { mkdtemp } from "node:fs/promises"
export const run = () => mkdtemp("build-")`, []string{
			"mkdtemp from node:fs/promises is platform code, which a .vibe file does not import as a value.",
			"Use the FileSystem service:   FileSystem.makeTempDirectory()", provideNodeServices,
		}},
		{"crypto digest", `export const run = (bytes: Uint8Array) => crypto.subtle.digest("SHA-256", bytes)`, []string{
			"crypto.subtle is platform code, which VibeLang code does not use directly.",
			`Use Effect's crypto services:   Digest.digest(Digest.sha256, bytes)`, provideCrypto,
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
			noServiceYet, "Import it in a module block or a .ts file, and use it there or in a hatch.",
		}},
		{"experimental", `import { hostname } from "node:os"
export const run = () => hostname()`, []string{
			"hostname from node:os is platform code, which a .vibe file does not import as a value.",
			"Use the experimental Process service:   Experimental.Process.hostname()", provideExperimental,
		}},
		{"home directory", `import { homedir } from "node:os"
export const run = () => homedir()`, []string{
			"homedir from node:os is platform code, which a .vibe file does not import as a value.",
			"Use the UserDirectories service:   UserDirectories.home()",
			"Provide it in main with UserDirectories.layer.",
			"UserDirectories.home() reads HOME, or USERPROFILE on Windows; os.homedir() also falls back to the user database.",
		}},
		{"experimental service with a note", `export const run = (pid: number) => process.kill(pid, "SIGINT")`, []string{
			"process.kill is platform code, which VibeLang code does not use directly.",
			"Use the experimental Process service:   Experimental.Process.kill(pid, { killSignal })", provideExperimental,
			"Signal 0 is Experimental.Process.isRunning(pid); a child that ChildProcessSpawner.spawn started also stops with its handle's kill().",
		}},
		{"experimental locks", `export const run = (name: string) => navigator.locks.request(name, () => undefined)`, []string{
			"navigator.locks is platform code, which VibeLang code does not use directly.",
			"Use the experimental Locks service:   Experimental.Locks.hold(name)",
			`Provide it in main with ExperimentalBrowserLocks.layer from "vibelang-runtime/experimental/platform-browser"; ExperimentalNodeLocks.layer from "vibelang-runtime/experimental/platform-node" locks only within one Node.js process.`,
			"A Semaphore locks only within one program.",
		}},
		{"gap with a near miss", `import { once } from "node:events"
export const run = (emitter: unknown) => once(emitter, "exit")`, []string{
			"once from node:events is platform code, which a .vibe file does not import as a value.",
			noServiceYet, "Effect has no adapter for a Node.js EventEmitter; Stream.fromEventListener reads an event target.",
			"Import it in a module block or a .ts file, and use it there or in a hatch.",
		}},
		{"lstat", `import { lstat } from "node:fs/promises"
export const run = (path: string) => lstat(path)`, []string{
			"lstat from node:fs/promises is platform code, which a .vibe file does not import as a value.",
			"Use the FileSystem service:   FileSystem.lstat(path)", provideNodeServices,
		}},
		{"file system constants", `import { constants } from "node:fs"
export const run = () => constants.O_NONBLOCK`, []string{
			"constants from node:fs is platform code, which a .vibe file does not import as a value.",
			`Use the FileSystem service:   FileSystem.open(path, { flag: "wx" })`, provideNodeServices,
		}},
		{"hmac", `import { createHmac } from "node:crypto"
export const run = (key: Uint8Array) => createHmac("sha256", key)`, []string{
			"createHmac from node:crypto is platform code, which a .vibe file does not import as a value.",
			"Use Effect's crypto services:   Mac.sign(key, data)", provideCrypto,
			"Mac.key(Mac.hmacSha256, bytes) makes the key, and Mac.sign takes all the data in one call.",
		}},
		{"signatures", `export const run = (key: CryptoKey, data: Uint8Array) => crypto.subtle.sign("Ed25519", key, data)`, []string{
			"crypto.subtle is platform code, which VibeLang code does not use directly.",
			"Use Effect's crypto services:   Signature.sign(privateKey, data)", provideCrypto,
			"Signature.privateKey(Signature.ed25519, bytes) and Signature.publicKey make the keys from their bytes.",
		}},
		{"gap of a property", `export const run = () => process.umask()`, []string{
			"process.umask is platform code, which VibeLang code does not use directly.",
			noServiceYet, "Run it in a hatch:   sync(() => process.umask()), or with try when it can throw; or move it to a module block or a .ts file.",
		}},
		{"experimental property", `export const run = () => process.pid`, []string{
			"process.pid is platform code, which VibeLang code does not use directly.",
			"Use the experimental Process service:   Experimental.Process.pid()", provideExperimental,
		}},
		{"gap", `export const run = () => document.title`, []string{
			"document.title is platform code, which VibeLang code does not use directly.",
			noServiceYet, "Effect has no service for the DOM; UI code belongs in a .ts or .tsx file, such as a React component's.",
			"Run it in a hatch:   sync(() => document.title), or with try when it can throw; or move it to a module block or a .ts file.",
		}},
		{"clock", `export const run = () => Date.now()`, []string{
			"Date.now() reads the clock or randomness, which a test cannot control.",
			"Use Clock.currentTimeMillis(), the same number of milliseconds.", "In a test, TestClock sets it.", allowEK4403,
		}},
		{"monotonic clock", `export const run = () => performance.now()`, []string{
			"performance.now() reads the clock or randomness, which a test cannot control.",
			"Use Number(Clock.monotonicTimeNanos()) / 1e6: Clock.monotonicTimeNanos() is a bigint of nanoseconds, and performance.now() a number of milliseconds.",
			"In a test, TestClock sets it.", allowEK4403,
		}},
		{"date", `export const run = () => new Date()`, []string{
			"new Date() reads the clock or randomness, which a test cannot control.",
			"Use DateTime.nowAsDate() for a Date, or DateTime.now() for a DateTime.Utc.", "In a test, TestClock sets it.", allowEK4403,
		}},
		{"random", `export const run = () => Math.random()`, []string{
			"Math.random() reads the clock or randomness, which a test cannot control.",
			"Use Random.next(), a number from 0 up to 1.", "In a test, Random.withSeed(() => program(), seed) fixes it.", allowEK4403,
		}},
		{"crypto", `export const run = () => crypto.randomUUID()`, []string{
			"crypto.randomUUID() reads the clock or randomness, which a test cannot control.",
			"Use SecureRandom.uuidV4().", provideCrypto,
			"In a test, provide Layer.succeed(SecureRandom.SecureRandom, SecureRandom.make(randomBytes)) with fixed bytes; a seeded Random does not reach SecureRandom.", allowEK4403,
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
			files["/Users/x/src/node_modules/@types/node/package.json"] = `{"name":"@types/node","types":"index.d.ts"}`
			files["/Users/x/src/node_modules/@types/node/index.d.ts"] = platformTypes
			files["/Users/x/src/main.vibe"] = test.source
			var got []string
			for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
				if d.Code() == EK4402.Code || d.Code() == EK4403.Code {
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
