package vibelangmapper

import (
	"fmt"
	"testing"
)

func TestConcurrentWrittenBodyRange(t *testing.T) {
	for _, kind := range []string{"const", "let"} {
		for _, shape := range []struct{ name, head, rows, body string }{
			{"simple", "item", "[1,2]", "total += item"},
			{"object", "{ n }", "[{n:1},{n:2}]", "total += n"},
			{"array", "[n]", "[[1],[2]]", "total += n"},
			{"default", "{ n = 1 }", "[{}, {n:2}]", "total += n"},
			{"nested", "{ pair: [n] }", "[{pair:[1]},{pair:[2]}]", "total += n"},
			{"is-binding", "item", "[{n:1},{n:2}]", "if (item is {n:let value}) total += value"},
		} {
			for _, braced := range []bool{false, true} {
				for _, collision := range []bool{false, true} {
					t.Run(fmt.Sprintf("%s/%s/braced-%t/collision-%t", kind, shape.name, braced, collision), func(t *testing.T) {
						body := shape.body + ";"
						if braced {
							body = "{ " + body + " }"
						}
						prefix := ""
						if collision {
							prefix = "const $concurrentItem=9; const $concurrentItem_1=8;"
						}
						source := "export effect function sample() { " + prefix + " let total=0; for concurrent(1) (" + kind + " " + shape.head + " of " + shape.rows + ") " + body + " return total }"
						for _, p := range []Projection{Project(source, testContext), Executable(source, testContext)} {
							if len(p.Diagnostics) != 0 {
								t.Fatalf("valid loop must project without diagnostics: %v\n%s", p.Diagnostics, p.Text)
							}
							assertValidMap(t, p, source)
							assertParses(t, p.Text)
						}
						js, _, diagnostics := Emit(source, testContext)
						if len(diagnostics) != 0 {
							t.Fatalf("valid loop must emit: %v\n%s", diagnostics, js)
						}
						assertParses(t, js)
					})
				}
			}
		}
	}
}
