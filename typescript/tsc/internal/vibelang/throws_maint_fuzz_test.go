package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Exercise all three declarations that share an overloaded export. Reordering
// overloads or renaming their parameters must preserve the stage that throws.
func FuzzPinnedDualThrows(f *testing.F) {
	families := []struct{ module, name, bound string }{
		{"Number", "divideUnsafe", "RangeError"},
		{"Array", "getUnsafe", "Error"},
		{"DateTime", "setZoneNamedUnsafe", "IllegalArgumentError"},
		{"Option", "getOrThrowWith", "unknown"},
		{"http/Cookies", "setUnsafe", "CookiesError"},
		{"Future", "unlisted", ""},
	}
	for i := range families {
		f.Add(uint8(i), uint32(i), false)
		f.Add(uint8(i), uint32(i), true)
	}
	f.Fuzz(func(t *testing.T, family uint8, id uint32, reverse bool) {
		row := families[int(family)%len(families)]
		mod := "effect/dist/" + row.module
		direct := fmt.Sprintf("(self%d: number, arg%d: number): number", id, id)
		factory := fmt.Sprintf("(arg%d: number): (self%d: number) => number", id, id)
		overloads := direct + "; " + factory
		if reverse {
			overloads = factory + "; " + direct
		}
		src := "export declare const " + row.name + ": { " + overloads + " }"
		file := parseDeclarations("/probe.d.ts", src)
		if ds := file.Diagnostics(); len(ds) != 0 {
			t.Fatalf("%s: %s", src, ds[0].String())
		}
		base := mod + ":" + row.name + "()"
		count := 0
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if effectCallable(n) {
				count++
				key, bound := base, row.bound
				switch {
				case n.Kind == ast.KindFunctionType:
					key += "()"
				case len(n.Parameters()) == 1 && row.bound != "":
					key += ".factory"
					bound = "never"
				}
				got := effectTableKey(mod, n)
				if got != key {
					t.Fatalf("%s: key %q, want %q", src, got, key)
				}
				if spec, listed := effectThrowsOf(got); spec != bound || listed != (bound != "") {
					t.Fatalf("%s: %q lookup = (%q, %t), want %q (empty means unlisted)", src, got, spec, listed, bound)
				}
			}
			return n.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
		if count != 3 {
			t.Fatalf("%s: visited %d signatures, want 3", src, count)
		}
	})
}

// A data-last overload only captures arguments. Its direct overload and the
// captured function must agree, even when the thrown value is unknown.
func TestMaintPinnedDualRows(t *testing.T) {
	for key, factory := range effectThrowsTable() {
		direct, ok := strings.CutSuffix(key, ".factory")
		if !ok {
			continue
		}
		bound, hasDirect := effectThrowsOf(direct)
		returned, hasReturned := effectThrowsOf(direct + "()")
		if factory != "never" || !hasDirect || !hasReturned || bound == "never" || bound != returned {
			t.Errorf("%s: factory=%q direct=(%q, %t) returned=(%q, %t)", key, factory, bound, hasDirect, returned, hasReturned)
		}
	}
}

type maintExpectedError struct {
	code  int32
	bound string
}

// Each generated line owns at most one error. Counting by source line keeps
// a missing error on an application from cancelling a false one on a factory.
func maintCheckErrors(t *testing.T, source string, want map[int]maintExpectedError, all []*ast.Diagnostic) {
	t.Helper()
	for _, d := range all {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		line := 1 + strings.Count(source[:d.Pos()], "\n")
		expected, ok := want[line]
		if !ok || d.Source() != diagnosticSource || d.Code() != expected.code || (expected.bound != "" && !strings.Contains(d.MessageText(), "'"+expected.bound+"'")) {
			t.Errorf("line %d: %s (expected %+v)\n%s", line, d.String(), expected, strings.Split(source, "\n")[line-1])
		}
		delete(want, line)
	}
	for line, expected := range want {
		t.Errorf("line %d: missing EK%04d (%s) in %s", line, expected.code, expected.bound, strings.Split(source, "\n")[line-1])
	}
}

type maintCall struct{ expr, bound string }

