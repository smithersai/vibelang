package vibelangmapper

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// checkSyntaxDiagnostic pins each EK rule's original node and native message,
// and the nearest valid form, independently of other mapper diagnostics.
func checkSyntaxDiagnostic(t *testing.T, code int32, source, at, message, valid string) {
	t.Helper()
	var found []Diagnostic
	for _, d := range Project(source, testContext).Diagnostics {
		if d.Code == code {
			found = append(found, d)
		}
	}
	if len(found) != 1 {
		t.Fatalf("EK%d: %v", code, found)
	}
	d := found[0]
	if d.Start != strings.Index(source, at) || d.Length != len(at) || d.Message != message {
		t.Fatalf("EK%d: got %+v, want %q at %d", code, d, message, strings.Index(source, at))
	}
	for _, d := range Project(valid, testContext).Diagnostics {
		if d.Code == code {
			t.Fatalf("valid form: %+v", d)
		}
	}
}

// checkSyntaxFixture keeps the parity gate tied to the original fail cases.
func checkSyntaxFixture(t *testing.T, name string, code int32, count int) {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join("../../../vibelang/cases", name+".fail", "*.vibe"))
	if err != nil || len(paths) != 1 {
		t.Fatalf("fixture %s: %v %v", name, paths, err)
	}
	data, err := os.ReadFile(paths[0])
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	var found []Diagnostic
	for _, d := range Project(source, testContext).Diagnostics {
		if d.Code == code {
			found = append(found, d)
		}
	}
	if len(found) != count {
		t.Fatalf("%s: want %d EK%d, got %v", name, count, code, found)
	}
	if code == 4405 {
		positions := [][2]int{{27, 28}, {28, 28}, {28, 37}, {29, 28}, {30, 28}, {31, 31}}
		for i, pos := range positions {
			offset := 0
			lines := strings.Split(source, "\n")
			for _, line := range lines[:pos[0]-1] {
				offset += len(line) + 1
			}
			if found[i].Start != offset+pos[1]-1 {
				t.Fatalf("%s: capture %d: %+v", name, i, found[i])
			}
		}
	}
}

// TestSyntaxEK1003 reports for await and await using outside an async
// function; an async function means what it means in TypeScript (VIP-1).
func TestSyntaxEK1003(t *testing.T) {
	checkSyntaxFixture(t, "ek1004-await-using", 1003, 1)
	checkSyntaxDiagnostic(t, 1003, `await using log = open()`, "await", "await using is not part of VibeLang: a call already waits.", `export async function load() { await using log = open(); return await Promise.resolve(1) }`)
	checkSyntaxDiagnostic(t, 1003, `for await (const x of xs) {}`, "await", "for await is not part of VibeLang: a call already waits.", `const load = async (xs: AsyncIterable<number>) => { for await (const x of xs) {} }`)
}

// TestSyntaxEK1004 includes module blocks and class static initialization.
func TestSyntaxEK1004(t *testing.T) {
	checkSyntaxFixture(t, "ek1004-await-using", 1004, 1)
	checkSyntaxFixture(t, "ek1004-using", 1004, 3)
	for _, source := range []string{`using log = open()`, `await using log = open()`, `{ using log = open() }`, `class Registry { static { using log = open() } }`} {
		checkSyntaxDiagnostic(t, 1004, source, "using", "using needs a block that a program runs, but a module's top level is not inside one.", `function f() { using log = open() }`)
	}
}

// TestSyntaxEK2003 accepts Effect types with type arguments left out, which
// mean never as in TypeScript (D308, D309).
func TestSyntaxEK2003(t *testing.T) {
	for _, valid := range []string{
		`function f(): Effect<string> { return "" }`,
		`function f(): Effect<string, Missing> { return "" }`,
		`function f(): Effect<string, never, never> { return "" }`,
		`type Effect<A> = A; function f(): Effect<string> { return "" }`,
		`function outer() { type Effect<A> = A; function f(): Effect<string> { return "" } }`,
		`function f<Effect>(): Effect<string> { return "" }`,
	} {
		for _, d := range Project(valid, testContext).Diagnostics {
			if d.Code == 2003 {
				t.Fatalf("plain or complete annotation: %+v", d)
			}
		}
	}
}

