package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VIP-17 uses native Fiber values; the retired region escape diagnostic
// must not appear on returns, storage, calls or captures.
func TestFiberFlows(t *testing.T) {
	const prefix = "effect function one() { try sleep(1); return 1 }\nfunction keep(f: Fiber<number>) {}\nlet outer: Fiber<number> | undefined\n"
	for _, test := range []struct {
		name, source string
	}{
		{"returned", "export effect function fib() { return fork one() }"},
		{"returned binding", "export effect function fib() { const f = fork one(); return f }"},
		{"returned let alias", "export effect function fib() { let f = fork one(); const g = f; return g }"},
		{"returned in an object", "export effect function fib() { const f = fork one(); return { f } }"},
		{"returned in an array", "export effect function fib() { return [fork one()] }"},
		{"returned through a conditional", "export effect function fib(b: boolean) { const f = fork one(); return b ? f : undefined }"},
		{"arrow body", "export const fib = effect () => fork one()"},
		{"arrow body call form", "export const fib = effect () => fork(one())"},
		{"if branch owns nothing", "export effect function fib(b: boolean) { if (b) { const f = fork one(); return f } return undefined }"},
		{"assigned outside", "export effect function fib() { outer = fork one() }"},
		{"assigned outside a loop iteration", "export effect function fib() { let last; for (const n of [1]) { last = fork one() } return 0 }"},
		{"assigned to a property", "export effect function fib(o: { mutable f?: Fiber<number> }) { o.f = fork one() }"},
		{"var", "export effect function fib() { var f = fork one(); return join f }"},
		{"stored in an array", "export effect function fib() { const f = fork one(); const all = [f]; return 0 }"},
		{"passed to a call", "export effect function fib() { keep(fork one()) }"},
		{"passed through a binding", "export effect function fib() { const f = fork one(); keep(f) }"},
		{"Fiber function returning a Fiber", "export effect function fib() { const scope = Scope.make(); const f = fork one(); Fiber.runIn(f, scope); return 0 }"},
		{"captured", "export effect function fib() { const f = fork one(); return () => f }"},
		{"captured though not returned", "export effect function fib() { const f = fork one(); const read = () => f; return join read() }"},
		{"captured by an explicit Effect function", "export effect function fib() { const f = fork one(); return withSpan(effect () => { return join f }, \"s\") }"},
		{"discarded", "export effect function fib() { fork one(); return 0 }"},
		{"joined", "export effect function fib() { const f = fork one(); return join f }"},
		{"joined in an array", "export effect function fib() { const a = fork one(); const b = fork one(); return join [a, b] }"},
		{"joined in an object", "export effect function fib() { const a = fork one(); return join { a } }"},
		{"joined through a held array", "export effect function fib() { const a = fork one(); const all = [a]; return join all }"},
		{"held object's getter", "export effect function fib() { const a = fork one(); const tasks = { get a() { return a } }; return join tasks }"},
		{"held array also read otherwise", "export effect function fib() { const a = fork one(); const all = [a]; const n = all.length; return join all }"},
		{"held object returned", "export effect function fib() { const a = fork one(); const box = { a }; return box }"},
		{"held object's method", "export effect function fib() { const a = fork one(); const tasks = { read() { return a } }; return join tasks }"},
		{"let reassigned", "export effect function fib() { let f = fork one(); f = fork one(); return join f }"},
		{"Fiber functions", "export effect function fib() { const f = fork one(); Fiber.interrupt(f); return Fiber.await(f) }"},
		{"Fiber function over an array", "export effect function fib() { const a = fork one(); const b = fork one(); Fiber.interruptAll([a, b]); return 0 }"},
		{"Fiber method", "export effect function fib() { const f = fork one(); f.interrupt(); return 0 }"},
		{"fork operand", "export effect function fib() { const f = fork one(); const g = fork { join f }; return join g }"},
		{"await element", "export effect function fib() { const f = fork one(); return await.race [join f, do { sleep(5); 0 }] }"},
		{"do block value", "export effect function fib() { const f = do { fork one() }; return join f }"},
		{"comma", "export const fib = effect () => (fork one(), 0)"},
		{"piped to a Fiber function", "export effect function fib() { const f = fork one(); return f |> Fiber.join(%) }"},
		{"piped fork", "export effect function fib() { return fork one() |> Fiber.join(%) }"},
		{"piped through a nested pipe", "export effect function fib() { const f = fork one(); return f |> (% |> Fiber.join(%)) }"},
		{"piped and discarded", "export effect function fib() { const f = fork one(); f |> 0; return join f }"},
		{"piped to a call", "export effect function fib() { const f = fork one(); f |> keep(%); return 0 }"},
		{"piped into a function", "export effect function fib() { const f = fork one(); return f |> (() => %) }"},
		{"detached", "export effect function fib() { return detach(one()) }"},
		{"forkScoped", "export effect function fib() { return Effect.forkScoped(one()) }"},
		{"not lowered by a setting", "// @vibelang-diagnostics EK4838:off\nexport effect function fib() { return fork one() }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, prefix+test.source)
			var found []*ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK4838.Code {
					found = append(found, d)
				}
			}
			if len(found) != 0 {
				t.Fatalf("native current-fiber ownership rejected an ordinary Fiber use: %s", diagnosticWithNotes(found[0]))
			}

		})
	}
}

