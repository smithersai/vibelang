package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
	"strings"
	"testing"
)

func TestSchemaTupleRestBindingGuard(t *testing.T) {
	for _, name := range []string{"Array", "ReadonlyArray"} {
		for _, tuple := range []string{
			"[...%s<number>]",
			"readonly [...%s<number>]",
			"[...items:%s<number>]",
			"[...[...%s<number>]]",
			"readonly [...%s<number>,boolean]",
			"readonly [...[...%s<number>],...[string?]]",
			"[...%s<globalThis.Array<number>>]",
		} {
			source := "type " + name + "<T>={value:T};schema S=" + strings.ReplaceAll(tuple, "%s", name)
			t.Run(name+tuple, func(t *testing.T) {
				p, f, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					count++
					if d.Code() != EK2109.Code {
						t.Errorf("unexpected %s", d.String())
					}
				}
				if count != 1 {
					t.Fatalf("errors%d,want1", count)
				}
			})
		}
	}
}

func TestSchemaTupleRestBindingRename(t *testing.T) {
	packages := map[string]string{"effect": "packages/runtime/node_modules/effect", "vibelang-runtime": "packages/runtime", "bindings": "typescript/tsc/internal/vibelang/testdata/schema-generic-imports"}
	source := "import type {Sequence as Array} from \"bindings\";schema S=readonly [...Array<number>];"
	p, f, service, converters := editorProgramWith(t, source, packages)
	for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatal(d.String())
		}
	}
	uri := lsconv.FileNameToDocumentURI(f.FileName())
	pos, _ := converters.ToLSPPosition(f, core.TextPos(strings.LastIndex(source, "Array")))
	edits, err := service.ProvideRename(t.Context(), &lsproto.RenameParams{TextDocument: lsproto.TextDocumentIdentifier{Uri: uri}, Position: pos, NewName: "Sequence"}, nil)
	if err != nil || edits.WorkspaceEdit == nil || edits.WorkspaceEdit.Changes == nil {
		t.Fatalf("rename:%v %+v", err, edits)
	}
	after := applyEditorEdits(t, f, converters, (*edits.WorkspaceEdit.Changes)[uri])
	if !strings.Contains(after, "...Sequence<number>") {
		t.Fatalf("lost rest source reference:%s", after)
	}
	checked, next, _, _ := editorProgramWith(t, after, packages)
	for _, d := range append(checked.GetSyntacticDiagnostics(t.Context(), next), checked.GetSemanticDiagnostics(t.Context(), next)...) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("renaming a library alias adds error:%s\n%s", d.String(), after)
		}
	}
}

func TestSchemaTupleRestBindingQuickFix(t *testing.T) {
	for _, source := range []string{
		"type Array<T>={value:T};schema S=readonly [...Array<number>]",
		"type ReadonlyArray<T>={value:T};schema S=[...items:ReadonlyArray<number>]",
		"type Array<T>={value:T};schema S=readonly [string,...[...Array<number>],boolean]",
		"type Array<T>={value:T};schema S {value:readonly [...Array<number>]}",
	} {
		t.Run(source, func(t *testing.T) {
			fixed := applyQuickFixOf(t, "export {};\n"+source+"\n", EK2109.Code, diagnostics.CategoryError)
			if !strings.Contains(strings.Join(strings.Fields(fixed), ""), "Schema.TupleWithRest") {
				t.Fatalf("old repeating codec lost: %s", fixed)
			}
			p, f, _, _ := editorProgram(t, fixed)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source: %s\n%s", d.String(), fixed)
				}
			}
		})
	}
}
