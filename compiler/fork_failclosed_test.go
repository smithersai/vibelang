package compiler

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// Every rule in this file is a FAIL-CLOSED obligation: the language requires a
// program to be rejected, and a compiler that accepts it is silently wrong
// rather than merely incomplete. Each rule is therefore pinned twice —
//
//   - a rejection case asserting the exact diagnostic code at the exact
//     authored line and column, and
//   - a companion case asserting that the legitimate nearby form still
//     compiles and still runs, because a refusal that is too broad is its own
//     defect.
//
// The authored positions are read off the source text in the case tables, not
// copied out of an implementation run.

// failClosedCase is one authored `.sm` program and the observation it must
// produce. `reject` lists every diagnostic the program must produce, as
// `CODE@line:column`; an empty list means the program must compile and run.
type failClosedCase struct {
	name    string
	source  string
	support string   // optional foreign `.ts` module compiled as `foreign.ts`
	modules []string // optional extra `.sm` modules, as "name.sm\x00text"
	reject  []string
	stdout  string // required output when the program must be accepted
}

func runFailClosedCases(t *testing.T, cases []failClosedCase) {
	t.Helper()
	backend, ctx := newPinnedTestBackend(t)
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: testCase.source}}
			if testCase.support != "" {
				files = append(files, SourceFile{Path: "foreign.ts", Kind: FileKindTypeScript, Text: testCase.support})
			}
			for _, module := range testCase.modules {
				name, text, _ := strings.Cut(module, "\x00")
				files = append(files, SourceFile{Path: name, Kind: FileKindSmithers, Text: text})
			}
			rootNames := make([]string, 0, len(files))
			for _, file := range files {
				rootNames = append(rootNames, file.Path)
			}
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: rootNames,
				Files:     files,
				Options:   Options{},
				Lowering:  LoweringInternal,
			})
			if err != nil {
				t.Fatal(err)
			}
			observed := formatDiagnosticPositions(t, files, result)
			if len(testCase.reject) == 0 {
				if len(observed) != 0 {
					t.Fatalf("the legitimate form must still compile, but was rejected with %v", observed)
				}
				if got := runEmittedMain(t, result); got != testCase.stdout {
					t.Fatalf("emitted program printed %q, want %q", got, testCase.stdout)
				}
				return
			}
			want := append([]string(nil), testCase.reject...)
			sort.Strings(want)
			if strings.Join(observed, " ") != strings.Join(want, " ") {
				t.Fatalf("diagnostics %v, want %v", observed, want)
			}
		})
	}
}

// formatDiagnosticPositions renders every error diagnostic as `CODE@line:column`
// against the authored text, sorted, so a test asserts the authored position and
// not an offset the implementation happened to produce.
func formatDiagnosticPositions(t *testing.T, files []SourceFile, result CompileResult) []string {
	t.Helper()
	byPath := make(map[string]string, len(files))
	for _, file := range files {
		byPath[file.Path] = file.Text
	}
	rendered := make([]string, 0, len(result.Diagnostics))
	for _, item := range result.Diagnostics {
		if item.Category != DiagnosticError {
			continue
		}
		text, known := byPath[item.File]
		if !known || item.Span == nil {
			rendered = append(rendered, fmt.Sprintf("%s@?", item.Code))
			continue
		}
		line, column := lineColumnOfOffset(text, item.Span.Start)
		rendered = append(rendered, fmt.Sprintf("%s@%d:%d", item.Code, line, column))
	}
	sort.Strings(rendered)
	return rendered
}

func lineColumnOfOffset(text string, offset int) (int, int) {
	line := 1
	column := 1
	consumed := 0
	for _, character := range text {
		if consumed >= offset {
			break
		}
		units := utf16RuneLen(character)
		if consumed+units > offset {
			break
		}
		consumed += units
		if character == '\n' {
			line++
			column = 1
		} else {
			column += units
		}
	}
	return line, column
}

