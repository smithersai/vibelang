package vibelang

import (
	"fmt"
	"maps"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestProducerCompatibleOverload(t *testing.T) {
	for _, target := range []string{"Stream.Stream<number>", "unknown", "any"} {
		for _, reverse := range []bool{false, true} {
			for _, shape := range []string{"inline", "wrapped", "declaration", "variable", "method"} {
				t.Run(fmt.Sprintf("%s/reverse=%t/%s", target, reverse, shape), func(t *testing.T) {
					accepted := "declare function take(f:()=>" + target + "):number;"
					rejected := "declare function take(f:()=>Generator<number,void,unknown>):string;"
					overloads := accepted + rejected
					if reverse {
						overloads = rejected + accepted
					}
					literal := "effect function*(){yield 1}"
					prefix, argument := "", literal
					switch shape {
					case "wrapped":
						argument = "(" + literal + ")"
					case "declaration":
						prefix = "effect function* p(){yield 1};"
						argument = "p"
					case "variable":
						prefix = "const p=" + literal + ";"
						argument = "p"
					case "method":
						prefix = "const object={effect *p(){yield 1}};"
						argument = "object.p"
					}
					source := "import {Stream} from \"effect\";" + overloads + prefix + "export const result:number=take(" + argument + ");"
					program, file, _, _ := editorProgram(t, source)
					got := map[int32]int{}
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Category() == diagnostics.CategoryError {
							got[d.Code()]++
						}
					}
					if !maps.Equal(got, map[int32]int{}) {
						t.Fatalf("want no errors, got %v\n%s", got, source)
					}
				})
			}
		}
	}
}

func TestProducerNativeGeneratorAPIRemainsRejected(t *testing.T) {
	for _, method := range []string{"gen", "fn"} {
		source := "import {Effect} from \"effect\";Effect." + method + "(effect function*(){yield 1;return 7});export {};"
		program, file, _, _ := editorProgram(t, source)
		found := false
		for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
			if d.Code() == 1002 {
				found = true
			}
		}
		if !found {
			t.Fatalf("want EK1002\n%s", source)
		}
	}
}
