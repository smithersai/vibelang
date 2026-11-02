package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"strings"
	"testing"
)

const nominalLiteralKeyPrelude = "type KeyBrand = { readonly brand: unique symbol }; type Tag = \"_tag\" & KeyBrand; type Word = \"tag\" & KeyBrand; type Underscore = \"_\" & KeyBrand; type Upper = \"_TAG\" & KeyBrand; declare const unique: unique symbol; "

var nominalLiteralKeyRows = []struct {
	name, domain string
	reserved     bool
}{
	{"raw-tag", "\"_tag\"", true},
	{"tag-brand", "Tag", true},
	{"nested-brand", "Tag & { readonly extra: unique symbol }", true},
	{"string-intersection", "Tag & string", true},
	{"unknown-intersection", "Tag & unknown", true},
	{"same-union", "Tag | \"_tag\"", true},
	{"template-brand", "`${Tag}`", true},
	{"template-prefix", "`_${Word}`", true},
	{"template-suffix", "`${Underscore}tag`", true},
	{"lowercase-brand", "Lowercase<Upper>", true},
	{"capitalize-brand", "Capitalize<Tag>", true},
	{"uncapitalize-brand", "Uncapitalize<Tag>", true},
	{"nested-mapping", "Lowercase<Uppercase<Tag>>", true},
	{"safe-brand", "\"safe\" & KeyBrand", false},
	{"union-brand", "(\"_tag\" | \"safe\") & KeyBrand", false},
	{"string-brand", "string & KeyBrand", false},
	{"string", "string", false},
	{"lowercase-broad", "Lowercase<string & KeyBrand>", false},
	{"uppercase-tag", "Uppercase<Tag>", false},
	{"lowercase-safe", "Lowercase<\"SAFE\" & KeyBrand>", false},
	{"template-double", "`${Tag}${Tag}`", false},
	{"template-safe-prefix", "`x-${Tag}`", false},
	{"number", "number", false},
	{"symbol", "typeof unique", false},
	{"never", "never", false},
}

func TestErrorNominalLiteralKeys(t *testing.T) {
	for _, row := range nominalLiteralKeyRows {
		for _, shape := range []struct {
			name, member string
			fallback     int
		}{
			{"getter", "get [key](): number { return 1 }", 0},
			{"method", "[key](): number { return 1 }", 0},
			{"static-getter", "static get [key](): number { return 1 }", 1302},
			{"setter", "set [key](value: number) {}", 1302},
		} {
			t.Run(row.name+"/"+shape.name, func(t *testing.T) {
				source := nominalLiteralKeyPrelude + "declare const key: " + row.domain + "; export error E { id: string; " + shape.member + " }"
				program, file, _, _ := editorProgram(t, source)
				want := shape.fallback
				if row.reserved {
					want = 2117
				}
				var codes []int
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					codes = append(codes, int(d.Code()))
					if d.Code() != int32(want) || d.Source() != diagnosticSource {
						t.Errorf("unexpected diagnostic: %s", d.String())
					}
					if row.reserved && d.Pos() != strings.Index(source, "[key]") {
						t.Errorf("diagnostic moved from computed key: %s", d.String())
					}
				}
				count := 0
				if want != 0 {
					count = 1
				}
				if len(codes) != count {
					t.Fatalf("want %d errors (EK%d), got %v", count, want, codes)
				}
			})
		}
	}
}
func TestErrorNominalLiteralClassRepair(t *testing.T) {
	for _, row := range nominalLiteralKeyRows {
		if !row.reserved {
			continue
		}
		t.Run(row.name, func(t *testing.T) {
			source := nominalLiteralKeyPrelude + "declare const key: " + row.domain + "; export error E { id: string; get [key](): \"E\" { return \"E\" } }"
			if row.name == "raw-tag" {
				program, file, service, _ := editorProgram(t, source)
				found := false
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Code() != 2117 {
						continue
					}
					found = true
					actions, err := errorMemberClassFix.GetCodeActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: d.Loc(), ErrorCode: 2117, Program: program, LS: service})
					if err != nil {
						t.Fatal(err)
					}
					if len(actions) != 0 {
						t.Fatal("offered a class whose getter overrides the base property (TS2611)")
					}
				}
				if !found {
					t.Fatal("missing EK2117")
				}
				return
			}
			fixed := applyQuickFixOf(t, source, 2117, diagnostics.CategoryError)
			if !strings.Contains(fixed, "class E extends") || !strings.Contains(fixed, "get [key](): \"E\" { return \"E\" }") {
				t.Fatalf("member lost in repair: %s", fixed)
			}
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("repaired source: %s", d.String())
				}
			}
		})
	}
}

// A different diagnostic on the same declaration must not bypass the guard.
func TestErrorReservedKnownMemberRefusesInvalidClass(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, member := range []string{
			"get _tag(): \"E\" { return \"E\" }",
			"get [\"_tag\"](): \"E\" { return \"E\" }",
			"get [key](): \"E\" { return \"E\" }",
			"set _tag(value: string) {}",
			"_tag(): number { return 1 }",
		} {
			t.Run(form+"/"+member, func(t *testing.T) {
				source := "const key = \"_tag\" as const; export " + form + " E { id: string; static meta = 1; " + member + " }"
				program, file, service, _ := editorProgram(t, source)
				count := 0
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Code() != 1302 && d.Code() != 2117 {
						continue
					}
					count++
					actions, err := errorMemberClassFix.GetCodeActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: d.Loc(), ErrorCode: d.Code(), Program: program, LS: service})
					if err != nil {
						t.Fatal(err)
					}
					if len(actions) != 0 {
						t.Fatalf("EK%d offers an invalid native tag override", d.Code())
					}
				}
				if count != 2 {
					t.Fatalf("want EK1302 and EK2117, got %d applicable diagnostics", count)
				}
			})
		}
	}
}

// A generated empty payload argument is not a user-written <{}> contract.
func TestErrorFieldlessMemberRepairOmitsSyntheticPayload(t *testing.T) {
	for _, row := range []struct {
		source string
		code   int32
	}{
		{"export error E { static meta = 1 }", 1302},
		{nominalLiteralKeyPrelude + "declare const key: Tag; export error E { get [key](): number { return 1 } }", 2117},
	} {
		t.Run(row.source, func(t *testing.T) {
			fixed := applyQuickFixOf(t, row.source, row.code, diagnostics.CategoryError)
			if strings.Contains(fixed, "<{}>") {
				t.Fatalf("synthetic payload changes the fieldless declaration: %s", fixed)
			}
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("class repair: %s", d.String())
				}
			}
		})
	}
}
