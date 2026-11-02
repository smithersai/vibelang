package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VIP-5 (amended 2026-10-29): a catch handler is a plain or effect arrow or
// function expression; anything else is EK0509, whose quick fix writes a
// function literal. t3code's value handlers (queryPersistence.vibe) compiled
// as fallbacks with no diagnostic.
func TestCatchHandlerEK0509QuickFix(t *testing.T) {
	const prefix = "import * as Effect from \"effect/Effect\"\nconst onErr = (e: string) => e.length\nfunction make(): number { return 7 }\nexport effect function f() { return Effect.fail(\"x\") catch "
	for _, test := range []struct{ written, want string }{
		{"7", "() => 7"},
		{"(7)", "() => (7)"},
		{"onErr", "(e) => onErr(e)"},
		{"make()", "() => make()"},
		// An object literal fallback keeps its braces an object (foldkit-17069).
		{"{ v: 1 }", "() => ({ v: 1 })"},
		{"{ make }", "() => ({ make })"},
		{"{ v: make() }", "() => ({ v: make() })"},
		{"Effect.succeed(8)", "effect () => try Effect.succeed(8)"},
		{"throw new Error(\"y\")", "effect () => throw new Error(\"y\")"},
		{"effect { return 9 }", "effect () => { return 9 }"},
		{"async (e) => 7", "(e) => 7"},
		{"async e => 7", "e => 7"},
		{"async function () { return 7 }", "function () { return 7 }"},
		{"function* () { return 7 }", "function () { return 7 }"},
		{"class C {}", ""},
	} {
		t.Run(test.written, func(t *testing.T) {
			want := ""
			if test.want != "" {
				want = prefix + test.want + " }\n"
			}
			// A function expression handler is valid but not yet admitted by the
			// parser (catch-parenthesized-literal-parse), so its parameter is untyped.
			checkCatchHandlerFix(t, prefix+test.written+" }\n", test.written, want, !strings.Contains(test.want, "function"))
		})
	}
}

// A repaired arrow would take in what follows the catch expression, so the
// whole expression is parenthesized: a chain, a conditional's test.
func TestCatchHandlerEK0509QuickFixParenthesizes(t *testing.T) {
	const prefix = "import * as Effect from \"effect/Effect\"\nexport effect function f() { return "
	checkCatchHandlerFix(t, prefix+"Effect.fail(\"x\") catch Effect.fail(\"y\") catch () => 0 }\n", "Effect.fail(\"y\")", prefix+"(Effect.fail(\"x\") catch effect () => try Effect.fail(\"y\")) catch () => 0 }\n", true)
	checkCatchHandlerFix(t, prefix+"Effect.fail(\"x\") catch 0 ? 1 : 2 }\n", "0", prefix+"(Effect.fail(\"x\") catch () => 0) ? 1 : 2 }\n", true)
}

