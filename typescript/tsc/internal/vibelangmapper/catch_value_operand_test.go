package vibelangmapper

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestCatchValueOperandRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	for _, key := range []string{"direct", "as", "satisfies", "conditional"} {
		for _, factory := range []bool{false, true} {
			t.Run(key+map[bool]string{true: "/factory", false: "/native"}[factory], func(t *testing.T) {
				call := `E.sync(()=>{events.push("outer");return E.sync(()=>{events.push("inner");return 7})})`
				if factory {
					call = "make()"
				}
				operand := call
				switch key {
				case "as":
					operand = "(" + call + " as Job)"
				case "satisfies":
					operand = "(" + call + " satisfies Job)"
				case "conditional":
					operand = "(true ? " + call + " : E.succeed(E.succeed(99)))"
				}
				source := `import {Effect as E} from "effect";type Job=E.Effect<E.Effect<number>>;export effect function main(){const events:string[]=[];function make(){events.push("factory");return E.sync(()=>{events.push("outer");return E.sync(()=>{events.push("inner");return 7})})}const program=` + operand + ` catch ()=>E.succeed(99);events.push("after");const value=try program;return [value,events] as const}`
				js, _, diagnostics := Emit(source, testContext)
				if len(diagnostics) != 0 {
					t.Fatalf("valid operand: %v\n%s", diagnostics, js)
				}
				cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
				cmd.Dir = scope
				cmd.Stdin = strings.NewReader(js + "\n" + `import * as T from "effect/Effect";console.log(JSON.stringify(await T.runPromise(main())));`)
				out, err := cmd.CombinedOutput()
				want := `[7,["outer","after","inner"]]`
				if factory {
					want = `[7,["factory","outer","after","inner"]]`
				}
				if err != nil || strings.TrimSpace(string(out)) != want {
					t.Fatalf("one delegation at each written execution site: %v; %s\n%s", err, out, js)
				}
			})
		}
	}
}