func maintBuiltinCalls() []maintCall {
	calls := []maintCall{
		{"JSON.stringify(s)", "TypeError"}, {"s.repeat(2)", "RangeError"}, {"n.toFixed(2)", "RangeError"},
		{"encodeURI(s)", "URIError"}, {"encodeURIComponent(s)", "URIError"},
		{"Uint8Array.fromBase64(s)", "SyntaxError"}, {"Uint8Array.fromHex(s)", "SyntaxError"},
		{"buf.setFromBase64(s)", "SyntaxError"}, {"buf.setFromHex(s)", "SyntaxError"},
		{"new Date(s).toISOString()", ""}, {"new Intl.DateTimeFormat(s)", ""},
	}
	for _, ctor := range []string{"Duration", "Instant", "PlainDate", "PlainDateTime", "PlainMonthDay", "PlainTime", "PlainYearMonth", "ZonedDateTime"} {
		calls = append(calls, maintCall{"Temporal." + ctor + ".from(s)", "RangeError"})
	}
	return calls
}

// Cross each call with the plain, effect, caught and bridged contexts. Include
// nonthrowing controls in the same program so a blanket trust change fails
// whether it admits too many calls or rejects too many.
func TestMaintThrowsAcrossContexts(t *testing.T) {
	calls := append(maintBuiltinCalls(), []maintCall{
		{"Option.some(n)", ""}, {"Duration.seconds(n)", ""}, {"Schedule.recurs(n)", ""},
		{"Duration.fromInputUnsafe(n)", "Error"}, {"ByteSize.fromInputUnsafe(n)", "Error"},
		{"Host.hostFromStringUnsafe(s)", "NetAddressError"}, {"EventLog.decodeIdentityString(s)", "SchemaError"},
		{"DateTime.makeUnsafe(s)", "IllegalArgumentError"}, {"Schema.decodeUnknownSync(Schema.String)", ""},
		{"decoder(s)", "SchemaError"}, {"Effect.Number.divideUnsafe(n)", ""},
		{"half(n)", "RangeError"}, {"Effect.Number.divideUnsafe(n, 2)", "RangeError"},
		{"nums.map(half)", "RangeError"}, {"nums.map(Effect.Number.divideUnsafe(2))", "RangeError"},
		{"words.map(DateTime.makeUnsafe)", "IllegalArgumentError"}, {"nums.map(Option.some)", ""},
	}...)
	lines := []string{
		"import * as Host from 'effect/net/Host'",
		"import * as EventLog from 'effect/eventlog/EventLog'",
		"const decoder = Schema.decodeUnknownSync(Schema.String)",
		"const half = Effect.Number.divideUnsafe(2)",
		"declare const n: number, s: string, buf: Uint8Array, nums: number[], words: string[]",
	}
	want := map[int]maintExpectedError{}
	for i, c := range calls {
		for _, ctx := range []struct {
			name, head, before, after string
			code                      int32
		}{
			{"plain", "", "return ", "", EK0401.Code},
			{"effect", "effect ", "return ", "", EK0403.Code},
			{"caught", "", "try { return ", " } catch { return null }", 0},
			{"bridged", "effect ", "return try Effect.try(() => ", ")", 0},
		} {
			lines = append(lines, fmt.Sprintf("export %sfunction %s%d() { %s%s%s }", ctx.head, ctx.name, i, ctx.before, c.expr, ctx.after))
			if ctx.code != 0 && c.bound != "" {
				want[len(lines)] = maintExpectedError{ctx.code, c.bound}
			}
		}
	}
	source := strings.Join(lines, "\n")
	p, file, _, _ := editorProgramAt(t, "main.vibe", `{"target":"ESNext","lib":["esnext","dom"],"module":"NodeNext","strict":true,"skipLibCheck":true,"types":[]}`, source, editorPackageJSON, editorPackages)
	all := append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...)
	maintCheckErrors(t, source, want, all)
}

