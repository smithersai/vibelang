package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// D33 and D240 promise mechanical fixes that leave usable source. Request the
// public LSP action, compare all edits, and type-check the resulting document.
func TestEditorQuickFixGoldens(t *testing.T) {
	for _, test := range []struct {
		name, source, title, want string
		code                      int32
	}{
		{"hatch constructor capture", "class C {}\nexport effect function main() { return try sync(() => new C()) }", "Pass C as an input", "class C {}\nexport effect function main() { return try sync((C) => new C(), C) }", EK4405.Code},
		{"hatch narrowed capture", "effect function size(value: string | undefined) { if (value === undefined) return 0; return try sync(() => value.length) }", "Pass value as an input", "effect function size(value: string | undefined) { if (value === undefined) return 0; return try sync((value: string) => value.length, value) }", EK4405.Code},
		{"hatch captured function type query", "const parse = (text: string): number => Number(text)\nexport effect function invalid(text: string) { return try sync((input: typeof text): ReturnType<typeof parse> => parse(input), text) }", "Pass parse as an input", "const parse = (text: string): number => Number(text)\nexport effect function invalid(text: string) { return try sync((input: typeof text, parse: (text: string) => number): ReturnType<typeof parse> => parse(input), text, parse) }", EK4405.Code},
		{"service public property", "service S { public n: number }", "Write a service contract", "service S { n: number }", 902},
		{"service private readonly property", "service S { private /* keep */ readonly n?: number }", "Write a service contract", "service S { /* keep */ readonly n?: number }", 902},
		{"service declare property", "service S { declare n: number }", "Write a service contract", "service S { n: number }", 902},
		{"service override property", "service S { override n: number }", "Write a service contract", "service S { n: number }", 902},
		{"service accessor property", "service S { accessor n: number }", "Write a service contract", "service S { n: number }", 902},
		{"service readonly method", "service S { readonly run(): number!! }", "Write a service contract", "service S { run(): number!! }", 902},
		{"service async method", "service S { async run(): number!! }", "Write a service contract", "service S { run(): number!! }", 902},
		{"service effect method", "service S { effect /* keep */ run(): number!! }", "Write a service contract", "service S { /* keep */ run(): number!! }", 902},
		{"service definite property", "service S { n /* keep */ !: number }", "Write a service contract", "service S { n /* keep */ : number }", 902},
		{"typed catch expression", "error NotFound\neffect function load(): string!NotFound { throw new NotFound() }\nexport effect function main() { return load() catch (e: NotFound) => \"missing\" }", "Test the failure with match", "error NotFound\neffect function load(): string!NotFound { throw new NotFound() }\nexport effect function main() { return load() catch effect (e) => match (e) { when NotFound: \"missing\"; default: throw e; } }", 2112},
		{"typed catch block", "error NotFound\neffect function load(): string!NotFound { throw new NotFound() }\nexport effect function main() { return load() catch (e: NotFound) => { return \"missing\" } }", "Test the failure with is", "error NotFound\neffect function load(): string!NotFound { throw new NotFound() }\nexport effect function main() { return load() catch effect (e) => { if (e is NotFound) { return \"missing\" } else { throw e } } }", 2112},
		{"catch comments trailing", "error Gone\neffect function load(): number!Gone { throw new Gone() }\nexport effect function recover() {\n  try { return load() } catch (e: Gone) {\n    return 0 // keep fallback\n  }\n}", "Test the failure with match", "error Gone\neffect function load(): number!Gone { throw new Gone() }\nexport effect function recover() {\n  try { return load() } catch (e) {\n    return match (e) {\n      when Gone: 0; // keep fallback\n      default: throw e;\n    }\n  }\n}", 2112},
		{"catch comments all trivia", "error Gone\neffect function load(): number!Gone { throw new Gone() }\nexport effect function recover() {\n  try { return load() } catch (e: Gone) {\n    // before fallback\n    return /* value */ 0 /* before semi */; // after fallback\n    /* after statement */\n  }\n}", "Test the failure with match", "error Gone\neffect function load(): number!Gone { throw new Gone() }\nexport effect function recover() {\n  try { return load() } catch (e) {\n    return match (e) {\n      // before fallback\n      when Gone: /* value */ 0 /* before semi */; // after fallback\n      /* after statement */\n      default: throw e;\n    }\n  }\n}", 2112},
		{"generic explicit opt out", "function take<T>(x: T[]): number { return 1 }; effect function main(job: Effect.Effect<number>) { return take([job]) }", keepInferredEffectTitle, "function take<T>(x: T[]): number { return 1 }; effect function main(job: Effect.Effect<number>) { return take<number!!>([job]) }", 4802},
		{"generic argument", "function take<T>(x: T, message?: string): number { return 1 }; effect function main(job: Effect.Effect<number>) { return take(job) }", "Run it with try", "function take<T>(x: T, message?: string): number { return 1 }; effect function main(job: Effect.Effect<number>) { return take(try job) }", 4802},
		{"run value", "effect function main(job: Effect.Effect<number>) { job }", "Run it with try", "effect function main(job: Effect.Effect<number>) { try job }", 4801},
		{"run program by name", "export effect function main() { try Console.log(\"before\"); interrupt }", "Run it with try", "export effect function main() { try Console.log(\"before\"); try interrupt() }", 4801},
		{"run conditional", "effect function main(flag: boolean, a: Effect.Effect<number>, b: Effect.Effect<number>) { flag ? a : b }", "Run it with try", "effect function main(flag: boolean, a: Effect.Effect<number>, b: Effect.Effect<number>) { try (flag ? a : b) }", 4801},
		{"Effect 4 name", `function main() { return Effect.catchAll(Effect.fail("bad"), () => Effect.succeed(1)) }`, "Write Effect.catch", `function main() { return Effect.catch(Effect.fail("bad"), () => Effect.succeed(1)) }`, 4813},
		{"empty pipe", "// @vibelang-diagnostics EK4824:warning\nexport const value = pipe(1)", "Remove the pipe", "// @vibelang-diagnostics EK4824:warning\nexport const value = 1", 4824},
		{"arrow expression", "// @vibelang-diagnostics EK4823:warning\nexport const add = (x: number) => { return x + 1 }", "Write the value as the body", "// @vibelang-diagnostics EK4823:warning\nexport const add = (x: number) => x + 1", 4823},
		{"arrow object", "// @vibelang-diagnostics EK4823:warning\nexport const box = (x: number) => { return { value: x } }", "Write the value as the body", "// @vibelang-diagnostics EK4823:warning\nexport const box = (x: number) => ({ value: x })", 4823},
		{"schema field comma", "schema Draft { readonly title: string, readonly count: number }", "Write ; for the comma", "schema Draft { readonly title: string; readonly count: number }", 1013},
		{"data field comma", "data Shape { Rect { width: number, height: number } }", "Write ; for the comma", "data Shape { Rect { width: number; height: number } }", 1013},
		{"data variant comma", "data Answer { Yes, No }", "Write ; for the comma", "data Answer { Yes; No }", 1013},
		{"service separator block comment", "service Flags { a: number /* keep */ b: string }", "Insert ; between the members", "service Flags { a: number; /* keep */ b: string }", 908},
		{"service separator JSDoc", "service Flags { a: number /** @throws {Error} */ read(): string }", "Insert ; between the members", "service Flags { a: number; /** @throws {Error} */ read(): string }", 908},
		{"service separator Unicode", "service Flags { café: number /* 😀 */ b: string }", "Insert ; between the members", "service Flags { café: number; /* 😀 */ b: string }", 908},
		{"service member separator", "service Flags { a: number b: string }", "Insert ; between the members", "service Flags { a: number; b: string }", 908},
		{"tagged schema", `// @vibelang-diagnostics EK4821:warning
export const Person = Schema.Struct({ _tag: Schema.Literal("Person"), name: Schema.String })`, "Write Schema.TaggedStruct", `// @vibelang-diagnostics EK4821:warning
export const Person = Schema.TaggedStruct("Person", { name: Schema.String })`, 4821},
	} {
		t.Run(test.name, func(t *testing.T) {
			const prefix = "// café 😀\n"
			program, file, service, converters := editorProgram(t, prefix+test.source)
			var diagnostic *ast.Diagnostic
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() == test.code {
					diagnostic = d
					break
				}
			}
			if diagnostic == nil {
				t.Fatalf("missing EK%d in %s", test.code, test.source)
			}
			d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
				Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
			})
			if err != nil {
				t.Fatal(err)
			}
			var chosen *lsproto.CodeAction
			if response.CommandOrCodeActionArray != nil {
				for _, action := range *response.CommandOrCodeActionArray {
					if action.CodeAction != nil && action.CodeAction.Title == test.title {
						chosen = action.CodeAction
					}
				}
			}
			if chosen == nil || chosen.Edit == nil || chosen.Edit.Changes == nil {
				t.Fatalf("missing quick fix %q", test.title)
			}
			changes := *chosen.Edit.Changes
			if len(changes) != 1 {
				t.Fatalf("fix changed unrelated documents: %v", changes)
			}
			edits := changes[lsconv.FileNameToDocumentURI(file.FileName())]
			got := applyEditorEdits(t, file, converters, edits)
			if got != prefix+test.want {
				t.Fatalf("edited source differs:\ngot: %s\nwant: %s", got, prefix+test.want)
			}
			checked, edited, _, _ := editorProgram(t, got)
			all := append(checked.GetSyntacticDiagnostics(t.Context(), edited), checked.GetSemanticDiagnostics(t.Context(), edited)...)
			for _, after := range all {
				if after.Category() == diagnostics.CategoryError || after.Code() == test.code {
					t.Errorf("quick fix left a diagnostic: %s", after.String())
				}
			}
			if strings.Contains(got, "()()") {
				t.Fatal("quick fix calls the result twice")
			}
		})
	}
}