// runEmittedMain executes the emitted artifacts and returns the newline-joined
// strings `main()` produced. A rule that "still accepts" the legitimate form is
// only interesting if the accepted program still runs and still prints what the
// author wrote.
func runEmittedMain(t *testing.T, result CompileResult) string {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is required to execute the emitted JavaScript")
	}
	directory := t.TempDir()
	for _, item := range result.Artifacts {
		path := filepath.Join(directory, filepath.FromSlash(item.Path))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, item.Content, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, "package.json"), []byte(`{"type":"module"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	harness := "import { main } from \"./main.js\";\n" +
		"const value = await main();\n" +
		"process.stdout.write(value.join(\"\\n\"));\n"
	if err := os.WriteFile(filepath.Join(directory, "harness.mjs"), []byte(harness), 0o644); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(node, "harness.mjs")
	command.Dir = directory
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("executing the emitted JavaScript failed: %v\n%s", err, output)
	}
	return string(output)
}

// ---------------------------------------------------------------------------
// Host globals — SMITHERS1601 / SMITHERS1602 / SMITHERS1603
// ---------------------------------------------------------------------------

// TestPinnedForkHostGlobalsNeedCapabilities pins the locked rule from
// specification/compatibility.mdx, "Host Globals": platform-specific globals
// are unavailable outright, and clock/random access needs a capability even
// through an object that is otherwise universal.
//
// The accepted rows are the whole point of the rule being per-operation: a
// frontend that banned `Math` would look correct on the rejection rows and be
// unusable.
func TestPinnedForkHostGlobalsNeedCapabilities(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "wall clock needs Clock",
			//                1234567890123456
			source: "export function main(): string[] {\n" +
				"  const stamp = Date.now()\n" +
				"  return [`${stamp}`]\n" +
				"}\n",
			reject: []string{"SMITHERS1602@2:17"},
		},
		{
			name: "randomness needs Random",
			source: "export function main(): string[] {\n" +
				"  const roll = Math.random()\n" +
				"  return [`${roll}`]\n" +
				"}\n",
			reject: []string{"SMITHERS1603@2:16"},
		},
		{
			name: "a bare Date construction reads the clock",
			source: "export function main(): string[] {\n" +
				"  const now = new Date()\n" +
				"  return [`${now.getTime()}`]\n" +
				"}\n",
			reject: []string{"SMITHERS1602@2:19"},
		},
		{
			name: "the whole object escaping is charged to the object",
			source: "function take(value: unknown): string {\n" +
				"  return typeof value\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  return [take(Math)]\n" +
				"}\n",
			reject: []string{"SMITHERS1603@5:16"},
		},
		{
			name: "a destructured host-sensitive member is charged",
			source: "export function main(): string[] {\n" +
				"  const { random } = Math\n" +
				"  return [`${typeof random}`]\n" +
				"}\n",
			reject: []string{"SMITHERS1603@2:22"},
		},
		{
			name: "platform globals are unavailable outright",
			source: "export function main(): string[] {\n" +
				"  const platform = process.platform\n" +
				"  const title = document.title\n" +
				"  return [platform, title]\n" +
				"}\n",
			reject: []string{"SMITHERS1601@2:20", "SMITHERS1601@3:17"},
		},
		{
			name: "universal facilities stay available",
			source: "export function main(): string[] {\n" +
				"  const largest = Math.max(2, 7, 5)\n" +
				"  const encoded = JSON.stringify({ name: \"Ada\" })\n" +
				"  const parsed = Number.parseInt(\"41\", 10)\n" +
				"  return [`${largest}`, encoded, `${parsed}`]\n" +
				"}\n",
			stdout: "7\n{\"name\":\"Ada\"}\n41",
		},
		{
			name: "Date.parse and Date.UTC are pure functions of their arguments",
			source: "export function main(): string[] {\n" +
				"  const parsed = Date.parse(\"1970-01-01T00:00:00.000Z\")\n" +
				"  const utc = Date.UTC(1970, 0, 1)\n" +
				"  return [`${parsed}`, `${utc}`]\n" +
				"}\n",
			stdout: "0\n0",
		},
		{
			name: "a Date built from an authored instant reads no clock",
			source: "export function main(): string[] {\n" +
				"  const fixed = new Date(0)\n" +
				"  return [fixed.toISOString()]\n" +
				"}\n",
			stdout: "1970-01-01T00:00:00.000Z",
		},
	})
}

// TestPinnedForkDeterminismHostileGlobalsAreRefused pins
// specification/compatibility.mdx §Determinism-Sensitive Members rows one and
// two on this backend: `WeakRef`/`FinalizationRegistry` and
// `SharedArrayBuffer`/`Atomics` "MUST NOT be unconditional globals".
//
// Until 2026-08-28 all four were LISTED in universalGlobals on both backends, so
// the allowlist asserted the opposite of the obligation rather than merely
// failing to meet it. Each compiled with zero diagnostics and an empty
// requirement row, in the same file where the `Date.now()` control reported
// SMITHERS1602.
//
// SMITHERS1605 rather than SMITHERS1601 because 1601's message ends "access it
// through a Context capability" and these rows say the opposite in as many
// words. The accepted rows below are the load-bearing half, exactly as in
// TestPinnedForkHostGlobalsNeedCapabilities: the rule is about four names, not
// about weak collections or binary data, and a frontend that banned `WeakMap` or
// `ArrayBuffer` would look correct on the rejection rows and be unusable.
func TestPinnedForkDeterminismHostileGlobalsAreRefused(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "a WeakRef read is garbage-collection timing",
			source: "export function main(): string[] {\n" +
				"  const held = { a: 1 }\n" +
				"  const ref = new WeakRef(held)\n" +
				"  return [`${ref.deref() !== undefined}`]\n" +
				"}\n",
			reject: []string{"SMITHERS1605@3:19"},
		},
		{
			name: "a FinalizationRegistry observes collection",
			source: "export function main(): string[] {\n" +
				"  const registry = new FinalizationRegistry(() => {})\n" +
				"  return [`${typeof registry}`]\n" +
				"}\n",
			reject: []string{"SMITHERS1605@2:24"},
		},
		{
			name: "SharedArrayBuffer is cross-agent shared memory",
			source: "export function main(): string[] {\n" +
				"  const shared = new SharedArrayBuffer(8)\n" +
				"  return [`${shared.byteLength}`]\n" +
				"}\n",
			reject: []string{"SMITHERS1605@2:22"},
		},
		{
			name: "an Atomics read observes another agent's schedule",
			source: "export function main(): string[] {\n" +
				"  const view = new Int32Array(8)\n" +
				"  return [`${Atomics.load(view, 0)}`]\n" +
				"}\n",
			reject: []string{"SMITHERS1605@3:14"},
		},
		{
			name: "the non-hostile siblings stay available",
			source: "export function main(): string[] {\n" +
				"  const seen = new WeakSet<object>()\n" +
				"  const keyed = new WeakMap<object, number>()\n" +
				"  const key = { a: 1 }\n" +
				"  seen.add(key)\n" +
				"  keyed.set(key, 7)\n" +
				"  const bytes = new Int32Array(new ArrayBuffer(8))\n" +
				"  return [`${seen.has(key)}`, `${keyed.get(key)}`, `${bytes.length}`]\n" +
				"}\n",
			stdout: "true\n7\n2",
		},
		{
			name: "a local binding named Atomics is an ordinary value",
			source: "export function main(): string[] {\n" +
				"  const Atomics = { load: (): number => 41 }\n" +
				"  return [`${Atomics.load()}`]\n" +
				"}\n",
			stdout: "41",
		},
	})
}

// TestPinnedForkHostGlobalAllowlist pins the inversion of the host-global rule
// from a spelling denylist to an allowlist over the ECMAScript-262 global
// object.
//
// The rule used to be eight forbidden names matched against a map, and
// everything else the ambient environment publishes was accepted. Measured,
// 22 of 38 sibling globals compiled clean and ran: `self`/`top`/`parent`/
// `frames` alias the global object in every DOM and worker host and bypassed
// all eight at once; `XMLHttpRequest`/`WebSocket`/`EventSource`/`Worker` are
// the network and thread authority specification/compatibility.mdx names in
// the same sentence as `process`; `navigator`/`location`/`localStorage`/
// `sessionStorage` are host identity and host-persistent state; and the Node
// global scope was reachable even though the compiler emits ESM, where
// `__dirname`, `__filename`, `module`, and `exports` do not exist at all.
//
// The accepting rows are the load-bearing half. An allowlist that is too narrow
// takes the whole standard library with it, so the ECMAScript global object is
// exercised here too and the emitted program is required to still run.
func TestPinnedForkHostGlobalAllowlist(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "globalThis aliases are refused",
			source: "export function main(): string[] {\n" +
				"  const alias = self\n" +
				"  const frame = top\n" +
				"  const outer = parent\n" +
				"  const list = frames\n" +
				"  return [`${typeof alias}`, `${typeof frame}`, `${typeof outer}`, `${typeof list}`]\n" +
				"}\n",
			reject: []string{"SMITHERS1601@2:17", "SMITHERS1601@3:17", "SMITHERS1601@4:17", "SMITHERS1601@5:16"},
		},
		{
			name: "network and thread globals are refused",
			source: "export function main(): string[] {\n" +
				"  const request = XMLHttpRequest\n" +
				"  const socket = WebSocket\n" +
				"  const events = EventSource\n" +
				"  const thread = Worker\n" +
				"  return [`${typeof request}`, `${typeof socket}`, `${typeof events}`, `${typeof thread}`]\n" +
				"}\n",
			reject: []string{"SMITHERS1601@2:19", "SMITHERS1601@3:18", "SMITHERS1601@4:18", "SMITHERS1601@5:18"},
		},
		{
			name: "host identity and host-persistent state are refused",
			source: "export function main(): string[] {\n" +
				"  const agent = navigator\n" +
				"  const here = location\n" +
				"  const durable = localStorage\n" +
				"  const session = sessionStorage\n" +
				"  return [`${typeof agent}`, `${typeof here}`, `${typeof durable}`, `${typeof session}`]\n" +
				"}\n",
			reject: []string{"SMITHERS1601@2:17", "SMITHERS1601@3:16", "SMITHERS1601@4:19", "SMITHERS1601@5:19"},
		},
		{
			name: "the Node global scope and the CommonJS module wrapper are refused",
			source: "export function main(): string[] {\n" +
				"  const bytes = Buffer\n" +
				"  const root = global\n" +
				"  const load = require\n" +
				"  const wrapper = module\n" +
				"  const published = exports\n" +
				"  const directory = __dirname\n" +
				"  const file = __filename\n" +
				"  const soon = setImmediate\n" +
				"  return [`${typeof bytes}`, `${typeof root}`, `${typeof load}`, `${typeof wrapper}`,\n" +
				"    `${typeof published}`, `${typeof directory}`, `${typeof file}`, `${typeof soon}`]\n" +
				"}\n",
			reject: []string{
				"SMITHERS1601@2:17", "SMITHERS1601@3:16", "SMITHERS1601@4:16", "SMITHERS1601@5:19",
				"SMITHERS1601@6:21", "SMITHERS1601@7:21", "SMITHERS1601@8:16", "SMITHERS1601@9:16",
			},
		},
		{
			name: "scheduling and structured clone are refused",
			source: "export function main(): string[] {\n" +
				"  const soon = queueMicrotask\n" +
				"  const cancel = clearTimeout\n" +
				"  const stop = clearInterval\n" +
				"  const copy = structuredClone\n" +
				"  return [`${typeof soon}`, `${typeof cancel}`, `${typeof stop}`, `${typeof copy}`]\n" +
				"}\n",
			reject: []string{"SMITHERS1601@2:16", "SMITHERS1601@3:18", "SMITHERS1601@4:16", "SMITHERS1601@5:16"},
		},
		{
			// The `new Date(instant)` exemption is about the RUNTIME arity, and
			// argument NODES are not it: `new Date(...[])` is one syntactic
			// argument and zero actual ones, so it reads the clock.
			name: "a spread argument does not prove new Date received an instant",
			source: "export function main(): string[] {\n" +
				"  const instant: readonly number[] = []\n" +
				"  return [`${new Date(...(instant as [number])).getTime()}`]\n" +
				"}\n",
			reject: []string{"SMITHERS1602@3:18"},
		},
		{
			// `new Intl.DateTimeFormat("en").format()` formats *now*, through a
			// global the rule did not model at all. Charging the constructor
			// fails closed: which call reads the clock depends on the arity of a
			// call on an instance, and `resolvedOptions().timeZone` reads the
			// host zone with no call at all.
			name: "constructing Intl.DateTimeFormat is a clock read",
			source: "export function main(): string[] {\n" +
				"  return [new Intl.DateTimeFormat(\"en-US\").format()]\n" +
				"}\n",
			reject: []string{"SMITHERS1602@2:15"},
		},
		{
			// Widened 2026-08-28 with the specification row it mirrors.
			// compatibility.mdx §Determinism-Sensitive Members row five used to
			// name four ICU members and the hazard covers thirty; the list was
			// incomplete, not narrow. All thirty are free on both backends
			// today, so what this guards is OVER-refusal: the cheapest wrong
			// implementation of row four or five charges the `Intl` ROOT, which
			// passes the DateTimeFormat case above perfectly and takes the whole
			// ICU surface with it. The fork's member table is the same one-name
			// table the frontend has, and this is the assertion that says so.
			// The corpus case 20-host-globals/intl-locale-formatting-is-not-a-clock-read
			// carries the full breadth; keep the two from drifting.
			name: "the rest of Intl needs no capability",
			source: "export function main(): string[] {\n" +
				"  return [...Intl.getCanonicalLocales(\"EN-us\"), new Intl.NumberFormat(\"en-US\").format(1),\n" +
				"    new Intl.PluralRules(\"en\").select(1), new Intl.Locale(\"en-US\").baseName,\n" +
				"    `${new Intl.Collator(\"en\").compare(\"a\", \"a\")}`, \"a\".toLocaleUpperCase(\"en\"),\n" +
				"    (1).toLocaleString(\"en-US\")]\n" +
				"}\n",
			stdout: "en-US\n1\none\nen-US\n0\nA\n1",
		},
		{
			name: "the ECMAScript global object stays available",
			source: "export function main(): string[] {\n" +
				"  const values = new Map<string, number>([[\"ada\", 1]])\n" +
				"  const unique = new Set<number>([1, 1, 2])\n" +
				"  const bytes = new Uint8Array([1, 2, 3])\n" +
				"  return [`${Object.keys({ a: 1 }).length}`, `${Array.of(1, 2).length}`,\n" +
				"    `${values.get(\"ada\")}`, `${unique.size}`, `${bytes.length}`,\n" +
				"    `${Number.parseFloat(\"1.5\")}`, `${Reflect.has({ a: 1 }, \"a\")}`,\n" +
				"    `${parseInt(\"41\", 10)}`, `${JSON.stringify({ n: 1 })}`, `${Symbol.iterator.toString()}`]\n" +
				"}\n",
			stdout: "1\n2\n1\n2\n3\n1.5\ntrue\n41\n{\"n\":1}\nSymbol(Symbol.iterator)",
		},
		{
			name: "a local binding of a refused name is an ordinary value",
			source: "export function main(): string[] {\n" +
				"  const self = { id: 1 }\n" +
				"  const navigator = \"n\"\n" +
				"  return [`${self.id}`, navigator]\n" +
				"}\n",
			stdout: "1\nn",
		},
	})
}