// TestSyntaxEK2006 distinguishes exits from local targets in finally (D15).
func TestSyntaxEK2006(t *testing.T) {
	checkSyntaxFixture(t, "ek2006-finally-jump", 2006, 2)
	for _, jump := range []string{"return", "break", "continue"} {
		checkSyntaxDiagnostic(t, 2006, "function f() { while (true) { try {} finally { "+jump+"; } } }", jump, jump+" leaves a finally block, which would discard a failure in flight.", `function f() { try { return 1 } finally { while (true) { break; continue } const g = () => { return 2 } } }`)
	}
}

// TestSyntaxEK2101 requires Effect types on service and D1 abstract members.
func TestSyntaxEK2101(t *testing.T) {
	checkSyntaxFixture(t, "ch12-rates-bare-return", 2101, 1)
	checkSyntaxFixture(t, "decl-service-contract", 2101, 1)
	for _, source := range []string{`service Rates { lookup(currency: string): number }`} {
		checkSyntaxDiagnostic(t, 2101, source, "number", "Rates.lookup has no body to infer from, so its contract must be written as an Effect type.", `service Rates { lookup(currency: string): number!! }`)
	}
	checkSyntaxDiagnostic(t, 2101, `service Rates { lookup() }`, "lookup", "Rates.lookup has no body to infer from, so its contract must be written as an Effect type.", `class Rates { lookup(): number { return 1 } }`)
}

// TestSyntaxEK2104 pins the late setup statement, including its semicolon (D129).
func TestSyntaxEK2104(t *testing.T) {
	checkSyntaxFixture(t, "decl-layer-order", 2104, 1)
	checkSyntaxDiagnostic(t, 2104, `layer CounterLive: Counter { next() { return 1 } const start = 0; }`, "const start = 0;", "This statement follows the layer's members, but a layer's setup statements come first.", `layer CounterLive: Counter { const start = 0; next() { return start } }`)
}

// TestSyntaxEK4405 uses lexical bindings and honors hatch-local shadows (D229).
func TestSyntaxEK4405(t *testing.T) {
	checkSyntaxFixture(t, "ek4405-self-contained", 4405, 6)
	for _, use := range []string{"text.length", "({ text })", "text"} {
		source := "function label(text: string) { return sync(() => " + use + ") }"
		at := strings.LastIndex(source, "text")
		var ds []Diagnostic
		for _, d := range Project(source, testContext).Diagnostics {
			if d.Code == 4405 {
				ds = append(ds, d)
			}
		}
		if len(ds) != 1 || ds[0].Start != at || ds[0].Length != 4 || ds[0].Message != "text is declared outside the hatch, and a hatch's TypeScript is self-contained: pass text to sync as an input." {
			t.Fatalf("%s: %v", source, ds)
		}
	}
	valid := `import { trim } from './text'; error Bad { reason: string }; const text = "outer"; function f() { return sync((text: string) => { const local = trim(text); if (!local) throw new Bad({ reason: JSON.stringify(local) }); return { text: local } }, text) }`
	for _, d := range Project(valid, testContext).Diagnostics {
		if d.Code == 4405 {
			t.Fatalf("valid hatch: %+v", d)
		}
	}
}