// TestEditorQuickFixSkipsUncallableUnion checks that EK4802's call-it fix is
// not offered for a returned union with a member that is no program: calling
// `chosen` where it may be undefined would not check.
func TestEditorQuickFixSkipsUncallableUnion(t *testing.T) {
	source := "export effect function main(job: Effect.Effect<number> | undefined): unknown!! { const chosen = job; return chosen }"
	program, file, service, converters := editorProgram(t, source)
	var diagnostic *ast.Diagnostic
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == 4802 {
			diagnostic = d
			break
		}
	}
	if diagnostic == nil {
		t.Fatalf("missing EK4802 in %s", source)
	}
	d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
	only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
	response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
		Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.CommandOrCodeActionArray != nil {
		for _, action := range *response.CommandOrCodeActionArray {
			if action.CodeAction != nil && action.CodeAction.Title == "Run it with try" {
				t.Fatal("offered Run it with try for a union with undefined")
			}
		}
	}
}

// TestEditorQuickFixSkipsMissingCatchType checks that EK2112's quick fix
// declines a catch type the parser left missing after a syntax error, which
// must get diagnostics and never a crash (Chapter 27): the missing name's
// trivia-skipped start lies past its end.
func TestEditorQuickFixSkipsMissingCatchType(t *testing.T) {
	const prefix = "error Gone\nfunction load(): number!Gone { throw new Gone() }\n"
	for _, source := range []string{
		"export function r() { try { return load() } catch (e: ) { return 0 } }",
		"export function r() { try { return load() } catch (e: Gone | ) { return 0 } }",
		"export function r() { return load() catch (e: ) => 0 }",
		"export function r() { return load() catch (e: Gone | ) => { return 0 } }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, prefix+source)
			if len(program.GetSyntacticDiagnostics(t.Context(), file)) == 0 {
				t.Fatal("missing catch type must report a syntax error")
			}
			found := false
			for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
				if diagnostic.Code() != EK2112.Code {
					continue
				}
				found = true
				d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
				only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
				response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
					TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
					Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
				})
				if err != nil {
					t.Fatal(err)
				}
				if response.CommandOrCodeActionArray != nil {
					for _, action := range *response.CommandOrCodeActionArray {
						if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, "Test the failure") {
							t.Fatalf("quick fix rewrites a missing type: %s", action.CodeAction.Title)
						}
					}
				}
			}
			if !found {
				t.Fatal("missing EK2112")
			}
		})
	}
}

