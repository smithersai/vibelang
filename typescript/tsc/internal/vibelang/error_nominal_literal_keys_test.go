package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
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