// TestPinnedForkHostGlobalRuleResolvesBySymbolNotSpelling is the identity
// evidence for the two loudest rules. A binding is the host global only when
// the checker resolves it to the ambient lib (or to nothing at all); a lexical
// shadow is an ordinary value and must keep working, including when it is
// spelled exactly `Date` or `Math`.
//
// Without this test the rule could be implemented by matching the identifier
// text and would look correct on every rejection case above.
func TestPinnedForkHostGlobalRuleResolvesBySymbolNotSpelling(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "a local const named Date is an ordinary value",
			source: "export function main(): string[] {\n" +
				"  const Date = { now: () => 41 }\n" +
				"  const Math = { random: () => 7 }\n" +
				"  return [`${Date.now()}`, `${Math.random()}`]\n" +
				"}\n",
			stdout: "41\n7",
		},
		{
			name: "a parameter named Date shadows the global for the whole body",
			source: "function report(Date: { now: () => number }): string {\n" +
				"  return `${Date.now()}`\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  return [report({ now: () => 5 })]\n" +
				"}\n",
			stdout: "5",
		},
		{
			name: "an imported binding named Math is not the host global",
			source: "import { Math } from \"./clock.sm\"\n" +
				"export function main(): string[] {\n" +
				"  return [`${Math.random()}`]\n" +
				"}\n",
			modules: []string{"clock.sm\x00export const Math = { random: () => 3 }\n"},
			stdout:  "3",
		},
		{
			name: "a property named random on an authored object is not the global",
			source: "export function main(): string[] {\n" +
				"  const source = { random: () => 9, Date: 1 }\n" +
				"  return [`${source.random()}`, `${source.Date}`]\n" +
				"}\n",
			stdout: "9\n1",
		},
		{
			name: "the shadow does not leak: the global is still charged outside it",
			source: "function shadowed(): string {\n" +
				"  const Math = { random: () => 2 }\n" +
				"  return `${Math.random()}`\n" +
				"}\n" +
				"export function main(): string[] {\n" +
				"  return [shadowed(), `${Math.random()}`]\n" +
				"}\n",
			reject: []string{"SMITHERS1603@6:26"},
		},
	})
}

