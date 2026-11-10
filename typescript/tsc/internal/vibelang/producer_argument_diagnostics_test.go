package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

func TestProducerArgumentNativeDiagnostics(t *testing.T) {
	for _, api := range []struct{ key, call string }{
		{"custom", "take(ARG)"},
		{"gen", "Effect.gen(ARG)"},
		{"fn", "Effect.fnUntraced(ARG)"},
		{"named-fn", "Effect.fn(\"read\")(ARG)"},
	} {
		for _, home := range []string{"inline", "named"} {
			for _, body := range []struct{ key, source string }{
				{"empty-const", "const\nconst users = 1"},
				{"empty-class-parameters", "class C<> {}"},
				{"empty-interface-parameters", "interface C<> {}"},
				{"duplicate-binding", "const n=1;const n=2"},
				{"missing-name", "void missing"},
				{"wrong-type", "const n:number=\"\""},
				{"parameter-property", "function inner(public n:number){}"},
				{"valued-return", "return 1"},
				{"delegation", "yield* [1]"},
				{"valid", "yield 1"},
			} {
				t.Run(fmt.Sprintf("%s/%s/%s", api.key, home, body.key), func(t *testing.T) {
					pre := "import {Effect} from \"effect\";declare function take(body:()=>Generator<number,void,unknown>):void;"
					base := pre + "const producer=effect function*(){" + body.source + "};void producer;"
					producer := "effect function*(){" + body.source + "}"
					call := strings.ReplaceAll(api.call, "ARG", producer)
					if home == "named" {
						call = "effect function* producer(){" + body.source + "};" + strings.ReplaceAll(api.call, "ARG", "producer")
					}
					source := pre + call
					codes := func(source string) []int32 {
						program, file, _, _ := editorProgram(t, source)
						var got []int32
						for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
							if d.Category() == diagnostics.CategoryError && (d.Source() == "" || d.Code() == 1002) {
								got = append(got, d.Code())
							}
						}
						slices.Sort(got)
						return got
					}
					want := append(codes(base), 1002)
					slices.Sort(want)
					got := codes(source)
					if !slices.Equal(got, want) {
						t.Fatalf("want %v got %v\n%s", want, got, source)
					}
				})
			}
		}
	}
}

func TestProducerArgumentParameterDiagnostics(t *testing.T) {
	for _, api := range []string{"take(ARG)", "Effect.gen(ARG)", "Effect.fnUntraced(ARG)", "Effect.fn(\"read\")(ARG)"} {
		for _, named := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/named=%t", api, named), func(t *testing.T) {
				pre := "import {Effect} from \"effect\";declare function take(body:()=>Generator<number,void,unknown>):void;"
				producer := "effect function*(n:number=\"\"){yield 1}"
				source := pre + strings.ReplaceAll(api, "ARG", producer)
				if named {
					source = pre + "effect function* producer(n:number=\"\"){yield 1};" + strings.ReplaceAll(api, "ARG", "producer")
				}
				program, file, _, _ := editorProgram(t, source)
				var got []int32
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() == diagnostics.CategoryError && (d.Source() == "" || d.Code() == 1002) {
						got = append(got, d.Code())
					}
				}
				slices.Sort(got)
				if !slices.Equal(got, []int32{1002, 2322}) {
					t.Fatalf("want EK1002 and TS2322 got %v\n%s", got, source)
				}
			})
		}
	}
}
