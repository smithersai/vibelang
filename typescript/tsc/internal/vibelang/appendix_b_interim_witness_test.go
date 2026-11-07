package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Appendix B: EK4807 — spec-rule: docs/design/src/900-appendices.md#bda755bd1c4349fd
// Layer.mergeAll of a layer that needs another is a warning. Neither its
// text nor any editor quick fix applies the historical wire repair: the
// dependency is composed explicitly.
func TestInterimEK4807OffersNoWireRepair(t *testing.T) {
	const source = "service Directory { lookup(id: string): string!! }\n" +
		"service Users { find(id: string): string!! }\n" +
		"const DirectoryLive = Layer.succeed(Directory, { effect lookup(id) { return id } })\n" +
		"const UsersLive = Layer.effect(Users, effect { const directory = try Directory; return { effect find(id) { return try directory.lookup(id) } } })\n" +
		"export const AppLive = Layer.mergeAll(DirectoryLive, UsersLive)\n"
	program, file, service, converters := editorProgram(t, source)
	var found *ast.Diagnostic
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == EK4807.Code {
			found = d
		}
	}
	if found == nil {
		t.Fatal("Layer.mergeAll of a dependent layer reports no EK4807")
	}
	if found.Category() != warningCategory {
		t.Fatalf("EK4807 category = %v, want warning", found.Category())
	}
	if text := diagnosticWithNotes(found); strings.Contains(text, "wire") {
		t.Fatalf("EK4807 advises the historical wire repair: %s", text)
	}
	d := lsconv.DiagnosticToLSPPush(t.Context(), converters, found)
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
			a := item.CodeAction
			if a == nil {
				continue
			}
			if strings.Contains(a.Title, "wire") {
				t.Fatalf("EK4807 quick fix offers the wire repair: %s", a.Title)
			}
			if a.Edit != nil && a.Edit.Changes != nil {
				for _, edits := range *a.Edit.Changes {
					for _, e := range edits {
						if strings.Contains(e.NewText, "wire") {
							t.Fatalf("EK4807 quick fix %q writes wire: %s", a.Title, e.NewText)
						}
					}
				}
			}
		}
	}
	span := core.NewTextRange(found.Pos(), found.End())
	actions, err := mergeAllFix.GetCodeActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: span, ErrorCode: EK4807.Code, Program: program, LS: service})
	if err != nil || len(actions) != 0 {
		t.Fatalf("EK4807's registered provider returns a repair: %+v %v", actions, err)
	}
}

// Appendix B: EK4819 — spec-rule: docs/design/src/900-appendices.md#8883ec3ff2a18963
// EK4819 is an error-category code that only an editor's repair request
// names: requesting it for yield of an Effect in a TypeScript generator
// writes yield*. typescript/vibelang/cases/cov-ch900b-ek4819.fail checks that
// compiling that TypeScript reports no EK4819.
func TestInterimEK4819EditorRepairOnly(t *testing.T) {
	if EK4819.Category != errorCategory || EK4819.Off || registry[EK4819.Code] != EK4819 {
		t.Fatalf("EK4819 registry entry = %+v, want a registered error", EK4819)
	}
	const source = "import {Effect} from 'effect'; export function* g() { yield Effect.succeed(1) }"
	program, original, service, converters := editorProgram(t, source)
	filename := filepath.Join(filepath.Dir(original.FileName().AsString()), "main.ts")
	if err := os.WriteFile(filename, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	file := parser.ParseSourceFile(astSourceOptions(filename), source, core.ScriptKindTS)
	ast.SetParentInChildren(file.AsNode())
	start := strings.Index(source, "yield")
	var yieldNode *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsYieldExpression(n) {
			yieldNode = n
			return true
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if yieldNode == nil || scanner.GetTokenPosOfNode(yieldNode, file, false) != start {
		t.Fatal("fixture has no yield at the expected position")
	}
	span := scanner.GetErrorRangeForNode(file, yieldNode)
	actions, err := yieldStarFix.GetCodeActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: span, ErrorCode: EK4819.Code, Program: program, LS: service})
	if err != nil || len(actions) != 1 {
		t.Fatalf("EK4819 repair request: %+v %v", actions, err)
	}
	want := "import {Effect} from 'effect'; export function* g() { yield* Effect.succeed(1) }"
	if got := applyEditorEdits(t, file, converters, actions[0].Changes); got != want {
		t.Fatalf("EK4819 repair wrote %s; want %s", got, want)
	}
}

// Appendix B: EK4838 — spec-rule: docs/design/src/900-appendices.md#db3839c2a55d4973
// EK4838 remains a registered error for persisted editor diagnostics, but
// the compiler no longer runs the legacy ownership analysis: a Fiber that
// leaves its fork region by return or storage reports no EK4838.
func TestInterimEK4838RetainedNotEmitted(t *testing.T) {
	if EK4838.Category != errorCategory || EK4838.Off || registry[EK4838.Code] != EK4838 {
		t.Fatalf("EK4838 registry entry = %+v, want a registered error", EK4838)
	}
	const prefix = "effect function one() { try sleep(1); return 1 }\nlet outer: Fiber<number> | undefined\n"
	for _, source := range []string{
		"export effect function fib() { return fork one() }",
		"export effect function fib() { outer = fork one(); return 0 }",
	} {
		program, file, _, _ := editorProgram(t, prefix+source)
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() == EK4838.Code {
				t.Fatalf("%s: legacy ownership analysis reported %s", source, diagnosticWithNotes(d))
			}
		}
	}
}