// A try operand that produces an Effect by unwrapping a value can throw
// before the Effect exists. Only a signature that itself returns Effect is
// exempt, including when the generic or the callback is reached by alias.
func TestMaintPerformsEffectful(t *testing.T) {
	lines := []string{
		"import { foreignGet, makeEffect } from './foreign.js'",
		"const get = foreignGet, make = makeEffect, unwrap = Option.getOrThrow",
	}
	want := map[int]maintExpectedError{}
	for i, name := range []string{"foreignGet", "get", "makeEffect", "make", "Option.getOrThrow", "unwrap"} {
		call := name + "()"
		var bound string
		switch i / 2 {
		case 0:
			call = name + "<Effect.Effect<number>>()"
			bound = "RangeError"
		case 2:
			call = name + "(opt)"
			bound = "Error"
		}
		lines = append(lines, fmt.Sprintf("export effect function run%d(opt: Option.Option<Effect.Effect<number>>) { return try %s }", i, call))
		if bound != "" {
			want[len(lines)] = maintExpectedError{EK0403.Code, bound}
		}
	}
	source := strings.Join(lines, "\n")
	p, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": `import type { Effect } from "effect"
 /** @throws {RangeError} */
 export declare function foreignGet<T>(): T
 /** @throws {RangeError} */
 export declare function makeEffect(): Effect.Effect<number>
`})
	all := append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...)
	maintCheckErrors(t, source, want, all)
}

// Native loop nesting does not introduce an item boundary. Each nameless
// member likewise owns its diagnostic, including beside user-written keys
// that would otherwise collide with synthesized property names.
func TestMaintParserDiagnosticOwnership(t *testing.T) {
	var lines []string
	want := map[int]maintExpectedError{}
	for depth := 0; depth < 4; depth++ {
		for _, cross := range []bool{false, true} {
			head := fmt.Sprintf("export effect function loop%d%t(xs: unknown) { outer: for concurrent(2) (const x of (xs is Array(...let ys) ? ys : [])) {", depth, cross)
			lines = append(lines, head)
			for range depth {
				lines = append(lines, "for (const y of [1]) {")
			}
			if cross {
				lines = append(lines, "for concurrent (const z of [1]) {")
			}
			lines = append(lines, "continue outer;")
			if cross {
				want[len(lines)] = maintExpectedError{code: EK1905.Code}
				lines = append(lines, "}")
			}
			lines = append(lines, strings.Repeat("}", depth)+"} }")
		}
	}
	for i, name := range []string{"First", "Second", "Third"} {
		lines = append(lines, "export schema "+name+" {", `"": number; "#1": number;`)
		members := []string{"[k: string]: number;", "(x: number): string;", "new (): object;"}
		for j := range members {
			lines = append(lines, members[(i+j)%len(members)])
			want[len(lines)] = maintExpectedError{code: EK1505.Code}
		}
		lines = append(lines, "}")
	}
	source := strings.Join(lines, "\n")
	maintCheckErrors(t, source, want, errorsOf(t, source))
}

// Compile mutations against the bundled lib and a small Effect declaration.
// Each byte selects an independently checked source line. Changing one line's
// catch or callback cannot absorb a diagnostic belonging to another line.
func FuzzChapterThreeCallSites(f *testing.F) {
	f.Add([]byte{0, 1, 2, 3, 4, 5, 6}, uint8(0))
	f.Add([]byte{0x80, 0x41, 0xc2, 0x23}, uint8(9))
	builtins := maintBuiltinCalls()
	f.Fuzz(func(t *testing.T, choices []byte, offset uint8) {
		lines := []string{
			"import { get, make } from './foreign.js'",
			"import type { Effect } from 'effect'",
			"declare const n: number, s: string, buf: Uint8Array, xs: string[]",
			"const cb = encodeURIComponent, pure = (s: string) => s",
		}
		want := map[int]maintExpectedError{}
		for i, choice := range choices[:min(len(choices), 12)] {
			name := fmt.Sprintf("f%d", i)
			call := builtins[(int(offset)+int(choice))%len(builtins)]
			expected := maintExpectedError{code: EK0401.Code, bound: call.bound}
			var line string
			switch choice % 3 {
			case 0, 1:
				if choice%3 == 1 {
					call = maintCall{"xs.map(cb)", "URIError"}
					if choice&0x20 != 0 {
						call = maintCall{"xs.map(pure)", ""}
					}
					expected.bound = call.bound
				}
				expr := "return " + call.expr
				if choice&0x80 != 0 {
					expr = "try { " + expr + " } catch { return undefined }"
					expected.bound = ""
				}
				line = "export function " + name + "() { " + expr + " }"
			case 2:
				expr := "get<Effect.Effect<number>>()"
				expected = maintExpectedError{code: EK0403.Code, bound: "RangeError"}
				if choice&0x40 != 0 {
					expr = "make()"
					expected.bound = ""
				}
				line = "export effect function " + name + "() { return try " + expr + " }"
			}
			lines = append(lines, line)
			if expected.bound != "" {
				want[len(lines)] = expected
			}
		}
		source := strings.Join(lines, "\n")
		const root = "/workspace/x/src/"
		files := computedKeyFiles(false)
		files[root+"tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","lib":["esnext"],"types":[]},"files":["main.vibe"]}`
		files[root+"main.vibe"] = source
		files[root+"foreign.d.ts"] = `import type { Effect } from 'effect'
/** @throws {RangeError} */
export declare function get<T>(): T
/** @throws {RangeError} */
export declare function make(): Effect.Effect<number>`
		p := computedKeyProgram(t, files)
		file := p.GetSourceFile(root + "main.vibe")
		all := append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...)
		maintCheckErrors(t, source, want, all)
	})
}
