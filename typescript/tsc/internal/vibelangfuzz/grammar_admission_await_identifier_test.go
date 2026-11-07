package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

// Appendix A inherits TypeScript's context rules. TypeScript accepts await as
// an IdentifierReference in a nested non-async body, even in an external module;
// its module top level and async bodies retain the native reservation.
func TestGrammarAdmissionAwaitIdentifierQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A's inherited TypeScript grammar changed; review await identifier context")
	}
}

func TestGrammarAdmissionAwaitIdentifierContext(t *testing.T) {
	TestGrammarAdmissionAwaitIdentifierQuoted(t)
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, expression := range []string{"await.target", "{ await }", "new await", "typeof await"} {
		for _, wrapper := range []string{
			"function f() { return EXPR; }",
			"const f = function() { return EXPR; };",
			"const f = () => (EXPR);",
			"const o = { m() { return EXPR; } };",
			"class C { m() { return EXPR; } }",
			"class C { get m() { return EXPR; } }",
			"class C { x = EXPR; }",
			"async function outer() { function f() { return EXPR; } }",
			"async function outer() { const f = () => (EXPR); }",
		} {
			source := "export {}; " + strings.ReplaceAll(wrapper, "EXPR", expression)
			for name, g := range map[string]*grammarCfg{"TypeScript": lab.ts, "VibeLang": lab.g} {
				if got := lab.read(g, grammarLexSource(source), grammarParseMode{}).count; got == 0 {
					t.Errorf("%s await IdentifierReference has no derivation: %s", name, source)
				}
			}
		}
		for _, wrapper := range []string{
			"const x = EXPR;",
			"async function f() { return EXPR; }",
			"const f = async () => (EXPR);",
			"const o = { async m() { return EXPR; } };",
			"async function f() { class C { [EXPR]() {} } }",
			"async function f() { class C { [EXPR] = 1; } }",
			"function f() { class C { static { const x = EXPR; } } }",
		} {
			source := "export {}; " + strings.ReplaceAll(wrapper, "EXPR", expression)
			for name, g := range map[string]*grammarCfg{"TypeScript": lab.ts, "VibeLang": lab.g} {
				if got := lab.read(g, grammarLexSource(source), grammarParseMode{}).count; got != 0 {
					t.Errorf("%s reserved await has a derivation: %s", name, source)
				}
			}
		}
	}
	// These native bodies reset Await for references, bindings and labels.
	// A declaration's own name keeps its enclosing context.
	for _, source := range []string{
		"const x = obj.await;",
		"const o = { await: 1, await() {} };",
		"class C { await() {} }",
		"function f(await) {}",
		"function f() { let await = 1; }",
		"function f() { await: while (true) { break await; } }",
		"function f() { await: while (true) { continue await; } }",
		"async function f() { function g(await) {} }",
		"function f() { function await() {} }",
		"function f() { async function await() {} }",
		"const f = function await() {};",
		"const f = (await) => 1;",
		"async function f() { const g = (x = await.target) => x; }",
		"function f() { class await {} }",
		"function f() { class C { [await.target]() {} } }",
		"function f() { class C { [await.target] = 1; } }",
	} {
		for name, g := range map[string]*grammarCfg{"TypeScript": lab.ts, "VibeLang": lab.g} {
			if got := lab.read(g, grammarLexSource(source), grammarParseMode{}).count; got == 0 {
				t.Errorf("%s native await context has no derivation: %s", name, source)
			}
		}
		if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
			t.Errorf("native await context mistaken for an undefined form: %s", detail)
		}
	}
	for _, source := range []string{
		"let await = 1;",
		"function await() {}",
		"class await {}",
		"await: while (true) { break await; }",
		"async function f(await) {}",
		"async function f() { let await = 1; }",
		"async function f() { await: while (true) { break await; } }",
		"async function f() { function await() {} }",
		"const f = async function await() {};",
		"function f() { const g = async (await) => 1; }",
	} {
		for name, g := range map[string]*grammarCfg{"TypeScript": lab.ts, "VibeLang": lab.g} {
			if got := lab.read(g, grammarLexSource(source), grammarParseMode{}).count; got != 0 {
				t.Errorf("%s reserved binding or label has a derivation: %s", name, source)
			}
		}
	}
}

func TestGrammarAdmissionAwaitIdentifierRegression(t *testing.T) {
	TestGrammarAdmissionAwaitIdentifierQuoted(t)
	w := NewWorkspace(t)
	for _, source := range []string{
		"function f() { return await.target; }",
		"function f() { return { await }; }",
		"function f() { return new await; }",
		"function f() { return typeof await; }",
		"async function outer() { const f = () => await.target; }",
		"class C { x = await.target; }",
		"effect function f() { return await.target; }",
		"const f = effect { return { await }; };",
		"function f(await: number) { return await; }",
		"function f() { let await = 1; return await; }",
		"function f() { await: while (false) { break await; } }",
		"function f() { await: while (false) { continue await; } }",
		"async function f() { function g(await: number) { return await; } }",
		"function f() { function await() {} }",
		"function f() { async function await() {} }",
		"const f = function await() {};",
		"const f = (await: number) => await;",
		"async function f() { const g = (x = await.target) => x; }",
		"function f() { class await {} }",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			for _, d := range result.Diagnostics {
				if grammarAdmissionSyntaxDiagnostic(d) {
					t.Fatalf("inherited identifier gained syntax rejection: %v", result.Diagnostics)
				}
			}
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("inherited identifier mistaken for a grammar gap: %v", result.Diagnostics)
			}
		})
	}
}

// Keep the extra context's cost visible on ordinary and repaired readings.
func BenchmarkGrammarAdmissionAwaitContext(b *testing.B) {
	lab, err := admissionLab()
	if err != nil {
		b.Fatal(err)
	}
	for _, source := range []string{
		"function f() { return obj.target; }",
		"async function f(xs) { for (async of xs) {} }",
		"function f() { return await.target; }",
		"async function f() { function g() { return { await }; } }",
	} {
		b.Run(source, func(b *testing.B) {
			toks := grammarLexSource(source)
			b.ReportAllocs()
			for b.Loop() {
				lab.read(lab.g, toks, grammarParseMode{})
			}
		})
	}
}
