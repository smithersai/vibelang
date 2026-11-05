package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestRejectedSchemaConstructorRegistration(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, access := range []string{"private", "protected", "public", ""} {
			for _, payload := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/%s/payload=%t", form, access, payload), func(t *testing.T) {
					fields, call := "", "super()"
					if payload {
						fields = "id:string;"
						call = "super({id:'value'})"
					}
					source := "export " + form + " Entry{" + fields + access + " constructor(){" + call + "}}"
					p, f, _, _ := editorProgram(t, source)
					codes := []int32{}
					for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
						if d.Category() == diagnostics.CategoryError {
							codes = append(codes, d.Code())
						}
					}
					if len(codes) != 1 || codes[0] != 1301 {
						t.Fatalf("got %v,want only EK1301", codes)
					}
				})
			}
		}
	}
}

func TestRejectedSchemaConstructorKeepsAuthoredArguments(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, access := range []string{"private", "protected"} {
			t.Run(form+"/"+access, func(t *testing.T) {
				source := "export " + form + " Entry{" + access + " constructor(){super()} get problem(){return Math.imul('bad',2)}}"
				p, f, _, _ := editorProgram(t, source)
				counts := map[int32]int{}
				for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
					if d.Category() == diagnostics.CategoryError {
						counts[d.Code()]++
					}
				}
				if len(counts) != 2 || counts[1301] != 1 || counts[2345] != 1 {
					t.Fatalf("got %v,want EK1301 and authored TS2345", counts)
				}
			})
		}
	}
}

func TestNativePrivateConstructorArgumentIsRetained(t *testing.T) {
	source := "class Entry{private constructor(){} get problem(){return Math.imul('bad',2)}}"
	p, f, _, _ := editorProgram(t, source)
	counts := map[int32]int{}
	for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
		if d.Category() == diagnostics.CategoryError {
			counts[d.Code()]++
		}
	}
	if len(counts) != 1 || counts[2345] != 1 {
		t.Fatalf("got %v,want authored TS2345", counts)
	}
}
