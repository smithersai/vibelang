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
		{"typed catch expression", "error NotFound\nfunction load(): string!NotFound { throw new NotFound() }\nexport function main() { return load() catch (e: NotFound) => \"missing\" }", "Test the failure with match", "error NotFound\nfunction load(): string!NotFound { throw new NotFound() }\nexport function main() { return load() catch (e) => match (e) { when NotFound: \"missing\"; default: throw e; } }", 2112},
		{"typed catch block", "error NotFound\nfunction load(): string!NotFound { throw new NotFound() }\nexport function main() { return load() catch (e: NotFound) => { return \"missing\" } }", "Test the failure with is", "error NotFound\nfunction load(): string!NotFound { throw new NotFound() }\nexport function main() { return load() catch (e) => { if (e is NotFound) { return \"missing\" } else { throw e } } }", 2112},
		{"catch comments trailing", "error Gone\nfunction load(): number!Gone { throw new Gone() }\nexport function recover() {\n  try { return load() } catch (e: Gone) {\n    return 0 // keep fallback\n  }\n}", "Test the failure with match", "error Gone\nfunction load(): number!Gone { throw new Gone() }\nexport function recover() {\n  try { return load() } catch (e) {\n    return match (e) {\n      when Gone: 0; // keep fallback\n      default: throw e;\n    }\n  }\n}", 2112},
		{"catch comments all trivia", "error Gone\nfunction load(): number!Gone { throw new Gone() }\nexport function recover() {\n  try { return load() } catch (e: Gone) {\n    // before fallback\n    return /* value */ 0 /* before semi */; // after fallback\n    /* after statement */\n  }\n}", "Test the failure with match", "error Gone\nfunction load(): number!Gone { throw new Gone() }\nexport function recover() {\n  try { return load() } catch (e) {\n    return match (e) {\n      // before fallback\n      when Gone: /* value */ 0 /* before semi */; // after fallback\n      /* after statement */\n      default: throw e;\n    }\n  }\n}", 2112},
		{"run value", "function main(job: Effect.Effect<number>) { job }", "Call it to run it", "function main(job: Effect.Effect<number>) { job() }", 4801},
		{"run program by name", "export function main() { Console.log(\"before\"); interrupt }", "Call it to run it", "export function main() { Console.log(\"before\"); interrupt() }", 4801},
		{"run conditional", "function main(flag: boolean, a: Effect.Effect<number>, b: Effect.Effect<number>) { flag ? a : b }", "Call it to run it", "function main(flag: boolean, a: Effect.Effect<number>, b: Effect.Effect<number>) { (flag ? a : b)() }", 4801},
		{"return value", "function main(job: Effect.Effect<number>) { Effect.succeed(0); return job }", "Call it to run it", "function main(job: Effect.Effect<number>) { Effect.succeed(0); return job() }", 4802},
		{"return conditional", "function main(flag: boolean, a: Effect.Effect<number>, b: Effect.Effect<number>) { Effect.succeed(0); return flag ? a : b }", "Call it to run it", "function main(flag: boolean, a: Effect.Effect<number>, b: Effect.Effect<number>) { Effect.succeed(0); return (flag ? a : b)() }", 4802},
		{"return conditional arm", "function main(flag: boolean, job: Effect.Effect<number>) { return flag ? job : Effect.succeed(1) }", "Call it to run it", "function main(flag: boolean, job: Effect.Effect<number>) { return flag ? job() : Effect.succeed(1) }", 4802},
		{"return value as unknown", "function main(job: Effect.Effect<number>): unknown!! { return job }", "Call it to run it", "function main(job: Effect.Effect<number>): unknown!! { return job() }", 4802},
		{"return program by name as unknown", "function main(job: () => number!!): unknown!! { return job }", "Call it to run it", "function main(job: () => number!!): unknown!! { return job() }", 4802},
		{"return coalesced operand", "function main(n: number | undefined, job: Effect.Effect<number>) { Effect.succeed(0); return n ?? job }", "Call it to run it", "function main(n: number | undefined, job: Effect.Effect<number>) { Effect.succeed(0); return n ?? job() }", 4802},
		{"retain failure contract", `function main(job: Effect.Effect<number, string>) { const narrow = job as Effect.Effect<number>; return narrow() }`, "Remove the assertion", `function main(job: Effect.Effect<number, string>) { const narrow = job; return narrow() }`, 4810},
		{"Effect 4 name", `function main() { return Effect.catchAll(Effect.fail("bad"), () => Effect.succeed(1)) }`, "Write Effect.catch", `function main() { return Effect.catch(Effect.fail("bad"), () => Effect.succeed(1)) }`, 4813},
		{"empty pipe", "// @vibelang-diagnostics EK4824:warning\nexport const value = pipe(1)", "Remove the pipe", "// @vibelang-diagnostics EK4824:warning\nexport const value = 1", 4824},
		{"arrow expression", "// @vibelang-diagnostics EK4823:warning\nexport const add = (x: number) => { return x + 1 }", "Write the value as the body", "// @vibelang-diagnostics EK4823:warning\nexport const add = (x: number) => x + 1", 4823},
		{"arrow object", "// @vibelang-diagnostics EK4823:warning\nexport const box = (x: number) => { return { value: x } }", "Write the value as the body", "// @vibelang-diagnostics EK4823:warning\nexport const box = (x: number) => ({ value: x })", 4823},
		{"return type of a passed helper", "function twice(n: number) { return n * 2 }\nexport const doubled = [1, 2].map(twice)", "Write the return type of twice: number", "function twice(n: number): number { return n * 2 }\nexport const doubled = [1, 2].map(twice)", 4301},
		{"return type of a helper a callback calls", "const inc = (n: number) => n + 1\nexport const bumped = [1, 2].map((n) => inc(n))", "Write the return type of inc: number", "const inc = (n: number): number => n + 1\nexport const bumped = [1, 2].map((n) => inc(n))", 4301},
		{"return type of a helper at a top level", "function label(n: number) { return `#${n}` }\nexport const first = label(1)", "Write the return type of label: string", "function label(n: number): string { return `#${n}` }\nexport const first = label(1)", 1001},
		{"return type of a helper and its own", "function half(n: number) { return n / 2 }\nfunction quarter(n: number) { return half(half(n)) }\nexport function plain(n: number): number { return quarter(n) }", "Write the return type of quarter: number", "function half(n: number): number { return n / 2 }\nfunction quarter(n: number): number { return half(half(n)) }\nexport function plain(n: number): number { return quarter(n) }", 9203},
		{"return type through a name in scope", "namespace Store {\n  export interface Ref<A> { readonly target: A }\n  export const ref = (id: string): Ref<string> => ({ target: id })\n}\nconst refOf = (id: string) => Store.ref(id)\nexport const refs = [\"a\"].map(refOf)", "Write the return type of refOf: Store.Ref<string>", "namespace Store {\n  export interface Ref<A> { readonly target: A }\n  export const ref = (id: string): Ref<string> => ({ target: id })\n}\nconst refOf = (id: string): Store.Ref<string> => Store.ref(id)\nexport const refs = [\"a\"].map(refOf)", 4301},
		{"long return type as infer", "const pairs = (n: number) => ({ id: n, label: `#${n}`, next: n + 1, prev: n - 1, tags: [String(n)] })\nexport const made = pairs(1)", "Write the return type of pairs: infer _", "const pairs = (n: number): infer _ => ({ id: n, label: `#${n}`, next: n + 1, prev: n - 1, tags: [String(n)] })\nexport const made = pairs(1)", 1001},
		{"error field comma", "error OutOfStock { sku: string, available: number }", "Write ; for the comma", "error OutOfStock { sku: string; available: number }", 1013},
		{"schema error field comma", "schema error Bad { sku: string,\n  reason: string }", "Write ; for the comma", "schema error Bad { sku: string;\n  reason: string }", 1013},
		{"service field comma", "service Stock { region: string, count(): number!! }", "Write ; for the comma", "service Stock { region: string; count(): number!! }", 1013},
		{"schema field comma", "schema Draft { readonly title: string, readonly count: number }", "Write ; for the comma", "schema Draft { readonly title: string; readonly count: number }", 1013},
		{"data field comma", "data Shape { Rect { width: number, height: number } }", "Write ; for the comma", "data Shape { Rect { width: number; height: number } }", 1013},
		{"data variant comma", "data Answer { Yes, No }", "Write ; for the comma", "data Answer { Yes; No }", 1013},
		{"tagged schema", `// @vibelang-diagnostics EK4821:warning
export const Person = Schema.Struct({ _tag: Schema.Literal("Person"), name: Schema.String })`, "Write Schema.TaggedStruct", `// @vibelang-diagnostics EK4821:warning
export const Person = Schema.TaggedStruct("Person", { name: Schema.String })`, 4821},
	} {
		t.Run(test.name, func(t *testing.T) {
			const prefix = "// café 😀\n"
			program, file, service, converters := editorProgram(t, prefix+test.source)
			var diagnostic *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
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
	source := "export function main(job: Effect.Effect<number> | undefined): unknown!! { const chosen = job; return chosen }"
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
			if action.CodeAction != nil && action.CodeAction.Title == "Call it to run it" {
				t.Fatal("offered Call it to run it for a union with undefined")
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
