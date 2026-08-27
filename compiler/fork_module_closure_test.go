package compiler

import (
	"sort"
	"strings"
	"testing"
)

// The reached-module closure for SMITHERS1510.
//
// `checkForeignModuleTrust` used to iterate the authored `.sm`'s own statements
// and stop, so a foreign module reached at DEPTH >= 2 was never asked for the
// module-initialization trust marker. Measured on this backend with a runtime
// oracle: a properly marked `relay.ts` doing `export { config } from "./sneaky.ts"`,
// where `sneaky.ts` carries no marker at all, compiled clean and RAN the
// untrusted initializer at depth 2, at depth 3, through a cycle, through a
// diamond, and through every static and dynamic edge spelling. That is not "the
// rule stayed silent"; it is the hazard the rule exists to prevent, happening.
//
// A rule about module INITIALIZATION cannot stop at depth one, because module
// evaluation does not. The closure is the RELATIVE runtime graph — seeded only
// by relative edges, for the reason `rememberTrustRoot` records — and the edges
// it follows are decided by the deferral proof mirrored from
// `poc/src/language/semantic.ts` and `src/relative-runtime-graph.ts`.
//
// Both directions are pinned here. A refusal that is too broad is its own
// defect: an over-correction would silently drop a trusted deep module or an
// erased type-only edge, and a diagnostics-only assertion cannot tell "trusted"
// from "silently dropped". So every accepting case in this file EXECUTES the
// emitted program and asserts on what its module scopes announced.

// closureCase is one authored `.sm` program plus the foreign modules it reaches.
// `reject` lists every diagnostic the program must produce as `CODE@line:column`;
// an empty list means the program must compile and RUN, and `stdout` is then the
// exact combined output — module-scope announcements included, in evaluation
// order.
type closureCase struct {
	name    string
	source  string
	support []closureSupport
	reject  []string
	stdout  string
}

type closureSupport struct {
	path string
	text string
}

