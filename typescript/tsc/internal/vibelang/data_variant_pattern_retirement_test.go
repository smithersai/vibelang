package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VIP-7, chapter004: variant constructors are values, not class patterns.
func TestDataVariantClassPatternRetirement(t *testing.T) {
	for _, decl := range []struct{ name, source, matcher string }{
		{"direct", "data D { A; B { n:number } };", "D.A"},
		{"alias", "data D { A; B { n:number } };const Alias=D;", "Alias.A"},
		{"namespace", "namespace N {export data D { A; B { n:number } }};", "N.D.A"},
		{"generic", "data D<T> { A; B { n:T } };", "D.A"},
	} {
		for _, suffix := range []string{"", "()", "(let value)", " { }"} {
			for _, use := range []string{"match(x){when %s:1;default:0;}", "x is %s"} {
				source := decl.source + "export function f(x:unknown){return " + fmt.Sprintf(use, decl.matcher+suffix) + "}"
				t.Run(decl.name+suffix+use, func(t *testing.T) {
					program, file, _, _ := editorProgram(t, source)
					count := 0
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						if d.Source() == diagnosticSource && d.Code() == 702 {
							count++
						} else {
							t.Errorf("independent error: %s", d.String())
						}
					}
					if count != 1 {
						t.Fatalf("want one EK0702, got %d", count)
					}
				})
			}
		}
	}
}

func TestDataVariantClassPatternTagFix(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		{"bare", "data D { A; B { n:number } };export function f(x:unknown){return match(x){when D.A:1;default:0;}}", `when { _tag: "A" }:`},
		{"fields", "data D { A; B { n:number } };export function f(x:unknown){return match(x){when D.B { let n }:n;default:0;}}", `when { _tag: "B", let n }:`},
		{"is", "data D { A; B { n:number } };export function f(x:unknown){return x is D.A}", `x is { _tag: "A" }`},
		{"namespace", "namespace N { export data D { A; B { n:number } } };export function f(x:unknown){return match(x){when N.D.B { let n }:n;default:0;}}", `when { _tag: "B", let n }:`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixed := applyQuickFixOf(t, tc.source, 702, diagnostics.CategoryError)
			if !strings.Contains(fixed, tc.want) {
				t.Fatalf("want %q in the fixed source:\n%s", tc.want, fixed)
			}
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source: %s", d.String())
				}
			}
		})
	}
}

// A variant read through a value that may run a getter keeps its EK0702 and
// gets no quick fix: dropping the read would change what the program does.
func TestDataVariantClassPatternTagFixKeepsReceiverReads(t *testing.T) {
	source := "data D { A };const registry={ get D(){ return D } };export function f(x:unknown){return match(x){when registry.D.A:1;default:0;}}"
	program, file, service, converters := editorProgram(t, source)
	var found *ast.Diagnostic
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == diagnosticSource && d.Code() == 702 {
			found = d
			break
		}
	}
	if found == nil {
		t.Fatal("missing EK0702")
	}
	diagnostic := lsconv.DiagnosticToLSPPush(t.Context(), converters, found)
	only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
	response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
		TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
		Range:        diagnostic.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{diagnostic}, Only: &only},
	})
	if err != nil {
		t.Fatal(err)
	}
	if response.CommandOrCodeActionArray != nil {
		for _, entry := range *response.CommandOrCodeActionArray {
			if entry.CodeAction != nil && strings.HasPrefix(entry.CodeAction.Title, "Write ") {
				t.Fatalf("a receiver read got the fix %q", entry.CodeAction.Title)
			}
		}
	}
}

func TestDataVariantClassPatternIndependentError(t *testing.T) {
	program, file, _, _ := editorProgram(t, "data D {A};export function f(x:unknown){return match(x){when D.A: missingName;default:0;}}")
	codes := map[int32]bool{}
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		codes[d.Code()] = true
	}
	if !codes[702] || !codes[2304] {
		t.Fatalf("want EK0702 and TS2304, got %v", codes)
	}
}