// ---------------------------------------------------------------------------
// Class `static {}` blocks — SMITHERS1107
// ---------------------------------------------------------------------------

func TestPinnedForkClassStaticBlockIsRejected(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "a static initialization block escapes every checked channel",
			source: "export class Registry {\n" +
				"  static entries: string[] = []\n" +
				"  static {\n" +
				"    Registry.entries.push(\"ada\")\n" +
				"  }\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return Registry.entries\n" +
				"}\n",
			reject: []string{"SMITHERS1107@3:3"},
		},
		{
			name: "static field initializers are still accepted",
			source: "export class Registry {\n" +
				"  static entries: string[] = [\"ada\"]\n" +
				"  static readonly size: number = 1\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [...Registry.entries, `${Registry.size}`]\n" +
				"}\n",
			stdout: "ada\n1",
		},
	})
}

// ---------------------------------------------------------------------------
// Duplicate Error class names — SMITHERS1150
// ---------------------------------------------------------------------------

func TestPinnedForkDuplicateErrorClassNameIsRejected(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "two Error classes with one name in one module",
			source: "function outer(): Error {\n" +
				"  class Missing extends Error {\n" +
				"    constructor() { super(\"outer\") }\n" +
				"  }\n" +
				"  return new Missing()\n" +
				"}\n" +
				"\n" +
				"function inner(): Error {\n" +
				"  class Missing extends Error {\n" +
				"    constructor() { super(\"inner\") }\n" +
				"  }\n" +
				"  return new Missing()\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [outer().message, inner().message]\n" +
				"}\n",
			reject: []string{"SMITHERS1150@9:9"},
		},
		{
			name: "the same name in two modules keeps its module-qualified row",
			source: "import { Missing as DirectoryMissing } from \"./directory.sm\"\n" +
				"\n" +
				"export class Missing extends Error {\n" +
				"  constructor() { super(\"local\") }\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const other: Error = new DirectoryMissing()\n" +
				"  return [new Missing().message, other.message]\n" +
				"}\n",
			modules: []string{"directory.sm\x00export class Missing extends Error {\n  constructor() { super(\"directory\") }\n}\n"},
			stdout:  "local\ndirectory",
		},
		{
			name: "two same-named plain classes are not Error rows",
			source: "function outer(): string {\n" +
				"  class Holder { readonly label = \"outer\" }\n" +
				"  return new Holder().label\n" +
				"}\n" +
				"\n" +
				"function inner(): string {\n" +
				"  class Holder { readonly label = \"inner\" }\n" +
				"  return new Holder().label\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [outer(), inner()]\n" +
				"}\n",
			stdout: "outer\ninner",
		},
	})
}