func checkCatchHandlerFix(t *testing.T, source, handler, want string, clean bool) {
	t.Helper()
	program, file, service, converters := editorProgram(t, source)
	var found *lsproto.Diagnostic
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "EK" && d.Code() == EK0509.Code {
			if d.Pos() != strings.LastIndex(source, handler) || d.Len() != len(handler) {
				t.Fatalf("EK0509 must cover the handler %q: %v", handler, d)
			}
			found = lsconv.DiagnosticToLSPPush(t.Context(), converters, d)
		}
	}
	if found == nil {
		t.Fatalf("no EK0509 for catch %s", handler)
	}
	only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
	response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
		Range:        found.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{found}, Only: &only},
	})
	if err != nil {
		t.Fatal(err)
	}
	var got string
	if response.CommandOrCodeActionArray != nil {
		for _, action := range *response.CommandOrCodeActionArray {
			if chosen := action.CodeAction; chosen != nil && strings.HasPrefix(chosen.Title, "Write the handler as ") && chosen.Edit != nil && chosen.Edit.Changes != nil {
				got = applyEditorEdits(t, file, converters, (*chosen.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
			}
		}
	}
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	if want == "" || !clean {
		return
	}
	checked, edited, _, _ := editorProgram(t, got)
	for _, after := range checked.GetSemanticDiagnostics(t.Context(), edited) {
		if after.Category() == diagnostics.CategoryError {
			t.Errorf("quick fix left error: %s", after.String())
		}
	}
}

// A function literal handler, parenthesized or not, is no EK0509.
func TestCatchHandlerFunctionLiteralsAdmitted(t *testing.T) {
	for _, handler := range []string{"() => 7", "(e) => 7", "e => 7", "effect () => 7", "effect (e) => { return 7 }", "(() => 7)", "function () { return 7 }"} {
		source := "import * as Effect from \"effect/Effect\"\nexport effect function f() { return Effect.fail(\"x\") catch " + handler + " }\n"
		program, file, _, _ := editorProgram(t, source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Source() == "EK" && d.Code() == EK0509.Code {
				t.Errorf("catch %s: unexpected EK0509", handler)
			}
		}
	}
}

// RC-22: decoded names come from the handler's scope, never source words.
func TestCatchHandlerFreshParameterScope(t *testing.T) {
	const prefix = "import * as Effect from \"effect/Effect\"\nconst e = \"E\", error = \"R\", failure = \"F\", $e = \"outer\", $e2 = \"two\"\n/** @throws {never} */\nfunction make(a:string,b:string,c:string,d:string): (x:string)=>string { return () => a+b+c+d }\nexport effect function f() { return Effect.fail(\"bad\") catch "
	for _, handler := range []string{
		"make(e,error,failure,$e)",
		"({ get: make(e,error,failure,$e) })[\"get\"]",
		"make(\"\",\"\",\"\", /* e error failure */ $e)",
		"make(\"\",\"\",\"\", \\u0065)",
		"make(\"\",\"\",\"\", \\u{65})",
	} {
		t.Run(handler, func(t *testing.T) {
			checkCatchHandlerFix(t, prefix+handler+" }\n", handler, prefix+"($e3) => ("+handler+")($e3) }\n", true)
		})
	}
}

// RC-20: a modifier-only repair must not introduce illegal await/yield.
func TestCatchHandlerModifierBodySafety(t *testing.T) {
	const prefix = "export effect function f() { return Effect.fail(\"bad\") catch "
	for _, handler := range []string{
		"async function(e:string){return await Promise.resolve(7)}",
		"function*(e:string){yield 1}",
		"async (e:string) => await Promise.resolve(7)",
		"async function*(e:string){yield await Promise.resolve(7)}",
		"async function(e:string){for await (const x of [7]) { return x }}",
		"async () => ({[await Promise.resolve(\"key\")](){return 7}})",
		"async () => { class C { @(await Promise.resolve(() => undefined)) m() {} }; return 7 }",
		"async () => { await using r = { async [Symbol.asyncDispose]() {} }; return 7 }",
	} {
		t.Run(handler, func(t *testing.T) {
			checkCatchHandlerFix(t, prefix+handler+" }\n", handler, "", false)
			p, file, _, _ := editorProgram(t, prefix+handler+" }\n")
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == "EK" && d.Code() == EK0509.Code {
					if !strings.Contains(diagnosticWithNotes(d), "explicit body conversion") || strings.Contains(diagnosticWithNotes(d), "Write it as a function literal") {
						t.Fatalf("unsafe diagnostic advice: %s", diagnosticWithNotes(d))
					}
				}
			}
		})
	}
	for _, body := range []string{
		"{ const note = \"await yield\"; /* await yield */ return 7 }",
		"{ const inner=async () => await Promise.resolve(1); return 7 }",
		"{ const inner=function*(){yield 1}; return 7 }",
		"{ const o={async m(){return await Promise.resolve(1)}}; return 7 }",
		"{ class C { async m(){return await Promise.resolve(1)} }; return 7 }",
	} {
		handler := "async (e:string) => " + body
		checkCatchHandlerFix(t, prefix+handler+" }\n", handler, prefix+"(e:string) => "+body+" }\n", true)
	}
}

// RC-21: modifier trivia belongs to the user's source, including JSDoc.
func TestCatchHandlerModifierComments(t *testing.T) {
	const prefix = "export effect function f() { return Effect.fail(\"bad\") catch "
	for _, test := range []struct{ handler, want string }{
		{"async /* KEEP_HEADER */ (e:string) => 7", "/* KEEP_HEADER */ (e:string) => 7"},
		{"async /* KEEP_ONE */ /* KEEP_TWO */ (e:string) => 7", "/* KEEP_ONE */ /* KEEP_TWO */ (e:string) => 7"},
		{"async /** KEEP_DOC */ function(e:string){return 7}", "/** KEEP_DOC */ function(e:string){return 7}"},
		{"async/*KEEP*/(e:string)=>7", "/*KEEP*/(e:string)=>7"},
		{"async /* HEADER */ function /* LINE\nBREAK */ * (e:string){const preserved=7}", "/* HEADER */ function /* LINE\nBREAK */  (e:string){const preserved=7}"},
		{"async /* ASYNC */ function /* BEFORE */ * /* AFTER */ (e:string){const preserved=7}", "/* ASYNC */ function /* BEFORE */  /* AFTER */ (e:string){const preserved=7}"},
	} {
		t.Run(test.handler, func(t *testing.T) {
			checkCatchHandlerFix(t, prefix+test.handler+" }\n", test.handler, prefix+test.want+" }\n", true)
		})
	}
}

// checkCatchExpressions stopped at the first catch outside effect code, so a
// later catch in the file got neither EK0504 nor EK0509, and --fix had no
// repair for it (foldkit devtools-mcp relayRegistry.vibe: readRecordFile's
// value fallback, then retireStaleRecord's link(…) catch undefined).
func TestCatchExpressionsCheckEveryCatch(t *testing.T) {
	source := "const a = (p: string): number!! => {\n  return Effect.succeed(1) catch 7\n}\nconst b = (p: string): number!! => {\n  return Effect.succeed(2) catch 8\n}\nexport effect function c() {\n  return Effect.succeed(3) catch 9\n}\n"
	program, file, _, _ := editorProgram(t, source)
	counts := map[int32]int{}
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "EK" {
			counts[d.Code()]++
		}
	}
	if counts[EK0504.Code] != 2 || counts[EK0509.Code] != 3 {
		t.Fatalf("EK0504 x%d, EK0509 x%d; want 2 and 3: every catch is checked", counts[EK0504.Code], counts[EK0509.Code])
	}
}