// TestEditorQuickFixSkipsDestructuredCatch checks that a typed catch binding
// that destructures, catch ({ code }: any), reports EK2112 naming catch (e)
// and offers no rewrite, where reading the pattern as a name panicked the
// compiler (Node.Text of a binding pattern).
func TestEditorQuickFixSkipsDestructuredCatch(t *testing.T) {
	for _, source := range []string{
		"export function r() { try { throw { code: 7 } } catch ({ code }: any) { return code } }",
		"export function r() { try { throw [7] } catch ([first]: any) { return first } }",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, source)
			found := false
			for _, diagnostic := range program.GetSemanticDiagnostics(t.Context(), file) {
				if diagnostic.Code() != EK2112.Code {
					continue
				}
				found = true
				if !strings.Contains(diagnostic.String(), "write catch (e)") {
					t.Fatalf("EK2112 names the pattern: %s", diagnostic.String())
				}
				d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
				only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
				response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
					TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
					Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
				})
				if err != nil {
					t.Fatal(err)
				}
				if response.CommandOrCodeActionArray != nil {
					for _, action := range *response.CommandOrCodeActionArray {
						if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, "Test the failure") {
							t.Fatalf("quick fix rewrites a destructured binding: %s", action.CodeAction.Title)
						}
					}
				}
			}
			if !found {
				t.Fatal("missing EK2112")
			}
		})
	}
}

