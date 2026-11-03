package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// RC-15, effectscript-75: a constructor pattern must test exactly instanceof.
// In particular Array.isArray and the primitive-or-boxed patterns are broader.
func TestMatchInstanceOfEditorRepair(t *testing.T) {
	for _, test := range []struct {
		name, decl, ctor string
		repair           bool
	}{
		{"number", "", "Number", false},
		{"string", "", "String", false},
		{"boolean", "", "Boolean", false},
		{"array", "", "Array", false},
		{"ordinary class", "class C {}", "C", true},
		{"static method", "class C { static label() { return 1 } }", "C", true},
		{"shadowed Number class", "class Number {}", "Number", true},

		{"external matcher setup", "class C {}; Object.defineProperty(C, Symbol.for('Symbol.customMatcher'), { value: () => true })", "C", false},
		{"escaped constructor", "class C {}; const alias = C", "C", false},
		{"exported class", "export class C {}", "C", false},
		{"constructor alias", "const C = Number", "C", false},
		{"class alias", "class Plain {}; const C = Plain", "C", false},
		{"parameter", "", "C", false},
		{"ambient class", "declare class C {}", "C", false},
		{"own computed matcher", "const matcher: unique symbol = Symbol.for('Symbol.customMatcher'); class C { static [matcher](_: unknown) { return true } }", "C", false},
		{"inherited class", "class Base {}; class C extends Base {}", "C", false},
		{"static setup", "class C { static { Object.defineProperty(this, Symbol.for('Symbol.customMatcher'), {value: () => true}) } }", "C", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			params := "value: unknown"
			if test.name == "parameter" {
				params += ", C: new () => object"
			}
			source := test.decl + "\nexport function choose(" + params + "): string { return Match.value(value).pipe(Match.when(Match.instanceOf(" + test.ctor + "), (): string => 'hit'), Match.orElse((): string => 'miss')) }\n"
			program, file, service, converters := editorProgram(t, source)
			var diagnostic *ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("invalid fixture: %s", d.String())
				}
				if d.Source() == diagnosticSource && d.Code() == EK4839.Code {
					diagnostic = d
				}
			}
			if diagnostic == nil {
				t.Fatal("missing EK4839 advisory")
			}
			d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
			response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
				TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
				Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}},
			})
			if err != nil {
				t.Fatal(err)
			}
			offered := false
			if response.CommandOrCodeActionArray != nil {
				for _, action := range *response.CommandOrCodeActionArray {
					if action.CodeAction != nil && strings.HasPrefix(action.CodeAction.Title, "Write a match") {
						offered = true
					}
				}
			}
			if offered != test.repair {
				t.Fatalf("editor repair = %v, want %v\n%s", offered, test.repair, source)
			}
			if !test.repair {
				notes := ""
				for _, note := range diagnostic.MessageChain() {
					notes += note.String() + "\n"
				}
				if !strings.Contains(notes, "has no match pattern that tests the same") {
					t.Fatalf("missing reason: %s", notes)
				}
			} else {
				fixed := applyQuickFix(t, source, EK4839.Code)
				if !strings.Contains(fixed, "when "+test.ctor+":") {
					t.Fatalf("ordinary class lost repair: %s", fixed)
				}
			}
		})
	}
}