func runClosureCases(t *testing.T, cases []closureCase) {
	t.Helper()
	backend, ctx := newPinnedTestBackend(t)
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: testCase.source}}
			for _, module := range testCase.support {
				files = append(files, SourceFile{Path: module.path, Kind: FileKindTypeScript, Text: module.text})
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

const closureTrustMarker = "/** @module @throws {never} */\n"

// closureOracle is a module-scope announcement. Its presence in the emitted
// program's output is the evidence that the module's INITIALIZER ran; its
// absence is the evidence that the module was never loaded. Neither can be read
// off a diagnostic.
const closureOracle = "globalThis.console.log(\"[reached] sneaky.ts initializer RAN\");\n"

const closureTargetBody = closureOracle +
	"export interface Config { readonly retries: number }\n" +
	"export const config: Config = { retries: 3 };\n"

// closureMain imports the relay and prints the shape of what it re-exported, so
// an accepted program has to have actually evaluated the chain.
const closureMain = "import { config } from \"./relay.ts\"\n" +
	"\n" +
	"export function main(): string[] {\n" +
	"  return [typeof config]\n" +
	"}\n"

// TestPinnedForkModuleTrustDoesNotStopAtDepthOne is the reproduction, at every
// depth and through every graph shape that used to reach an unmarked module.
//
// The authored position is the same `1:24` the depth-one rule already reports —
// the `.sm` import specifier, the only text in the authored file its author can
// change — so a reader of the diagnostic is pointed at the edge they wrote and
// not at a file they may not own.
func TestPinnedForkModuleTrustDoesNotStopAtDepthOne(t *testing.T) {
	unmarked := closureSupport{path: "sneaky.ts", text: closureTargetBody}
	runClosureCases(t, []closureCase{
		{
			name:   "depth two: a marked relay does not lend its claim to what it loads",
			source: closureMain,
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker + "export { config } from \"./sneaky.ts\";\n"},
				unmarked,
			},
			reject: []string{"SMITHERS1510@1:24"},
		},
		{
			name:   "depth three: depth is not a bound on module evaluation",
			source: closureMain,
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker + "export { config } from \"./middle.ts\";\n"},
				{path: "middle.ts", text: closureTrustMarker + "export { config } from \"./sneaky.ts\";\n"},
				unmarked,
			},
			reject: []string{"SMITHERS1510@1:24"},
		},
		{
			name:   "a cycle between two marked relays terminates the walk",
			source: closureMain,
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker +
					"import { ping } from \"./middle.ts\";\n" +
					"export { config } from \"./sneaky.ts\";\n" +
					"export function pong(): number { return ping(); }\n"},
				{path: "middle.ts", text: closureTrustMarker +
					"import { pong } from \"./relay.ts\";\n" +
					"export function ping(): number { return 1; }\n" +
					"export function echo(): number { return pong(); }\n"},
				unmarked,
			},
			reject: []string{"SMITHERS1510@1:24"},
		},
		{
			name: "a diamond reports the shared unmarked module once, not once per path",
			source: "import { config } from \"./relay.ts\"\n" +
				"import { other } from \"./relay2.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [typeof config, typeof other]\n" +
				"}\n",
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker + "export { config } from \"./sneaky.ts\";\n"},
				{path: "relay2.ts", text: closureTrustMarker + "export { config as other } from \"./sneaky.ts\";\n"},
				unmarked,
			},
			reject: []string{"SMITHERS1510@1:24"},
		},
		{
			name:   "two distinct unmarked modules behind one relay are both named",
			source: closureMain,
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker +
					"export { config } from \"./sneaky.ts\";\n" +
					"import \"./sneaky2.ts\";\n"},
				unmarked,
				{path: "sneaky2.ts", text: "globalThis.console.log(\"second\");\nexport const other = 1;\n"},
			},
			reject: []string{"SMITHERS1510@1:24", "SMITHERS1510@1:24"},
		},
		{
			name: "an untrusted module at depth one is refused at the edge the author wrote, and the marked path is refused separately",
			source: "import { config } from \"./relay.ts\"\n" +
				"import { config as direct } from \"./sneaky.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [typeof config, typeof direct]\n" +
				"}\n",
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker + "export { config } from \"./sneaky.ts\";\n"},
				unmarked,
			},
			reject: []string{"SMITHERS1510@1:24", "SMITHERS1510@2:34"},
		},
		{
			name: "the dynamic spelling of the authored edge seeds the same closure",
			source: "export async function main(): Promise<string[]> {\n" +
				"  const loaded = await import(\"./relay.ts\")\n" +
				"  return [typeof loaded.config]\n" +
				"}\n",
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker + "export { config } from \"./sneaky.ts\";\n"},
				unmarked,
			},
			reject: []string{"SMITHERS1510@2:31"},
		},
	})
}