// ---------------------------------------------------------------------------
// Foreign boundaries — SMITHERS1504 / SMITHERS1509
// ---------------------------------------------------------------------------

// failClosedForeign is a trusted foreign module carrying the module-level
// initialization claim, so every diagnostic below is about the boundary under
// test rather than about module trust.
const failClosedForeign = `/**
 * @module
 * @throws {never}
 */

/** @throws {never} */
export function double(value: number): number {
  return value * 2;
}

/** A foreign class with no ` + "`@throws {never}`" + ` on its constructor. */
export class Counter {
  constructor(readonly start: number) {}
  next(): number {
    return this.start + 1;
  }
}

/** A foreign class whose constructor is trusted. */
export class Safe {
  /** @throws {never} */
  constructor(readonly start: number) {}
  /** @throws {never} */
  value(): number {
    return this.start;
  }
}

/** A higher-order foreign function: it invokes a callback the caller supplies. */
export function applyTwice(value: number, step: (input: number) => number): number {
  return step(step(value));
}
`

func TestPinnedForkForeignConstructorNeedsThrowsNever(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "an untrusted foreign constructor is rejected",
			support: failClosedForeign,
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"import { Counter } from \"./foreign.ts\"\n" +
				"\n" +
				"function start(): Result<number, Panic> {\n" +
				"  const counter = new Counter(41)\n" +
				"  return counter.next()\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [start().match({ ok: (value) => `${value}`, error: () => \"panic\" })]\n" +
				"}\n",
			reject: []string{"SMITHERS1504@5:19"},
		},
		{
			name:    "a checker-resolved @throws never constructor is accepted",
			support: failClosedForeign,
			source: "import { Safe } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const safe = new Safe(41)\n" +
				"  return [`${safe.value()}`]\n" +
				"}\n",
			stdout: "41",
		},
		{
			name: "an authored class construction is not a foreign boundary",
			source: "class Counter {\n" +
				"  constructor(readonly start: number) {}\n" +
				"  next(): number { return this.start + 1 }\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [`${new Counter(41).next()}`]\n" +
				"}\n",
			stdout: "42",
		},
	})
}