// S10-12 is checked before either mapper rendering; each must refuse the
// same source span and use the native registry's message.
func TestSyntaxEK1010(t *testing.T) {
	checkSyntaxDiagnostic(t, 1010, "function f() { return sync((x: any) => throw x ?? 1, 0) }", "throw x", "throw takes only x here, so the rest of the expression would not be thrown; write throw (…) to throw the whole expression.", "function f() { return sync((x: any) => { throw x ?? 1 }, 0) }")
	checkSyntaxFixture(t, "throw-operator-precedence", 1010, 3)
	checkSyntaxFixture(t, "throw-trailing-precedence", 1010, 3)
	var expressions []string
	for _, op := range []string{"+", "-", "*", "/", "%", "**", "<<", ">>", ">>>", "<", "<=", ">", ">=", "==", "!=", "===", "!==", "&", "|", "^", "&&", "||", "??", "in", "instanceof", "=", "+=", "**=", "??=", "&&=", "||="} {
		expressions = append(expressions, "throw x "+op+" x")
	}
	expressions = append(expressions, "throw x ? 1 : 2", "throw x as any", "throw x satisfies any", "throw x |> %", "throw x |> x(1)(%)")
	for _, expr := range expressions {
		checkSyntaxDiagnostic(t, 1010, "function f(x: any) { return "+expr+" }", "throw x", "throw takes only x here, so the rest of the expression would not be thrown; write throw (…) to throw the whole expression.", "function f(x: any) { return throw (x ? 1 : 2) }")
	}
	// A throw that ends an operator's left operand or a conditional's
	// condition: x ?? throw x ? 1 : 2 is (x ?? throw x) ? 1 : 2.
	for _, expr := range []string{
		"x ?? throw x ? 1 : 2", "x || throw x || 1", "x && throw x ? 1 : 2", "x ?? throw x as any",
		"x || throw x satisfies any", "x ?? throw x |> %", "x ?? throw x |> x(1)(%)", "x ? 1 : x ?? throw x ? 1 : 2",
	} {
		checkSyntaxDiagnostic(t, 1010, "function f(x: any) { return "+expr+" }", "throw x", "throw takes only x here, so the rest of the expression would not be thrown; write throw (…) to throw the whole expression.", "function f(x: any) { return x ?? throw (x ? 1 : 2) }")
	}
	for _, tc := range []struct{ expression, span, operand string }{
		{"throw (x) + 1", "throw (x)", "(x)"},
		{"throw /* trivia */ x === 1", "throw /* trivia */ x", "x"},
		{"throw x.code === \"unknown\" ? 1 : 2", "throw x.code", "x.code"},
	} {
		source := "function f(x: any) { return " + tc.expression + " }"
		message := "throw takes only " + tc.operand + " here, so the rest of the expression would not be thrown; write throw (…) to throw the whole expression."
		checkSyntaxDiagnostic(t, 1010, source, tc.span, message, "function f(x: any) { return (throw x) ?? 1 }")
		for name, projection := range map[string]Projection{"checking": Project(source, testContext), "executable": Executable(source, testContext)} {
			count := 0
			for _, d := range projection.Diagnostics {
				if d.Code != 1010 {
					continue
				}
				count++
				if d.Start != strings.Index(source, tc.span) || d.Length != len(tc.span) || d.Message != message {
					t.Errorf("%s: %+v", name, d)
				}
			}
			if count != 1 {
				t.Errorf("%s: got %d EK1010 diagnostics, want 1", name, count)
			}
		}
	}
	for _, expr := range []string{
		"x ?? throw x", "x || throw x", "x && throw x", "x ? 1 : throw x", "x ? throw x : 1",
		"((x: any) => x ?? throw x)(x)", "throw (x ? 1 : 2)", "throw (x === 1)",
		"throw (x ?? 1)", "throw (x as any)", "throw (x satisfies any)", "throw (x |> x(1)(%))", "(throw x) |> x(1)(%)",
		"(throw x) ?? 1", "(throw x) ? 1 : 2", "(throw x) as any", "(throw x) satisfies any",
		"(throw x, 1)", "(() => { throw x })() ?? 1", "do { throw x } ?? 1",
		"(x ?? throw x) ? 1 : 2", "x ?? (throw x) ? 1 : 2", "(x ?? throw x, 1)", "x ? 1 : x ?? throw x", "[x ?? throw x, 1]",
	} {
		source := "function f(x: any) { return " + expr + " }"
		for _, d := range Project(source, testContext).Diagnostics {
			if d.Code == 1010 {
				t.Errorf("valid %s: %+v", expr, d)
			}
		}
	}
	for _, source := range []string{
		"function f(x: any) { throw x ? 1 : 2; }",
		"function f(x: any) { return x catch (e) => throw (x ? 1 : 2) }",
	} {
		for _, d := range Project(source, testContext).Diagnostics {
			if d.Code == 1010 {
				t.Errorf("valid: %+v", d)
			}
		}
	}
}
