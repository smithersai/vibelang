package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

// VIP-21: a written producer has no return value, whatever API receives it.
// Ordinary JavaScript generators retain their iterator return values.
func TestProducerAPIReturns(t *testing.T) {
	for _, api := range []struct{ key, call string }{
		{"custom", "take(ARG)"},
		{"effect-gen", "Effect.gen(ARG)"},
		{"effect-fn", "Effect.fnUntraced(ARG)"},
		{"effect-fn-named", "Effect.fn(\"read\")(ARG)"},
	} {
		for _, home := range []string{"inline", "named", "alias"} {
			for _, body := range []struct {
				key, source string
				own, nested int
			}{
				{"value", "return 1", 1, 0},
				{"undefined", "return undefined", 1, 0},
				{"void", "return void 0", 1, 0},
				{"guarded", "if (true) return 1", 1, 0},
				{"two", "if (true) return 1; return 2", 2, 0},
				{"bare", "yield 1; return", 0, 0},
				{"nested-function", "const f=()=>{return 1}; void f; return", 0, 0},
				{"nested-generator", "function* inner(){return 1}; return", 0, 0},
				{"nested-producer", "effect function* inner(){return 1}; return", 0, 1},
			} {
				for _, marker := range []string{"effect ", ""} {
					t.Run(fmt.Sprintf("%s/%s/%s/producer=%t", api.key, home, body.key, marker != ""), func(t *testing.T) {
						pre := "import {Effect} from \"effect\"; declare function take(body:()=>Generator<number,void,unknown>):void;"
						arg := marker + "function*(){" + body.source + "}"
						if home != "inline" {
							pre += marker + "function* producer(){" + body.source + "};"
							arg = "producer"
							if home == "alias" {
								pre += "const alias=producer;"
								arg = "alias"
							}
						}
						source := pre + strings.ReplaceAll(api.call, "ARG", arg)
						p, f, _, _ := editorProgram(t, source)
						ds := append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...)
						got := 0
						for _, d := range ds {
							if d.Code() == EK2128.Code {
								got++
							}
						}
						want := body.nested
						if marker != "" {
							want += body.own
						}
						if got != want {
							t.Fatalf("want EK2128 x%d, got x%d: %v\n%s", want, got, ds, source)
						}
					})
				}
			}
		}
	}
}