func TestPinnedForkCallbackEscapingIntoForeignCodeIsRejected(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "an inline callback handed to foreign code is rejected",
			support: failClosedForeign,
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"import { applyTwice } from \"./foreign.ts\"\n" +
				"\n" +
				"function bump(value: number): Result<number, Panic> {\n" +
				"  return applyTwice(value, (input) => input + 1)\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [bump(21).match({ ok: (value) => `${value}`, error: () => \"panic\" })]\n" +
				"}\n",
			reject: []string{"SMITHERS1509@5:28"},
		},
		{
			name:    "a named callback reaches the same rule through its symbol",
			support: failClosedForeign,
			source: "import { Panic } from \"smithers:exceptions\"\n" +
				"import { applyTwice } from \"./foreign.ts\"\n" +
				"\n" +
				"const step = (input: number): number => input + 1\n" +
				"\n" +
				"function bump(value: number): Result<number, Panic> {\n" +
				"  return applyTwice(value, step)\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [bump(21).match({ ok: (value) => `${value}`, error: () => \"panic\" })]\n" +
				"}\n",
			reject: []string{"SMITHERS1509@7:28"},
		},
		{
			name:    "an ordinary data argument crosses the same boundary freely",
			support: failClosedForeign,
			source: "import { double } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [`${double(21)}`]\n" +
				"}\n",
			stdout: "42",
		},
		{
			name: "a callback passed to an authored higher-order function is fine",
			source: "function applyTwice(value: number, step: (input: number) => number): number {\n" +
				"  return step(step(value))\n" +
				"}\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [`${applyTwice(40, (input) => input + 1)}`]\n" +
				"}\n",
			stdout: "42",
		},
	})
}