// TestPinnedForkModuleTrustClosureKeepsTrustedChainsRunning is the other half,
// and it is the half an over-correction breaks. Ten over-corrections have
// shipped in this repository; every accepting case here EXECUTES, because a
// diagnostics assertion cannot distinguish "the deep module was trusted" from
// "the deep module was silently dropped".
func TestPinnedForkModuleTrustClosureKeepsTrustedChainsRunning(t *testing.T) {
	marked := closureSupport{path: "sneaky.ts", text: closureTrustMarker + closureTargetBody}
	runClosureCases(t, []closureCase{
		{
			name:   "a marked chain confers trust at depth two, and the deep initializer runs",
			source: closureMain,
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker + "export { config } from \"./sneaky.ts\";\n"},
				marked,
			},
			stdout: "[reached] sneaky.ts initializer RAN\nobject",
		},
		{
			name:   "a marked chain confers trust at depth three as well",
			source: closureMain,
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker + "export { config } from \"./middle.ts\";\n"},
				{path: "middle.ts", text: closureTrustMarker + "export { config } from \"./sneaky.ts\";\n"},
				marked,
			},
			stdout: "[reached] sneaky.ts initializer RAN\nobject",
		},
		{
			name:   "a cycle of marked relays still compiles and still runs",
			source: closureMain,
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker +
					"import { ping } from \"./middle.ts\";\n" +
					"export { config } from \"./sneaky.ts\";\n" +
					"export function pong(): number { return ping(); }\n"},
				{path: "middle.ts", text: closureTrustMarker +
					"import { pong } from \"./relay.ts\";\n" +
					"export function ping(): number { return 1; }\n" +
					"export function echo(): number { return pong(); }\n"},
				marked,
			},
			stdout: "[reached] sneaky.ts initializer RAN\nobject",
		},
		{
			// The erased spellings add no runtime requirement at all. The oracle
			// line is ABSENT from the output, which is how this case separates
			// "erased" from "loaded but unreported".
			name:   "a type-only edge behind a marked relay needs no marker, and loads nothing",
			source: closureMain,
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker +
					"import type { Config } from \"./sneaky.ts\";\n" +
					"export const config: Config = { retries: 3 };\n"},
				{path: "sneaky.ts", text: closureTargetBody},
			},
			stdout: "object",
		},
		{
			name:   "the `import { type T }` spelling is erased for the same reason",
			source: closureMain,
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker +
					"import { type Config } from \"./sneaky.ts\";\n" +
					"export const config: Config = { retries: 3 };\n"},
				{path: "sneaky.ts", text: closureTargetBody},
			},
			stdout: "object",
		},
		{
			name:   "`export type { T } from` is erased for the same reason",
			source: closureMain,
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker +
					"export type { Config } from \"./sneaky.ts\";\n" +
					"export const config = { retries: 3 };\n"},
				{path: "sneaky.ts", text: closureTargetBody},
			},
			stdout: "object",
		},
		{
			// The brief's named keep-green. `load` is exported, is the whole
			// declaration, and is never mentioned by module-scope code, so its body
			// is provably deferred and the unmarked module it names is never loaded
			// — which is precisely why it needs no marker. The absent oracle line is
			// the proof that it was not loaded.
			name: "`export function load(){ return require(...) }` stays accepted and loads nothing",
			source: "import { config } from \"./relay.cts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [typeof config]\n" +
				"}\n",
			support: []closureSupport{
				{path: "relay.cts", text: closureTrustMarker +
					"declare const require: (id: string) => { config: { retries: number } };\n" +
					"export function load() { return require(\"./sneaky.cts\"); }\n" +
					"export const config = { retries: 3 };\n"},
				{path: "sneaky.cts", text: closureTargetBody},
			},
			stdout: "object",
		},
		{
			name:   "an exported async loader defers its `import()` for the same reason",
			source: closureMain,
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker +
					"export async function load() { return (await import(\"./sneaky.ts\")).config; }\n" +
					"export const config = { retries: 3 };\n"},
				{path: "sneaky.ts", text: closureTargetBody},
			},
			stdout: "object",
		},
		{
			name:   "an exported const arrow defers, and an `export { load }` clause is the same proof",
			source: closureMain,
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker +
					"async function load() { return (await import(\"./sneaky.ts\")).config; }\n" +
					"export { load };\n" +
					"export const config = { retries: 3 };\n"},
				{path: "sneaky.ts", text: closureTargetBody},
			},
			stdout: "object",
		},
		{
			name:   "a member of an exported class defers, because module scope cannot name it",
			source: "import { config } from \"./relay.cts\"\n\nexport function main(): string[] {\n  return [typeof config]\n}\n",
			support: []closureSupport{
				{path: "relay.cts", text: closureTrustMarker +
					"declare const require: (id: string) => { config: { retries: number } };\n" +
					"export class Loader { static go() { return require(\"./sneaky.cts\"); } }\n" +
					"export const config = { retries: 3 };\n"},
				{path: "sneaky.cts", text: closureTargetBody},
			},
			stdout: "object",
		},
		{
			// Only a function's body and its PARAMETER DEFAULTS are evaluated when
			// it is called; everything else written on the function is evaluated
			// where the function is written.
			name:   "a parameter default of a deferred function is deferred with it",
			source: "import { config } from \"./relay.cts\"\n\nexport function main(): string[] {\n  return [typeof config]\n}\n",
			support: []closureSupport{
				{path: "relay.cts", text: closureTrustMarker +
					"declare const require: (id: string) => { config: { retries: number } };\n" +
					"export function load(loaded = require(\"./sneaky.cts\")) { return loaded.config; }\n" +
					"export const config = { retries: 3 };\n"},
				{path: "sneaky.cts", text: closureTargetBody},
			},
			stdout: "object",
		},
		{
			name:   "a marked relay that reaches nothing else is unaffected",
			source: closureMain,
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker + "export const config = { retries: 3 };\n"},
			},
			stdout: "object",
		},
	})
}