// The helper return-type fixes answered D67's inferred kinds: EK4301 for a
// helper passed or called where a callback runs synchronously, EK1001 for one
// a top level calls, and EK9203 for one a plain annotation calls. VIP-1 makes
// a function's kind its marker, so an unmarked helper is plain JavaScript and
// each of these sources compiles without an error to fix.
func TestRetiredHelperReturnTypeDiagnostics(t *testing.T) {
	for _, test := range []struct{ name, source string }{
		{"return type of a passed helper", "function twice(n: number) { return n * 2 }\nexport const doubled = [1, 2].map(twice)"},
		{"return type of a helper a callback calls", "const inc = (n: number) => n + 1\nexport const bumped = [1, 2].map((n) => inc(n))"},
		{"return type of a helper at a top level", "function label(n: number) { return `#${n}` }\nexport const first = label(1)"},
		{"return type of a helper and its own", "function half(n: number) { return n / 2 }\nfunction quarter(n: number) { return half(half(n)) }\nexport function plain(n: number): number { return quarter(n) }"},
		{"return type through a name in scope", "namespace Store {\n  export interface Ref<A> { readonly target: A }\n  export const ref = (id: string): Ref<string> => ({ target: id })\n}\nconst refOf = (id: string) => Store.ref(id)\nexport const refs = [\"a\"].map(refOf)"},
		{"long return type as infer", "const pairs = (n: number) => ({ id: n, label: `#${n}`, next: n + 1, prev: n - 1, tags: [String(n)] })\nexport const made = pairs(1)"},
		{"resource callback", "function timer(name: string) { return { name, [Symbol.dispose]() {} } }\nexport function names(ids: string[]) { return ids.map((id) => { using t = timer(id); return t.name }) }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("EK%d: %s", d.Code(), d.String())
				}
			}
		})
	}
}