// ---------------------------------------------------------------------------
// Async callback ownership — SMITHERS1404
// ---------------------------------------------------------------------------

func TestPinnedForkUnownedAsyncCallbackIsRejected(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "an async callback with no recognized owner",
			source: "function schedule(items: string[], run: (item: string) => void): void {\n" +
				"  for (const item of items) run(item)\n" +
				"}\n" +
				"\n" +
				"const seen: string[] = []\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  schedule([\"ada\"], async (item) => {\n" +
				"    await Promise.resolve()\n" +
				"    seen.push(item)\n" +
				"  })\n" +
				"  return seen\n" +
				"}\n",
			reject: []string{"SMITHERS1404@8:21"},
		},
		{
			name: "a synchronous callback starts no Promise and is accepted",
			source: "function schedule(items: string[], run: (item: string) => void): void {\n" +
				"  for (const item of items) run(item)\n" +
				"}\n" +
				"\n" +
				"const seen: string[] = []\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  schedule([\"ada\"], (item) => {\n" +
				"    seen.push(item)\n" +
				"  })\n" +
				"  return seen\n" +
				"}\n",
			stdout: "ada",
		},
		{
			name: "an awaited async function call is owned by its await",
			source: "async function load(key: string): Promise<string> {\n" +
				"  return key === \"ada\" ? \"Ada Lovelace\" : \"none\"\n" +
				"}\n" +
				"\n" +
				"export async function main(): Promise<string[]> {\n" +
				"  return [await load(\"ada\")]\n" +
				"}\n",
			stdout: "Ada Lovelace",
		},
	})
}