// TestPinnedForkModuleTrustClosureAsksTheSameMarkerPredicate pins that the
// closure ASKS `trustedForeignModule` rather than carrying a second copy of the
// marker rule.
//
// `hasLeadingModuleNoThrowMarker` has had four implementations in this
// repository and one of them carried an `/i` flag the others deliberately
// refused — a HIGH fail-open. The depth-one column of each row below is the
// control: every spelling refused at depth one must be refused at depth two for
// the identical reason, because it is the identical call.
func TestPinnedForkModuleTrustClosureAsksTheSameMarkerPredicate(t *testing.T) {
	relay := closureSupport{path: "relay.ts", text: closureTrustMarker + "export { config } from \"./sneaky.ts\";\n"}
	nearMiss := func(name string, header string) closureCase {
		return closureCase{
			name:    name,
			source:  closureMain,
			support: []closureSupport{relay, {path: "sneaky.ts", text: header + closureTargetBody}},
			reject:  []string{"SMITHERS1510@1:24"},
		}
	}
	runClosureCases(t, []closureCase{
		nearMiss("a miscased @MODULE tag does not confer trust at depth two either",
			"/** @MODULE @throws {never} */\n"),
		nearMiss("a line comment containing the marker text confers nothing at depth two",
			"// /** @module @throws {never} */\n"),
		nearMiss("a plain block comment containing the marker text confers nothing at depth two",
			"/* @module @throws {never} */\n"),
		nearMiss("@moduleResolution is not @module at depth two",
			"/** @moduleResolution bundler @throws {never} */\n"),
		nearMiss("@throws {Never} is the declared-channel production at depth two",
			"/** @module @throws {Never} */\n"),
		nearMiss("a JSDoc decoration cannot assemble a split throws marker at depth two",
			"/**\n * @module\n * @throws\n * {never}\n */\n"),
		nearMiss("the two halves of the marker must live in ONE JSDoc block",
			"/** @module */\n/** @throws {never} */\n"),
		nearMiss("a marker that is not leading trivia is attached to nothing",
			"export const first = 1;\n/** @module @throws {never} */\n"),
		nearMiss("a non-breaking space inside the braces names a different type",
			"/** @module @throws { never } */\n"),
		nearMiss("a form feed inside the braces names a different type",
			"/** @module @throws {never} */\n"),
		nearMiss("@modulefoo is not @module",
			"/** @modulefoo @throws {never} */\n"),
		{
			name:   "the decorated multi-line spelling is still accepted at depth two",
			source: closureMain,
			support: []closureSupport{relay, {
				path: "sneaky.ts",
				text: "/**\n * @module\n * @throws {never}\n */\n" + closureTargetBody,
			}},
			stdout: "[reached] sneaky.ts initializer RAN\nobject",
		},
		{
			name:   "tabs and CRLF are JSDoc whitespace at depth two",
			source: closureMain,
			support: []closureSupport{relay, {
				path: "sneaky.ts",
				text: "/**\r\n *\t@module\r\n *\t@throws\t{never}\r\n */\n" + closureTargetBody,
			}},
			stdout: "[reached] sneaky.ts initializer RAN\nobject",
		},
	})
}

