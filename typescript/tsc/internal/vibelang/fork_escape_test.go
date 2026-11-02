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
	const prefix = "function one() { sleep(1); return 1 }\nfunction keep(f: Fiber<number>) {}\nlet outer: Fiber<number> | undefined\n"
	for _, test := range []struct {
		name, source, how string // how is "" for no EK4838
	}{
		{"returned", "export function fib() { return fork one() }", "returned from that body"},
		{"returned binding", "export function fib() { const f = fork one(); return f }", "returned from that body"},
		{"returned let alias", "export function fib() { let f = fork one(); const g = f; return g }", "returned from that body"},
		{"returned in an object", "export function fib() { const f = fork one(); return { f } }", "returned from that body in an object"},
		{"returned in an array", "export function fib() { return [fork one()] }", "returned from that body in an array"},
		{"returned through a conditional", "export function fib(b: boolean) { const f = fork one(); return b ? f : undefined }", "returned from that body"},
		{"arrow body", "export const fib = () => fork one()", "returned from that body"},
		{"arrow body call form", "export const fib = () => fork(one())", "returned from that body"},
		{"if branch owns nothing", "export function fib(b: boolean) { if (b) { const f = fork one(); return f } return undefined }", "returned from that body"},
		{"assigned outside", "export function fib() { outer = fork one() }", "assigned to outer, which outlives that body"},
		{"assigned outside a loop iteration", "export function fib() { let last; for (const n of [1]) { last = fork one() } return 0 }", "assigned to last, which outlives that iteration"},
		{"assigned to a property", "export function fib(o: { mutable f?: Fiber<number> }) { o.f = fork one() }", "assigned to o.f, which outlives that body"},
		{"var", "export function fib() { var f = fork one(); return join f }", "held in var f"},
		{"stored in an array", "export function fib() { const f = fork one(); const all = [f]; return 0 }", "stored in an array"},
		{"passed to a call", "export function fib() { keep(fork one()) }", "passed to keep, which may keep it"},
		{"passed through a binding", "export function fib() { const f = fork one(); keep(f) }", "passed to keep, which may keep it"},
		{"Fiber function returning a Fiber", "export function fib() { const scope = Scope.make(); const f = fork one(); Fiber.runIn(f, scope); return 0 }", "passed to Fiber.runIn, which may keep it"},
		{"captured", "export function fib() { const f = fork one(); return () => f }", "captured by a function"},
		{"captured though not returned", "export function fib() { const f = fork one(); const read = () => f; return join read() }", "captured by a function"},
		{"captured by a block param", "export function fib() { const f = fork one(); return withSpan(\"s\") { return join f } }", "captured by a block param"},
		{"discarded", "export function fib() { fork one(); return 0 }", ""},
		{"joined", "export function fib() { const f = fork one(); return join f }", ""},
		{"joined in an array", "export function fib() { const a = fork one(); const b = fork one(); return join [a, b] }", ""},
		{"joined in an object", "export function fib() { const a = fork one(); return join { a } }", ""},
		{"joined through a held array", "export function fib() { const a = fork one(); const all = [a]; return join all }", ""},
		{"held object's getter", "export function fib() { const a = fork one(); const tasks = { get a() { return a } }; return join tasks }", "captured by a function"},
		{"held array also read otherwise", "export function fib() { const a = fork one(); const all = [a]; const n = all.length; return join all }", "stored in an array"},
		{"held object returned", "export function fib() { const a = fork one(); const box = { a }; return box }", "stored in an object"},
		{"held object's method", "export function fib() { const a = fork one(); const tasks = { read() { return a } }; return join tasks }", "captured by a function"},
		{"let reassigned", "export function fib() { let f = fork one(); f = fork one(); return join f }", ""},
		{"Fiber functions", "export function fib() { const f = fork one(); Fiber.interrupt(f); return Fiber.await(f) }", ""},
		{"Fiber function over an array", "export function fib() { const a = fork one(); const b = fork one(); Fiber.interruptAll([a, b]); return 0 }", ""},
		{"Fiber method", "export function fib() { const f = fork one(); f.interrupt(); return 0 }", ""},
		{"fork operand", "export function fib() { const f = fork one(); const g = fork { join f }; return join g }", ""},
		{"await element", "export function fib() { const f = fork one(); return await.race [join f, do { sleep(5); 0 }] }", ""},
		{"do block value", "export function fib() { const f = do { fork one() }; return join f }", ""},
		{"comma", "export const fib = () => (fork one(), 0)", ""},
		{"detached", "export function fib() { return detach(() => one()) }", ""},
		{"forkScoped", "export function fib() { return Effect.forkScoped(() => one()) }", ""},
		{"not lowered by a setting", "// @vibelang-diagnostics EK4838:off\nexport function fib() { return fork one() }", "returned from that body"},
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
	const prefix = "function one() { sleep(1); return 1 }\n"
	for _, test := range []struct{ name, source, title, want string }{
		{"forkScoped", "export function fib() { return fork one() }", "Write Effect.forkScoped to give the fiber the caller's lifetime", "export function fib() { return Effect.forkScoped(() => one()) }"},
		{"detach", "export function fib() { return fork one() }", "Write detach to give the fiber no owner", "export function fib() { return detach(() => one()) }"},
		{"arrow body", "export const fib = () => fork one()", "Write Effect.forkScoped to give the fiber the caller's lifetime", "export const fib = () => Effect.forkScoped(() => one())"},
		{"fork block", "export function fib() { return fork { one() } }", "Write detach to give the fiber no owner", "export function fib() { return detach(() => { one() }) }"},
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
		{"function body", "function f() { fork one() }", "f body"},
		{"arrow body", "const f = () => fork one()", "fork one()"},
		{"if branch", "function f(b: boolean) { if (b) { fork one() } }", "f body"},
		{"if without braces", "function f(b: boolean) { if (b) fork one() }", "f body"},
		{"bare block", "function f() { { fork one() } }", "f body"},
		{"do block", "function f() { const x = do { fork one(); 1 }; return x }", "f body"},
		{"loop body", "function f() { for (const n of [1]) { fork one() } }", "{ fork one() }"},
		{"loop body without braces", "function f() { for (const n of [1]) fork one() }", "fork one()"},
		{"try block", "function f() { try { fork one() } finally { } }", "{ fork one() }"},
		{"using block", "function f(b: boolean) { if (b) { using t = { [Symbol.dispose]() {} }; fork one() } }", "{ using t = { [Symbol.dispose]() {} }; fork one() }"},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := "function one() { sleep(1); return 1 }\n" + test.source
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
