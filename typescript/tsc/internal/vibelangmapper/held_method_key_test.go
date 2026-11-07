package vibelangmapper

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestHeldComputedMethodKeyRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	const key = `try E.sync((): string => { trace.push("key"); return "method" })`
	for _, row := range []struct{ name, value, target string }{
		{"method", `{ [KEY]():number { trace.push("body"); return 7 } }`, ""},
		{"getter", `{ get [KEY]():number { trace.push("body"); return 7 } }`, ""},
		{"setter", `{ set [KEY](value:number) { trace.push("body"); void value } }`, ""},
		{"class", `class { [KEY]():number { trace.push("body"); return 7 } }`, ".prototype"},
		{"static", `class { static [KEY]():number { trace.push("body"); return 7 } }`, ""},
		{"property-control", `{ [KEY]: 7 }`, ""},
		{"outside", `{ [KEY]():number { trace.push("body"); return 7 } }`, ""},
		{"cold", `{ [KEY]():number { trace.push("body"); return 7 } }`, ""},
		{"cold-property-outside", `{ [KEY]: 7 }`, ""},
	} {
		t.Run(row.name, func(t *testing.T) {
			expression := key
			expected := `[true,["key"]]`
			if strings.HasPrefix(row.name, "cold") {
				expression = "(" + strings.TrimPrefix(key, "try ") + " as any)"
				expected = `[false,[]]`
			}
			value := strings.Replace(row.value, "KEY", expression, 1)
			collection := "try.all [E.succeed(" + value + ")]"
			if strings.Contains(row.name, "outside") {
				collection = "[" + value + "]"
			}
			source := `import {Effect as E} from "effect"; export effect function main(){const trace:string[]=[];const items=` + collection + `;return ["method" in items[0]` + row.target + `,trace] as const}`
			js, _, diagnostics := Emit(source, testContext)
			if len(diagnostics) != 0 {
				t.Fatalf("valid computed key: %v\n%s", diagnostics, js)
			}
			cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
			cmd.Dir = scope
			cmd.Stdin = strings.NewReader(js + `
import * as TestEffect from "effect/Effect"; console.log(JSON.stringify(await TestEffect.runPromise(main())));`)
			output, err := cmd.CombinedOutput()
			if err != nil || strings.TrimSpace(string(output)) != expected {
				t.Fatalf("key runs once while body stays deferred: %v; %s\n%s", err, output, js)
			}
		})
	}
}
