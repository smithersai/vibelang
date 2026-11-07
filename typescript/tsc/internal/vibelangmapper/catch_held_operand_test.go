package vibelangmapper

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestCatchHeldOperandRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	for _, key := range []string{"identifier", "as", "satisfies", "conditional", "property", "element"} {
		t.Run(key, func(t *testing.T) {
			operand := "held"
			switch key {
			case "as":
				operand = "(held as Job)"
			case "satisfies":
				operand = "(held satisfies Job)"
			case "conditional":
				operand = "(true ? held : E.succeed(99))"
			case "property":
				operand = "box.held"
			case "element":
				operand = `box["held"]`
			}
			source := `import {Effect as E} from "effect";type Job=E.Effect<number,string>;export const events:string[]=[];export effect function main(held:Job){const box={held};const program=` + operand + ` catch ()=>{events.push("fallback");return 99};events.push("after");return [program,events] as const}`
			js, _, diagnostics := Emit(source, testContext)
			if len(diagnostics) != 0 {
				t.Fatalf("valid operand: %v\n%s", diagnostics, js)
			}
			for _, failure := range []bool{false, true} {
				t.Run(map[bool]string{true: "failure", false: "success"}[failure], func(t *testing.T) {
					value := `T.sync(()=>{events.push("outer");return 7})`
					want := `[7,["outer","after"]]`
					if failure {
						value = `T.fail("bad")`
						want = `[99,["fallback","after"]]`
					}
					cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
					cmd.Dir = scope
					cmd.Stdin = strings.NewReader(js + "\n" + `import * as T from "effect/Effect";console.log(JSON.stringify(await T.runPromise(main(` + value + `))));`)
					out, err := cmd.CombinedOutput()
					if err != nil || strings.TrimSpace(string(out)) != want {
						t.Fatalf("catch must run its operand once and invoke a plain fallback only on failure: %v; %s\n%s", err, out, js)
					}
				})
			}
		})
	}
}