func TestPinnedForkTypeOnlyImportAddsNoRuntimeRequirement(t *testing.T) {
	const untrusted = `// No leading @module / @throws {never} initialization trust claim.

export function shout(text: string): string {
  return ` + "`${text.toUpperCase()}!`" + `;
}

export interface Settings {
  readonly retries: number;
}
`
	runFailClosedCases(t, []failClosedCase{
		{
			name:    "a type-only import of an untrusted module is accepted",
			support: untrusted,
			source: "import type { Settings } from \"./foreign.ts\"\n" +
				"\n" +
				"const local: Settings = { retries: 3 }\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [`retries ${local.retries}`]\n" +
				"}\n",
			stdout: "retries 3",
		},
		{
			name:    "every named binding marked type-only is also type-only",
			support: untrusted,
			source: "import { type Settings } from \"./foreign.ts\"\n" +
				"\n" +
				"const local: Settings = { retries: 4 }\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [`retries ${local.retries}`]\n" +
				"}\n",
			stdout: "retries 4",
		},
		{
			// Two independent defects, not one and a cascade. The module edge has no
			// trust claim (SMITHERS1510), AND the unannotated foreign call lifts to
			// `Result<string, Panic>` which this `string[]` return drops
			// (SMITHERS1301) — specification/type-system.mdx:60 and :56, neither of
			// which is conditioned on the trust of the edge the call arrived
			// through. 09-foreign-calls/the-never-annotation-is-case-sensitive is
			// the control: the same call shape over a module with a genuine trust
			// header is charged SMITHERS1301 at the same position on both backends.
			name:    "a value import of the same module still needs the trust claim",
			support: untrusted,
			source: "import { shout } from \"./foreign.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [shout(\"ada\")]\n" +
				"}\n",
			reject: []string{"SMITHERS1510@1:23", "SMITHERS1301@4:11"},
		},
	})
}
