package vibelang

import (
	"fmt"
	"maps"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestProducerReturnUnresolvedCallee(t *testing.T) {
	bodies := []struct {
		name, text string
		valued     bool
		missing    bool
	}{
		{"number", "return 7", true, false},
		{"undefined", "return undefined", true, false},
		{"missing-value", "return absentValue", true, true},
		{"bare", "return", false, false},
		{"nested-native", "function* inner(){return 7};yield 1;return", false, false},
	}
	for _, shape := range []string{"inline", "wrapped", "declaration", "variable", "alias", "method"} {
		for _, callee := range []string{"missing", "property", "optional", "any", "unknown"} {
			for _, body := range bodies {
				t.Run(fmt.Sprintf("%s/%s/%s", shape, callee, body.name), func(t *testing.T) {
					source := producerCalleeSource(shape, callee, body.text, false)
					program, file, _, _ := editorProgram(t, source)
					got := map[int32]int{}
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Category() == diagnostics.CategoryError {
							got[d.Code()]++
						}
					}
					want := map[int32]int{}
					if body.valued {
						want[2128]++
					}
					if callee == "missing" || callee == "optional" {
						want[2304]++
					}
					if callee == "property" {
						want[2339]++
					}
					if body.missing {
						want[2304]++
					}
					if !maps.Equal(got, want) {
						t.Fatalf("want %v, got %v\n%s", want, got, source)
					}
				})
			}
		}
	}
}

func TestProducerReturnCalleeNativeControls(t *testing.T) {
	for _, shape := range []string{"inline", "wrapped", "declaration", "variable", "alias", "method"} {
		for _, callee := range []string{"missing", "property", "optional", "any", "unknown"} {
			source := producerCalleeSource(shape, callee, "return 7", true)
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == 2128 {
					t.Errorf("native generator reported producer return: %v\n%s", d, source)
				}
			}
		}
	}
}

func producerCalleeSource(shape, callee, body string, native bool) string {
	marker := "effect "
	if native {
		marker = ""
	}
	literal := marker + "function*(){" + body + "}"
	prefix, argument := "", literal
	switch shape {
	case "wrapped":
		argument = "(" + literal + ")"
	case "declaration":
		prefix = marker + "function* p(){" + body + "};"
		argument = "p"
	case "variable":
		prefix = "const p=" + literal + ";"
		argument = "p"
	case "alias":
		prefix = marker + "function* p(){" + body + "};const alias=p;"
		argument = "alias"
	case "method":
		prefix = "const methods={" + marker + "*p(){" + body + "}};"
		argument = "methods.p"
	}
	call := "missing(" + argument + ")"
	switch callee {
	case "property":
		prefix = "const holder={};" + prefix
		call = "holder.take(" + argument + ")"
	case "optional":
		call = "missing?.(" + argument + ")"
	case "any":
		prefix = "declare const take:any;" + prefix
		call = "take(" + argument + ")"
	case "unknown":
		prefix = "declare function take(f:unknown):void;" + prefix
		call = "take(" + argument + ")"
	}
	return "export {};" + prefix + call + ";"
}
