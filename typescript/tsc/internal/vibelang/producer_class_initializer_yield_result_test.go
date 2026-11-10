package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

// Class initialization keeps native yield placement and value checks. Written
// next-value contracts retain independent native assignment errors.
func TestProducerClassInitializerYieldResult(t *testing.T) {
	for _, form := range []struct{ key, source string }{
		{"declaration", "export $effectfunction* run()$contract{BODY}"},
		{"expression", "export const run=$effectfunction*()$contract{BODY}"},
		{"class-method", "export class Feed{$effect*run()$contract{BODY}}"},
		{"object-method", "export const feed={$effect*run()$contract{BODY}}"},
	} {
		for _, home := range []struct {
			key, body string
			want      []int32
		}{
			{"instance-typed", "class C{value:number=(yield 1)}", []int32{1163}},
			{"instance-inferred", "class C{value=(yield 1)}", []int32{1163, 7057}},
			{"static-typed", "class C{static value:number=(yield 1)}", []int32{1163}},
			{"static-inferred", "class C{static value=(yield 1)}", []int32{1163, 7057}},
			{"accessor-typed", "class C{accessor value:number=(yield 1)}", []int32{1163}},
			{"accessor-inferred", "class C{accessor value=(yield 1)}", []int32{1163, 7057}},
			{"static-block-typed", "class C{static{const value:number=(yield 1)}}", []int32{1163}},
			{"static-block-inferred", "class C{static{const value=(yield 1)}}", []int32{1163, 7057}},
			{"computed-name", "class C{[((yield 1),\"method\")](){}}", nil},
		} {
			for _, producer := range []bool{false, true} {
				for _, written := range []bool{false, true} {
					t.Run(fmt.Sprintf("%s/%s/producer=%t/written=%t", form.key, home.key, producer, written), func(t *testing.T) {
						marker := ""
						if producer {
							marker = "effect "
						}
						contract := ""
						want := slices.Clone(home.want)
						if written {
							contract = ":Generator<number,void,undefined>"
							if producer {
								contract = ":Stream.Stream<number>"
							}
							if len(want) != 0 {
								want = []int32{1163}
								if strings.HasSuffix(home.key, "-typed") {
									want = append(want, 2322)
								}
							}
						}
						source := strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(form.source, "$effect", marker), "$contract", contract), "BODY", home.body)
						program, file, _, _ := editorProgram(t, source)
						var got []int32
						for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
							if d.Category() == diagnostics.CategoryError {
								got = append(got, d.Code())
							}
						}
						slices.Sort(got)
						if !slices.Equal(got, want) {
							t.Fatalf("want %v got %v\n%s", want, got, source)
						}
					})
				}
			}
		}
	}
}
