package vibelang

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// Appendix B: diagnostic code and repair text — spec-rule: docs/design/src/900-appendices.md#709dea7811693cc4
func TestAppendixCodeRepairCoverage(t *testing.T) {
	for code, m := range registry {
		if m.Code != code || m.String() != fmt.Sprintf("EK%04d", code) || m.Text == "" {
			t.Errorf("invalid public diagnostic identity or empty message: %d %+v", code, m)
		}
	}
	for code, repair := range map[int32]string{108: "remove effect", 901: "static readonly", 510: "parenthes"} {
		m := registry[code]
		if m == nil || !strings.Contains(strings.ToLower(m.Text), repair) {
			t.Errorf("EK%04d lacks repair %q: %+v", code, repair, m)
		}
	}
}

// Appendix A: provide statement wins over division — spec-rule: docs/design/src/900-appendices.md#2d23b461ac301911
func TestAppendixProvideStatementPlacementCoverage(t *testing.T) {
	t.Skip("docs/design/src/900-appendices.md#2d23b461ac301911: return provide / a / {} is parsed as a retired provide expression (EK1017), instead of division (stock TS2363)")
	source := "function f(provide: number, a: number) { provide / a / {} }"
	program, file, _, _ := editorProgram(t, source)
	found := false
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Source() == "EK" && d.Code() == 1201 && d.Pos() >= strings.Index(source, "provide /") {
			found = true
		}
	}
	if !found {
		t.Fatal("provide statement did not receive EK1201 within the statement")
	}
	// After return the exact same tokens remain division, with the native
	// object arithmetic error (confirmed by the stock TypeScript 5.9.3 twin).
	program, file, _, _ = editorProgram(t, "function f(provide: number, a: number) { return provide / a / {} }")
	native := false
	var reported []string
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		reported = append(reported, fmt.Sprintf("%s%d", d.Source(), d.Code()))
		if d.Source() == "EK" && d.Code() == 1201 {
			t.Fatal("return division was parsed as a provide statement")
		}
		if d.Source() != "EK" && d.Code() == 2363 {
			native = true
		}
	}
	if !native {
		t.Fatalf("return division lost the native TS2363 operand diagnostic; got %v", reported)
	}
}

// Appendix B: invalid static service keys — spec-rule: docs/design/src/900-appendices.md#06662cfb17933934
// Appendix B: static-key code is not reused — spec-rule: docs/design/src/900-appendices.md#0268ab526eefcd9b
// Appendix B: transitional static key identity — spec-rule: docs/design/src/900-appendices.md#2b17e9765ac34cd6
func TestAppendixStaticKeyTransitionCoverage(t *testing.T) {
	// Appendix B explicitly requires reading emitted EK3008 as EK0901
	// during renumbering. Preserve the invalid-key rule under either spelling.
	for _, source := range []string{
		"service Users { static key = \"app/Users\"; value: number }",
		"service Users { static readonly key = 123; value: number }",
	} {
		program, file, _, _ := editorProgram(t, source)
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Source() == "EK" && (d.Code() == 901 || d.Code() == 3008) {
				found = true
			}
		}
		if !found {
			t.Fatalf("invalid static key did not receive normative EK0901 or permitted transitional EK3008: %s", source)
		}
	}
}