// TestPinnedForkModuleTrustClosureFailsClosedOnAnUnresolvableRequire records a
// DELIBERATE over-refusal, mirrored from the reference rather than approximated.
//
// TypeScript never resolves a plain `require("./x")` call in a `.cts` module to
// a module symbol under this program's options — the call is not collected as an
// external module reference at all — so the walk cannot read the sibling's
// marker even when the sibling HAS one. The choice is between refusing a marked
// module and admitting an unread one, and fail-closed is the direction this rule
// takes everywhere else, including the depth-one branch for an authored `.sm`'s
// own unresolvable edge.
//
// It is bounded: the remedy the diagnostic already names (a static
// `import`/`export … from`, which the checker does resolve) works, and this
// backend cannot execute the refused shape at all — before this change the
// program compiled and then died in `node:internal/modules/cjs/loader`. Removing
// the over-refusal needs a module-resolution host in this pass, which is a
// capability change and not a rule change.
func TestPinnedForkModuleTrustClosureFailsClosedOnAnUnresolvableRequire(t *testing.T) {
	main := "import { config } from \"./relay.cts\"\n\nexport function main(): string[] {\n  return [typeof config]\n}\n"
	moduleScopeRequire := closureTrustMarker +
		"declare const require: (id: string) => { config: { retries: number } };\n" +
		"const sneaky = require(\"./sneaky.cts\");\n" +
		"export const config = sneaky.config;\n"
	runClosureCases(t, []closureCase{
		{
			name:   "a module-scope require of an UNMARKED sibling is refused",
			source: main,
			support: []closureSupport{
				{path: "relay.cts", text: moduleScopeRequire},
				{path: "sneaky.cts", text: closureTargetBody},
			},
			reject: []string{"SMITHERS1510@1:24"},
		},
		{
			name:   "a module-scope require of a MARKED sibling is refused too, because the marker cannot be read",
			source: main,
			support: []closureSupport{
				{path: "relay.cts", text: moduleScopeRequire},
				{path: "sneaky.cts", text: closureTrustMarker + closureTargetBody},
			},
			reject: []string{"SMITHERS1510@1:24"},
		},
		{
			name:   "an IIFE hands the function value to module scope, so its require is an initialization edge",
			source: main,
			support: []closureSupport{
				{path: "relay.cts", text: closureTrustMarker +
					"declare const require: (id: string) => { config: { retries: number } };\n" +
					"const loaded = (() => require(\"./sneaky.cts\"))();\n" +
					"export const config = loaded.config;\n"},
				{path: "sneaky.cts", text: closureTrustMarker + closureTargetBody},
			},
			reject: []string{"SMITHERS1510@1:24"},
		},
		{
			name:   "a property of an exported object literal is not a proven deferral",
			source: main,
			support: []closureSupport{
				{path: "relay.cts", text: closureTrustMarker +
					"declare const require: (id: string) => { config: { retries: number } };\n" +
					"export const api = { load: () => require(\"./sneaky.cts\") };\n" +
					"export const config = { retries: 3 };\n"},
				{path: "sneaky.cts", text: closureTrustMarker + closureTargetBody},
			},
			reject: []string{"SMITHERS1510@1:24"},
		},
	})
}

// TestPinnedForkImportEqualsRequireIsARuntimeModuleEdge closes a second,
// independent gap the reference lane found: `staticRuntimeModuleEdge` handled
// only `ImportDeclaration` and `ExportDeclaration`, so
// `import x = require("./y")` — a third spelling of the same static module load,
// evaluated exactly when an `import … from` in the same slot would be — carried
// no trust boundary at all. Measured before the fix: an authored `.sm` naming an
// UNMARKED module that way produced no SMITHERS1510 from this rule, while the
// reference reported it at the specifier.
//
// The type-only spelling loads nothing and is excluded, exactly as
// `import type { T } from` is.
func TestPinnedForkImportEqualsRequireIsARuntimeModuleEdge(t *testing.T) {
	runClosureCases(t, []closureCase{
		{
			name: "an unmarked module named by `import x = require(...)` is refused at the specifier",
			source: "import sneaky = require(\"./sneaky.ts\")\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [typeof sneaky.config]\n" +
				"}\n",
			support: []closureSupport{{path: "sneaky.ts", text: closureTargetBody}},
			// SMITHERS1506 is the pre-existing foreign property-read rule reporting
			// on `sneaky.config`; it is unrelated to this gap and is asserted here
			// only so the case pins the whole observation rather than a subset.
			reject: []string{"SMITHERS1510@1:25", "SMITHERS1506@4:18"},
		},
		{
			name: "the type-only spelling loads nothing and needs no marker",
			source: "import type sneaky = require(\"./sneaky.ts\")\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  const local: sneaky.Config = { retries: 3 }\n" +
				"  return [typeof local]\n" +
				"}\n",
			support: []closureSupport{{path: "sneaky.ts", text: closureTargetBody}},
			stdout:  "object",
		},
		{
			name: "the same spelling inside a marked relay is walked, because it is evaluated on load",
			source: "import { config } from \"./relay.cts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [typeof config]\n" +
				"}\n",
			support: []closureSupport{
				{path: "relay.cts", text: closureTrustMarker +
					"import sneaky = require(\"./sneaky.cts\");\n" +
					"export const config = sneaky.config;\n"},
				{path: "sneaky.cts", text: closureTargetBody},
			},
			reject: []string{"SMITHERS1510@1:24"},
		},
	})
}

