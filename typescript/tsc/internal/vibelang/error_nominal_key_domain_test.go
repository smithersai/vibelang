package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

const nominalKeyPrelude = "type Brand = string & { readonly brand: unique symbol }; type LiteralBrand = \"x\" & { readonly brand: unique symbol }; type UpperTag = \"_TAG\" & { readonly brand: unique symbol }; type Count = \"COUNT\" & { readonly brand: unique symbol }; "

var nominalKeyDomains = []struct {
	name, domain  string
	reserved      bool
	plainReserved bool
}{
	{"brand", "Brand", true, false},
	{"literal-brand", "LiteralBrand", false, false},
	{"template-brand", "`${Brand}`", true, false},
	{"template-brand-suffix", "`${Brand}tag`", true, false},
	{"template-brand-prefix", "`_${Brand}`", true, false},
	{"template-brand-safe-prefix", "`x-${Brand}`", false, false},
	{"template-literal-brand", "`${LiteralBrand}`", false, false},
	{"lowercase-brand", "Lowercase<Brand>", true, false},
	{"uppercase-brand", "Uppercase<Brand>", false, false},
	{"capitalize-brand", "Capitalize<Brand>", true, false},
	{"uncapitalize-brand", "Uncapitalize<Brand>", true, false},
	{"multiple-holes", "`${Brand}${Brand}`", true, false},
	{"safe-multiple-holes", "`${Brand}x${Brand}`", false, false},
	{"literal-fragments", "`_${Brand}ag`", true, false},
	{"safe-suffix", "`_${Brand}x`", false, false},
	{"number-hole", "`${number}`", false, false},
	{"boolean-hole", "`${boolean}`", false, false},
	{"union-hole", "`${Brand | \"safe\"}`", true, false},
	{"lowercase-literal-brand", "Lowercase<UpperTag>", true, true},
	{"safe-lowercase-literal-brand", "Lowercase<Count>", false, false},
}

func TestErrorNominalTemplateDomain(t *testing.T) {
	for _, row := range nominalKeyDomains {
		t.Run(row.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, nominalKeyPrelude+"export declare const key: "+row.domain+";")
			var key *ast.Node
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsVariableDeclaration(n) && ast.IsIdentifier(n.Name()) && n.Name().Text() == "key" {
					key = n.Name()
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if key == nil {
				t.Fatal("missing key")
			}
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			typ := c.GetTypeAtLocation(key)
			if got := keyDomainMayBeTag(c, typ, 0); got != row.reserved {
				t.Fatalf("%s mayTag=%v, want %v; type=%s", row.domain, got, row.reserved, c.TypeToString(typ))
			}
		})
	}
}
func TestErrorNominalTemplateMembers(t *testing.T) {
	for _, row := range nominalKeyDomains {
		for _, form := range []string{"error", "schema error"} {
			for _, member := range []string{"get [key](): number { return 1 }", "[key](): number { return 1 }"} {
				t.Run(form+"/"+row.name+"/"+member, func(t *testing.T) {
					source := nominalKeyPrelude + "declare const key: " + row.domain + "; export " + form + " E { id: string; " + member + " }"
					program, file, _, _ := editorProgram(t, source)
					var errors []string
					var reserved bool
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Category() != diagnostics.CategoryError {
							continue
						}
						errors = append(errors, d.String())
						reserved = reserved || d.Source() == diagnosticSource && d.Code() == 2117 && d.Pos() == strings.Index(source, "[key]")
					}
					want := form == "schema error" && row.reserved || form == "error" && row.plainReserved
					if want && (len(errors) != 1 || !reserved) {
						t.Fatalf("want one EK2117 at computed key; got %v", errors)
					}
					if !want && len(errors) != 0 {
						t.Fatalf("valid key/control rejected: %v", errors)
					}
				})
			}
		}
	}
}
func TestErrorNominalTemplateClassFix(t *testing.T) {
	for _, row := range nominalKeyDomains {
		if !row.reserved {
			continue
		}
		t.Run(row.name, func(t *testing.T) {
			source := nominalKeyPrelude + "declare const key: " + row.domain + "; export schema error E { id: string; get [key](): number { return 1 } }"
			fixed := applyQuickFixOf(t, source, 2117, diagnostics.CategoryError)
			if !strings.Contains(fixed, "class E extends") || !strings.Contains(fixed, "get [key](): number { return 1 }") {
				t.Fatalf("missing preserving class repair: %s", fixed)
			}
			program, file, _, _ := editorProgram(t, fixed)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed source reports %s", d.String())
				}
			}
		})
	}
}

func TestSchemaErrorNominalKeyInverse(t *testing.T) {
	for _, row := range nominalKeyDomains {
		t.Run(row.name, func(t *testing.T) {
			source := nominalKeyPrelude + "declare const key: " + row.domain + "; export class E extends Schema.TaggedError<E>()(\"E\", { id: Schema.String }) { get [key](): number { return 1 } }"
			program, file, _, _ := editorProgram(t, source)
			var class *ast.Node
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if ast.IsClassDeclaration(n) && n.Name() != nil && n.Name().Text() == "E" {
					class = n
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if class == nil {
				t.Fatal("missing native class")
			}
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			c.GetDiagnostics(t.Context(), file)
			plan := errorClassRewrite(c, file, class)
			if row.reserved {
				if plan == nil || len(plan.edits) != 0 || !strings.Contains(plan.why, "computed member key") {
					t.Fatalf("unsafe inverse offered: %+v", plan)
				}
			} else if plan == nil || len(plan.edits) == 0 {
				t.Fatalf("safe key's inverse refused: %+v", plan)
			}
		})
	}
}