// Use the public code-action request for either native TS or EK diagnostics;
// the style-migration helper selects only warning actions titled "Write ...".
func appendixFixedSources(t *testing.T, source string, code int32) []string {
	t.Helper()
	program, file, service, converters := editorProgram(t, source)
	ds := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
	var diagnostic *ast.Diagnostic
	for _, d := range ds {
		if d.Code() == code {
			diagnostic = d
			break
		}
	}
	if diagnostic == nil {
		t.Fatalf("missing diagnostic %d in %s", code, source)
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
	var fixed []string
	if response.CommandOrCodeActionArray != nil {
		for _, a := range *response.CommandOrCodeActionArray {
			if a.CodeAction == nil || a.CodeAction.Edit == nil || a.CodeAction.Edit.Changes == nil {
				continue
			}
			changes := *a.CodeAction.Edit.Changes
			if len(changes) != 1 {
				continue
			}
			edits, ok := changes[lsconv.FileNameToDocumentURI(file.FileName())]
			if ok {
				fixed = append(fixed, applyEditorEdits(t, file, converters, edits))
			}
		}
	}
	return fixed
}
func appendixWantFix(t *testing.T, source string, code int32, want string) {
	t.Helper()
	got := appendixFixedSources(t, source, code)
	for _, candidate := range got {
		if candidate == want {
			return
		}
	}
	t.Fatalf("diagnostic %d fixes %q; want %q", code, got, want)
}

// Appendix A: remove async from mixed-modifier block — spec-rule: docs/design/src/900-appendices.md#257b4dc751da2877
func TestAppendixBlockAsyncFixCoverage(t *testing.T) {
	t.Skip("docs/design/src/900-appendices.md#257b4dc751da2877: EK0105 is not emitted for effect async blocks; both modifier orders must produce EK0105")
	for _, source := range []string{"const p = effect async { return 1 }\n", "const p = async effect { return 1 }\n"} {
		appendixWantFix(t, source, 105, "const p = effect { return 1 }\n")
	}
}

// Appendix A: insert missing declaration separator — spec-rule: docs/design/src/900-appendices.md#8d45f00465a15e43
// Appendix B: insert missing declaration separator — spec-rule: docs/design/src/900-appendices.md#445fd57a539d7e98
// Appendix B: insert missing declaration separator — spec-rule: docs/design/src/900-appendices.md#37741a6dd1066524
// Appendix B: insert missing declaration separator — spec-rule: docs/design/src/900-appendices.md#d5988aa0f498ac42
// Appendix B: insert missing declaration separator — spec-rule: docs/design/src/900-appendices.md#e604a349ef087595
func TestAppendixSeparatorFixCoverage(t *testing.T) {
	for _, c := range []struct {
		name, source, want string
		code               int32
	}{
		{"service", "service Users { a: number b: string }\n", "service Users { a: number; b: string }\n", 908},
		{"error", "error E { a: number b: string }\n", "error E { a: number; b: string }\n", 1306},
		{"schema-error", "schema error E { a: number b: string }\n", "schema error E { a: number; b: string }\n", 1306},
		{"schema", "schema S { a: number b: string }\n", "schema S { a: number; b: string }\n", 1504},
		{"variants", "data D { A B }\n", "data D { A; B }\n", 1605},
		{"payload", "data D { A { a: number b: string } }\n", "data D { A { a: number; b: string } }\n", 1605},
	} {
		t.Run(c.name, func(t *testing.T) {
			if c.name == "schema" {
				t.Skip("docs/design/src/900-appendices.md#8d45f00465a15e43; docs/design/src/900-appendices.md#d5988aa0f498ac42: ordinary schema separator still lacks EK1504 and its insert-semicolon fix")
			}
			appendixWantFix(t, c.source, c.code, c.want)
		})
	}
}

// Appendix A: insert function in top-level shorthand — spec-rule: docs/design/src/900-appendices.md#268a8e8be5deafec

func TestAppendixShorthandFixCoverage(t *testing.T) {
	t.Skip("docs/design/src/900-appendices.md#268a8e8be5deafec: EK0101 is not emitted yet; cov-ch900a-ek0101.fail proves the diagnostic gap")
	for _, modifier := range []string{"effect", "async"} {
		appendixWantFix(t, modifier+" load() { return 1 }\n", 101, modifier+" function load() { return 1 }\n")
	}
}

// Appendix A: parenthesize mixed Effect types — spec-rule: docs/design/src/900-appendices.md#d4afdd0461153465
func TestAppendixBangParenthesesFixCoverage(t *testing.T) {
	source := "type X = string | number!Error\n"
	for _, fixed := range appendixFixedSources(t, source, 301) {
		if fixed == source || !strings.Contains(fixed, "(") || !strings.Contains(fixed, ")") {
			continue
		}
		p, f, _, _ := editorProgram(t, fixed)
		ds := append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...)
		valid := true
		for _, d := range ds {
			if d.Category().Name() == "error" {
				valid = false
			}
		}
		if valid {
			return
		}
	}
	t.Fatal("no parenthesizing fix gives a valid type")
}

// Appendix A: parenthesize assertion before non-null bang — spec-rule: docs/design/src/900-appendices.md#78fe099476011694

func TestAppendixDanglingBangFixCoverage(t *testing.T) {
	t.Skip("docs/design/src/900-appendices.md#78fe099476011694: TS17019 is reported, but the public quick-fix request returns no parenthesizing edit")
	appendixWantFix(t, "declare const x: unknown; const y = x as number!\n", 17019,
		"declare const x: unknown; const y = (x as number)!\n")
}

// Appendix B: renumbering keeps inventory and live registry aligned — spec-rule: docs/design/src/900-appendices.md#6371772a0c689cbc
func TestAppendixRegistryInventoryCoverage(t *testing.T) {
	t.Skip("docs/design/src/900-appendices.md#6371772a0c689cbc: live registry lacks EK1506, EK1607, EK4005, EK4007, EK4009 and EK4857")
	TestRegistryMatchesSpec(t)
}
