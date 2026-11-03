package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// D409: the value an owned fork gives may go only to a const or let of its
// region, join, interrupt, a Fiber function whose result holds no Fiber and
// its methods, or a fork operand, await element, or for concurrent body in
// the region. Anywhere else is EK4838, an error no setting lowers (D386).
func TestFiberFlows(t *testing.T) {
	const prefix = "effect function one() { try sleep(1); return 1 }\nfunction keep(f: Fiber<number>) {}\nlet outer: Fiber<number> | undefined\n"
	for _, test := range []struct {
		name, source, how string // how is "" for no EK4838
	}{
		{"returned", "export effect function fib() { return fork one() }", "returned from that body"},
		{"returned binding", "export effect function fib() { const f = fork one(); return f }", "returned from that body"},
		{"returned let alias", "export effect function fib() { let f = fork one(); const g = f; return g }", "returned from that body"},
		{"returned in an object", "export effect function fib() { const f = fork one(); return { f } }", "returned from that body in an object"},
		{"returned in an array", "export effect function fib() { return [fork one()] }", "returned from that body in an array"},
		{"returned through a conditional", "export effect function fib(b: boolean) { const f = fork one(); return b ? f : undefined }", "returned from that body"},
		{"arrow body", "export const fib = effect () => fork one()", "returned from that body"},
		{"arrow body call form", "export const fib = effect () => fork(one())", "returned from that body"},
		{"if branch owns nothing", "export effect function fib(b: boolean) { if (b) { const f = fork one(); return f } return undefined }", "returned from that body"},
		{"assigned outside", "export effect function fib() { outer = fork one() }", "assigned to outer, which outlives that body"},
		{"assigned outside a loop iteration", "export effect function fib() { let last; for (const n of [1]) { last = fork one() } return 0 }", "assigned to last, which outlives that iteration"},
		{"assigned to a property", "export effect function fib(o: { mutable f?: Fiber<number> }) { o.f = fork one() }", "assigned to o.f, which outlives that body"},
		{"var", "export effect function fib() { var f = fork one(); return join f }", "held in var f"},
		{"stored in an array", "export effect function fib() { const f = fork one(); const all = [f]; return 0 }", "stored in an array"},
		{"passed to a call", "export effect function fib() { keep(fork one()) }", "passed to keep, which may keep it"},
		{"passed through a binding", "export effect function fib() { const f = fork one(); keep(f) }", "passed to keep, which may keep it"},
		{"Fiber function returning a Fiber", "export effect function fib() { const scope = Scope.make(); const f = fork one(); Fiber.runIn(f, scope); return 0 }", "passed to Fiber.runIn, which may keep it"},
		{"captured", "export effect function fib() { const f = fork one(); return () => f }", "captured by a function"},
		{"captured though not returned", "export effect function fib() { const f = fork one(); const read = () => f; return join read() }", "captured by a function"},
		{"captured by an explicit Effect function", "export effect function fib() { const f = fork one(); return withSpan(effect () => { return join f }, \"s\") }", "captured by a function"},
		{"discarded", "export effect function fib() { fork one(); return 0 }", ""},
		{"joined", "export effect function fib() { const f = fork one(); return join f }", ""},
		{"joined in an array", "export effect function fib() { const a = fork one(); const b = fork one(); return join [a, b] }", ""},
		{"joined in an object", "export effect function fib() { const a = fork one(); return join { a } }", ""},
		{"joined through a held array", "export effect function fib() { const a = fork one(); const all = [a]; return join all }", ""},
		{"held object's getter", "export effect function fib() { const a = fork one(); const tasks = { get a() { return a } }; return join tasks }", "captured by a function"},
		{"held array also read otherwise", "export effect function fib() { const a = fork one(); const all = [a]; const n = all.length; return join all }", "stored in an array"},
		{"held object returned", "export effect function fib() { const a = fork one(); const box = { a }; return box }", "stored in an object"},
		{"held object's method", "export effect function fib() { const a = fork one(); const tasks = { read() { return a } }; return join tasks }", "captured by a function"},
		{"let reassigned", "export effect function fib() { let f = fork one(); f = fork one(); return join f }", ""},
		{"Fiber functions", "export effect function fib() { const f = fork one(); Fiber.interrupt(f); return Fiber.await(f) }", ""},
		{"Fiber function over an array", "export effect function fib() { const a = fork one(); const b = fork one(); Fiber.interruptAll([a, b]); return 0 }", ""},
		{"Fiber method", "export effect function fib() { const f = fork one(); f.interrupt(); return 0 }", ""},
		{"fork operand", "export effect function fib() { const f = fork one(); const g = fork { join f }; return join g }", ""},
		{"await element", "export effect function fib() { const f = fork one(); return await.race [join f, do { sleep(5); 0 }] }", ""},
		{"do block value", "export effect function fib() { const f = do { fork one() }; return join f }", ""},
		{"comma", "export const fib = effect () => (fork one(), 0)", ""},
		{"piped to a Fiber function", "export effect function fib() { const f = fork one(); return f |> Fiber.join(%) }", ""},
		{"piped fork", "export effect function fib() { return fork one() |> Fiber.join(%) }", ""},
		{"piped through a nested pipe", "export effect function fib() { const f = fork one(); return f |> (% |> Fiber.join(%)) }", ""},
		{"piped and discarded", "export effect function fib() { const f = fork one(); f |> 0; return join f }", ""},
		{"piped to a call", "export effect function fib() { const f = fork one(); f |> keep(%); return 0 }", "passed to keep, which may keep it"},
		{"piped into a function", "export effect function fib() { const f = fork one(); return f |> (() => %) }", "captured by a function"},
		{"detached", "export effect function fib() { return detach(one()) }", ""},
		{"forkScoped", "export effect function fib() { return Effect.forkScoped(one()) }", ""},
		{"not lowered by a setting", "// @vibelang-diagnostics EK4838:off\nexport effect function fib() { return fork one() }", "returned from that body"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, prefix+test.source)
			var found []*ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK4838.Code {
					found = append(found, d)
				}
			}
			if test.how == "" {
				if len(found) != 0 {
					t.Fatalf("unexpected EK4838: %s", diagnosticWithNotes(found[0]))
				}
				return
			}
			if len(found) != 1 {
				t.Fatalf("got %d EK4838, want 1", len(found))
			}
			d := found[0]
			text := diagnosticWithNotes(d)
			if d.Category() != diagnostics.CategoryError {
				t.Errorf("not an error: %s", text)
			}
			if !strings.Contains(text, "which interrupts it on exit, but it is "+test.how) {
				t.Errorf("missing %q: %s", test.how, text)
			}
			if !strings.Contains(text, "Effect.forkScoped(") || !strings.Contains(text, "detach(") || !strings.Contains(text, "forkIn(scope, ") {
				t.Errorf("missing lifetime guidance: %s", text)
			}
		})
	}
}

