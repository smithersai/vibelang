package vibelang

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestErrorStaticMemberOwnsNativeShapeDiagnostics(t *testing.T) {
	for _, strict := range []bool{false, true} {
		for _, form := range []string{"error", "schema error"} {
			for _, member := range []string{
				"static override extra = 1",
				"static override makeOptio() { return 1 }",
				"static override extra() { return 1 }",
				"static override get extra() { return 1 }",
				"static name = 1",
				"static length = 1",
				"static prototype = 1",
				"static \"prototype\" = 1",
				"static [\"prototype\"] = 1",
				"static [(\"prototype\")] = 1",
				"private static name = \"hidden\"",
				"protected static length = 1",
				"private static fields = 1",
				"static make = 1",
			} {
				t.Run(fmt.Sprintf("%s/strict=%t/%s", form, strict, member), func(t *testing.T) {
					p, f, _, _ := editorProgram(t, fmt.Sprintf("%s Entry { %s }\n", form, member))
					if strict {
						p.Options().NoImplicitOverride = core.TSTrue
					}
					var codes []string
					for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
						if d.Category() == diagnostics.CategoryError {
							codes = append(codes, fmt.Sprintf("%s%04d", d.Source(), d.Code()))
						}
					}
					want := 1
					if strings.Contains(member, "[(\"prototype\")]") {
						want = 2 // The native invalid computed-key error remains independent.
						if !slices.Contains(codes, "1166") {
							t.Fatalf("lost native TS1166: %v", codes)
						}
					}
					if len(codes) != want || !slices.Contains(codes, "EK1302") {
						t.Fatalf("got %v, want EK1302 and only any independent invalid-key error", codes)
					}
				})
			}
		}

	}
}

func TestErrorStaticMemberKeepsIndependentTypeErrors(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, body := range []string{
			"static override extra = 1; get valid(): string { return 7 }",
			"static override extra(): string { return 7 }",
			"static name = 1; get valid(): string { return 7 }",
			"private static name = \"hidden\"; get valid(): string { return 7 }",
		} {
			t.Run(form+"/"+body, func(t *testing.T) {
				p, f, _, _ := editorProgram(t, form+" Entry { "+body+" }\n")
				counts := map[int32]int{}
				for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
					if d.Category() == diagnostics.CategoryError {
						counts[d.Code()]++
					}
				}
				if len(counts) != 2 || counts[1302] != 1 || counts[2322] != 1 {
					t.Fatalf("got %v, want EK1302 and independent TS2322", counts)
				}
			})
		}
	}
}

func TestNativeStaticMembersKeepShapeDiagnostics(t *testing.T) {
	for _, row := range []struct {
		member string
		code   int32
	}{
		{"static override extra = 1", 4113},
		{"static prototype = 1", 2699},
		{"static override extra() { return 1 }", 4113},
	} {
		t.Run(row.member, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, "class Entry extends Error { "+row.member+" }\n")
			seen := false
			for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
				seen = seen || d.Source() == "" && d.Code() == row.code
			}
			if !seen {
				t.Fatalf("lost native TS%d", row.code)
			}
		})
	}
}

func TestErrorStaticMemberKeepsNestedShapeDiagnostics(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, row := range []struct {
			body string
			code int32
		}{
			{"static helper() { class Inner extends Error { override missing = 1 }; return Inner }", 4113},
			{"static helper() { class Inner extends Error { static prototype = 1 }; return Inner }", 2699},
		} {
			t.Run(form+"/"+row.body, func(t *testing.T) {
				p, f, _, _ := editorProgram(t, form+" Entry { "+row.body+" }\n")
				seen, own := false, false
				for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
					seen = seen || d.Source() == "" && d.Code() == row.code
					own = own || d.Code() == 1302
				}
				if !seen || !own {
					t.Fatalf("own=%v nested TS%d=%v", own, row.code, seen)
				}
			})
		}
	}
}

func TestErrorStaticMemberKeepsComputedKeyShapeDiagnostics(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		source := form + " Entry { static [(class Inner { static prototype = 1 }, \"extra\")]() { return 1 } }\n"
		p, f, _, _ := editorProgram(t, source)
		own, nested := false, false
		for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
			own = own || d.Code() == 1302
			nested = nested || d.Source() == "" && d.Code() == 2699
		}
		if !own || !nested {
			t.Fatalf("own=%v nested TS2699=%v", own, nested)
		}
	}
}

func TestNativeStaticShapeOverrideVariants(t *testing.T) {
	for _, row := range []struct {
		member string
		code   int32
	}{
		{"static make = 1", 4114},
		{"static override makeOptio() { return 1 }", 4117},
	} {
		t.Run(row.member, func(t *testing.T) {
			p, f, _, _ := editorProgram(t, "class Entry extends Schema.TaggedError<Entry>()(\"Entry\", {}) { "+row.member+" }\n")
			p.Options().NoImplicitOverride = core.TSTrue
			seen := false
			for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
				seen = seen || d.Source() == "" && d.Code() == row.code
			}
			if !seen {
				t.Fatalf("lost native TS%d", row.code)
			}
		})
	}
}
