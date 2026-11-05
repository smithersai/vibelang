package vibelang

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestProducerDelegationKeepsNativeIterationErrors(t *testing.T) {
	rows := []struct {
		key, body string
		native    int32
	}{
		{"next-input", "const input=INPUT;function* read():Generator<number,void,undefined>{yield* (function*():Generator<number,void,typeof input extends number?string:undefined>{yield 1})()};void read", 2766},
		{"for-of", "for(const n of INPUT){void n}", 2488},
		{"binding", "const [n]=INPUT;void n", 2488},
		{"spread", "const values=[...INPUT];void values", 2488},
		{"generator", "function* read(){yield* INPUT};void read", 2488},
		{"for-await", "const read=async()=>{for await(const n of INPUT){void n}};void read", 2504},
		{"async-generator", "async function* read(){yield* INPUT};void read", 2504},
	}
	for _, row := range rows {
		for context := 0; context < 3; context++ {
			for invalidDomain := 0; invalidDomain < 2; invalidDomain++ {
				for variant := 0; variant < 4; variant++ {
					t.Run(fmt.Sprintf("%s/%d/%d/%d", row.key, context, invalidDomain, variant), func(t *testing.T) {
						inner := "1"
						if variant&2 != 0 {
							inner = "[1]"
						}
						result := "[1]"
						if invalidDomain != 0 {
							result = "1"
						}
						operand := "(()=>{" + strings.ReplaceAll(row.body, "INPUT", inner) + ";return " + result + "})()"
						if variant&1 != 0 {
							operand = "(/* operand */ " + operand + ")"
						}
						kind := "effect "
						if context == 1 {
							kind = ""
						}
						if context == 2 {
							kind = "async "
						}
						source := "export " + kind + "function* run(){yield* " + operand + "}"
						program, file, _, _ := editorProgram(t, source)
						var got []int32
						for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
							if d.Category() == diagnostics.CategoryError {
								got = append(got, d.Code())
							}
						}
						var want []int32
						if context == 0 {
							want = append(want, 2103)
						} else if invalidDomain != 0 {
							outer := int32(2488)
							if context == 2 {
								outer = 2504
							}
							want = append(want, outer)
						}
						if variant&2 == 0 {
							want = append(want, row.native)
						}
						slices.Sort(got)
						slices.Sort(want)
						if !slices.Equal(got, want) {
							t.Fatalf("want %v got %v\n%s", want, got, source)
						}
					})
				}
			}
		}
	}
}

func TestProducerDelegationNextInputOwnership(t *testing.T) {
	for _, row := range []struct {
		key, signature, operand string
		want                    []int32
	}{
		{"producer", "effect function* run():Stream.Stream<number>", "source()", []int32{2103}},
		{"producer-grouped", "effect function* run():Stream.Stream<number>", "(source())", []int32{2103}},
		{"native-invalid", "function* run():Generator<number,void,undefined>", "source()", []int32{2766}},
		{"native-valid", "function* run():Generator<number,void,string>", "source()", nil},
	} {
		t.Run(row.key, func(t *testing.T) {
			source := "declare function source():Generator<number,void,string>;export " + row.signature + "{yield* " + row.operand + "}"
			program, file, _, _ := editorProgram(t, source)
			var got []int32
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, d.Code())
				}
			}
			slices.Sort(got)
			want := slices.Clone(row.want)
			slices.Sort(want)
			if !slices.Equal(got, want) {
				t.Fatalf("want %v got %v\\n%s", want, got, source)
			}
		})
	}
}