// D386: the quick fix gives the fiber the caller's lifetime or no owner.
func TestFiberFlowFixes(t *testing.T) {
	const prefix = "effect function one() { try sleep(1); return 1 }\n"
	for _, test := range []struct{ name, source, title, want string }{
		{"forkScoped", "export effect function fib() { return fork one() }", "Write Effect.forkScoped to give the fiber the caller's lifetime", "export effect function fib() { return Effect.forkScoped(one()) }"},
		{"detach", "export effect function fib() { return fork one() }", "Write detach to give the fiber no owner", "export effect function fib() { return detach(one()) }"},
		{"arrow body", "export const fib = effect () => fork one()", "Write Effect.forkScoped to give the fiber the caller's lifetime", "export const fib = effect () => Effect.forkScoped(one())"},
		{"fork block", "export effect function fib() { return fork { try one() } }", "Write detach to give the fiber no owner", "export effect function fib() { return detach(effect { try one() }) }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, prefix+test.source)
			var diagnostic *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK4838.Code {
					diagnostic = d
				}
			}
			if diagnostic == nil {
				t.Fatalf("missing EK4838 in %s", test.source)
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
			got := applyEditorEdits(t, file, converters, (*chosen.Edit.Changes)[lsconv.FileNameToDocumentURI(file.FileName())])
			if got != prefix+test.want {
				t.Fatalf("got %s\nwant %s", got, prefix+test.want)
			}
			checked, edited, _, _ := editorProgram(t, got)
			for _, after := range checked.GetSemanticDiagnostics(t.Context(), edited) {
				if after.Category() == diagnostics.CategoryError {
					t.Errorf("the fix left an error: %s", after.String())
				}
			}
		})
	}
}

// D408: a fiber belongs to the innermost region the source names, so an if
// branch, a bare block, and a do block own nothing, and a loop body owns
// each iteration's forks with or without braces.
func TestForkRegions(t *testing.T) {
	for _, test := range []struct {
		name, source, region string // region is the source text of the owner, or the function's name with "body"
	}{
		{"function body", "effect function f() { fork one() }", "f body"},
		{"arrow body", "const f = effect () => fork one()", "fork one()"},
		{"if branch", "effect function f(b: boolean) { if (b) { fork one() } }", "f body"},
		{"if without braces", "effect function f(b: boolean) { if (b) fork one() }", "f body"},
		{"bare block", "effect function f() { { fork one() } }", "f body"},
		{"do block", "effect function f() { const x = do { fork one(); 1 }; return x }", "f body"},
		{"loop body", "effect function f() { for (const n of [1]) { fork one() } }", "{ fork one() }"},
		{"loop body without braces", "effect function f() { for (const n of [1]) fork one() }", "fork one()"},
		{"try block", "effect function f() { try { fork one() } finally { } }", "{ fork one() }"},
		{"using block", "effect function f(b: boolean) { if (b) { using t = { [Symbol.dispose]() {} }; fork one() } }", "{ using t = { [Symbol.dispose]() {} }; fork one() }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "effect function one() { try sleep(1); return 1 }\n" + test.source
			program, file, _, _ := editorProgram(t, source)
			program.GetSemanticDiagnostics(t.Context(), file)
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			a := analyzerFor(c)
			var owner *ast.Node
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsCallExpression(n) && a.isPreludeFork(n) {
					owner = a.forkOwner(n)
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if owner == nil {
				t.Fatal("the fork has no owner")
			}
			got := strings.TrimSpace(nodeText(file, owner))
			if strings.HasSuffix(test.region, " body") {
				fn := owner.Parent
				if !isFunctionBoundary(fn) || functionName(fn)+" body" != test.region {
					t.Fatalf("owner %q, want %s", got, test.region)
				}
				return
			}
			if got != test.region {
				t.Fatalf("owner %q, want %q", got, test.region)
			}
		})
	}
}
