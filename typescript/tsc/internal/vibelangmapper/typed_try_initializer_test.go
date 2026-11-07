package vibelangmapper

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestTypedEffectInitializerTryRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	for _, kind := range []string{"const", "let"} {
		for _, typ := range []string{"E.Effect<number>", "Job", "E.Effect<number>|E.Effect<number>"} {
			for _, form := range []string{"direct", "operand-parens", "try-parens"} {
				t.Run(kind+"/"+typ+"/"+form, func(t *testing.T) {
					source := `import {Effect as E} from "effect";type Job=E.Effect<number>;export effect function main(){const events:string[]=[];KIND program:TYPE=try E.sync(()=>{events.push("construct");return E.succeed(7)});events.push("after-bind");const value=try program;return [value,events] as const}`
					source = strings.Replace(strings.Replace(source, "KIND", kind, 1), "TYPE", typ, 1)
					if form == "operand-parens" {
						source = strings.Replace(source, "=try E.sync(", "=try (E.sync(", 1)
						source = strings.Replace(source, "E.succeed(7)});events", "E.succeed(7)}));events", 1)
					}
					if form == "try-parens" {
						source = strings.Replace(source, "=try E.sync(", "=(try E.sync(", 1)
						source = strings.Replace(source, "E.succeed(7)});events", "E.succeed(7)}));events", 1)
					}
					js, _, diagnostics := Emit(source, testContext)
					if len(diagnostics) != 0 {
						t.Fatalf("valid typed initializer: %v\n%s", diagnostics, js)
					}
					cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
					cmd.Dir = scope
					cmd.Stdin = strings.NewReader(js + `
import * as TestEffect from "effect/Effect";console.log(JSON.stringify(await TestEffect.runPromise(main())));`)
					output, err := cmd.CombinedOutput()
					if err != nil || strings.TrimSpace(string(output)) != `[7,["construct","after-bind"]]` {
						t.Fatalf("initializer must run exactly once at binding: %v; %s\n%s", err, output, js)
					}
				})
			}
		}
	}
}