// TestPinnedForkModuleTrustClosureStopsAtTheGraphBoundary pins the three edges
// that END the walk. Each is a boundary the relative runtime graph already
// draws, and each is load-bearing in the other direction: widening any of them
// makes this compiler responsible for code it did not resolve, place or emit.
func TestPinnedForkModuleTrustClosureStopsAtTheGraphBoundary(t *testing.T) {
	runClosureCases(t, []closureCase{
		{
			// The depth-one rule is NOT relaxed by the narrower seed: a rooted
			// `/src/...` path is a path but not a relative one, and its target is
			// still asked for its own claim.
			name: "a rooted-path depth-one edge is still asked for its marker",
			source: "import { config } from \"/src/sneaky.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [typeof config]\n" +
				"}\n",
			support: []closureSupport{{path: "sneaky.ts", text: closureTargetBody}},
			reject:  []string{"SMITHERS1510@1:24"},
		},
		{
			// ...and it seeds NO closure, which is the half that keeps the
			// compiler's own runtime out of the rule. The reference lane measured
			// what a wider seed costs: seeding from every trusted depth-one target
			// turned `poc/src/language/capability-seams.test.ts` SEAM 3 red, because
			// `runtime/introspection.ts` carries the module claim while
			// `runtime/result.ts` and `runtime/panic.ts` deliberately carry none —
			// their unmarkedness is the forgery guarantee, and the seam is reached
			// by an ABSOLUTE path.
			//
			// This is a real discriminator on this backend, not a vacuous one.
			// SMITHERS1510 is an ANALYSIS diagnostic and an analysis error
			// short-circuits emit, so a widened seed makes this program report
			// SMITHERS1510@1:24 instead. Measured both ways: with the seed narrowed
			// to `.`-prefixed specifiers the analysis stays silent and the fork's own
			// emit-stage rooted-path check is what refuses; with the seed widened to
			// `isPathModuleSpecifier` (which also admits `/`) it reports
			// SMITHERS1510@1:24. The TS code below is therefore the assertion that
			// the closure did NOT fire.
			name: "a rooted-path depth-one edge seeds no closure",
			source: "import { config } from \"/src/relay.ts\"\n" +
				"\n" +
				"export function main(): string[] {\n" +
				"  return [typeof config]\n" +
				"}\n",
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker + "export { config } from \"./sneaky.ts\";\n"},
				{path: "sneaky.ts", text: closureTargetBody},
			},
			reject: []string{"TS2877@1:24"},
		},
		{
			// The compiler's own emitted prelude carries no claim and cannot be
			// given one — `specification/failures.mdx`, "Compiler Lifting" (Locked),
			// is why. Reaching it by a relative path from a marked relay is an
			// ordinary untrusted module edge.
			name:   "a relative path into the compiler's own prelude is refused from inside the closure",
			source: closureMain,
			support: []closureSupport{
				{path: "relay.ts", text: closureTrustMarker +
					"export { config } from \"./sneaky.ts\";\n" +
					"import \"./__smithers_prelude.ts\";\n"},
				{path: "sneaky.ts", text: closureTrustMarker + closureTargetBody},
			},
			reject: []string{"SMITHERS1510@1:24"},
		},
	})
}
