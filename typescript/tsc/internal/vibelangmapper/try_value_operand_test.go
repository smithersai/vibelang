package vibelangmapper

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestTryValueOperandRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	for _, key := range []string{"as", "satisfies", "conditional"} {
		for _, factory := range []bool{false, true} {
			for _, nested := range []bool{false, true} {
				label := key
				if factory {
					label += "/factory"
				}
				if nested {
					label += "/nested"
				}
				t.Run(label, func(t *testing.T) {
					call := `E.sync(()=>{events.push("outer");return E.sync(()=>{events.push("inner");return 7})})`
					if factory {
						call = "make()"
					}
					if nested {
						call = "E.succeed(try " + call + ")"
					}
					operand := call + " as Job"
					if key == "satisfies" {
						operand = call + " satisfies Job"
					}
					if key == "conditional" {
						operand = "true ? " + call + " : E.succeed(E.succeed(99))"
					}
					source := `import {Effect as E} from "effect";type Job=E.Effect<E.Effect<number>>;export effect function main(){const events:string[]=[];function make(){events.push("factory");return E.sync(()=>{events.push("outer");return E.sync(()=>{events.push("inner");return 7})})}const program=try (` + operand + `);events.push("after");const value=try program;return [value,events] as const}`
					js, _, diagnostics := Emit(source, testContext)
					if len(diagnostics) != 0 {
						t.Fatalf("valid operand: %v\n%s", diagnostics, js)
					}
					cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
					cmd.Dir = scope
					cmd.Stdin = strings.NewReader(js + `
import * as T from "effect/Effect";console.log(JSON.stringify(await T.runPromise(main())));`)
					out, err := cmd.CombinedOutput()
					want := `[7,["outer","after","inner"]]`
					if factory {
						want = `[7,["factory","outer","after","inner"]]`
					}
					if err != nil || strings.TrimSpace(string(out)) != want {
						t.Fatalf("one delegation at each written try: %v; %s\n%s", err, out, js)
					}
				})
			}
		}
	}
}