// A stale legacy diagnostic in an editor cannot choose a different owner.
func TestFiberFlowFixes(t *testing.T) {
	for _, source := range []string{
		"effect function one(){return 1}\nexport effect function main(){return fork one()}",
		"effect function one(){return 1}\nexport const main=effect ()=>fork one()",
		"effect function one(){return 1}\nexport effect function main(){return fork {try one()}}",
		"effect function one(){return 1}\nlet saved:unknown\nexport effect function main(){saved=fork one();return 7}",
	} {
		for _, crlf := range []bool{false, true} {
			s := source
			if crlf {
				s = strings.ReplaceAll(s, "\n", "\r\n")
			}
			t.Run(s, func(t *testing.T) {
				program, file, service, converters := editorProgram(t, s)
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Code() == EK4838.Code {
						t.Fatalf("obsolete ownership diagnostic: %s", d.String())
					}
				}
				pos := strings.Index(s, "fork")
				if pos < 0 {
					t.Fatal("missing stale diagnostic site")
				}
				stale := ast.NewExternalDiagnostic(file, core.NewTextRange(pos, pos+4), diagnosticSource, EK4838.Category, EK4838.Code, format(EK4838.Text, []any{"the old region", "retained"}))
				d := lsconv.DiagnosticToLSPPush(t.Context(), converters, stale)
				only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
				response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
					TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
					Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
				})
				if err != nil {
					t.Fatal(err)
				}
				if response.CommandOrCodeActionArray != nil {
					for _, item := range *response.CommandOrCodeActionArray {
						if a := item.CodeAction; a != nil && a.Edit != nil && a.Edit.Changes != nil && len(*a.Edit.Changes) > 0 {
							t.Errorf("legacy diagnostic changed lifetime: %s", a.Title)
						}
					}
				}
			})
		}
	}
}

// The current fiber owns keyword fork in each transparent source region.
func TestForkRegions(t *testing.T) {
	for _, test := range []struct {
		name, source string
	}{
		{"function body", "effect function f() { fork one() }"},
		{"arrow body", "const f = effect () => fork one()"},
		{"if branch", "effect function f(b: boolean) { if (b) { fork one() } }"},
		{"if without braces", "effect function f(b: boolean) { if (b) fork one() }"},
		{"bare block", "effect function f() { { fork one() } }"},
		{"do block", "effect function f() { const x = do { fork one(); 1 }; return x }"},
		{"loop body", "effect function f() { for (const n of [1]) { fork one() } }"},
		{"loop body without braces", "effect function f() { for (const n of [1]) fork one() }"},
		{"try block", "effect function f() { try { fork one() } finally { } }"},
		{"using block", "effect function f(b: boolean) { if (b) { using t = { [Symbol.dispose]() {} }; fork one() } }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "effect function one() { try sleep(1); return 1 }\n" + test.source
			program, file, _, _ := editorProgram(t, source)
			program.GetSemanticDiagnostics(t.Context(), file)
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			a := analyzerFor(c)
			forks := 0
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsCallExpression(n) && a.isPreludeFork(n) {
					forks++
					if !isNativeFork(n) || a.getsScope(n) {
						t.Fatal("keyword fork received a lexical resource owner")
					}
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if forks != 1 {
				t.Fatalf("found %d keyword forks, want 1", forks)
			}

		})
	}
}
