package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestCatchOperandWrittenTryRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	for _, tc := range []struct{ name, operand, want string }{
		{"outer-failure", `(try E.fail("outer"))`, `["Failure","outer"]`},
		{"inner-failure", `(try E.succeed(E.fail("inner")))`, `["Success",7]`},
		{"inner-success", `(try E.succeed(E.succeed(3)))`, `["Success",3]`},
		{"wrapped-inner-failure", `((try E.succeed(E.fail("inner"))) as E.Effect<number,string>)`, `["Success",7]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import {Effect as E} from "effect";export effect function scenario(){return ` + tc.operand + ` catch ()=>7}`
			js, _, diags := Emit(source, testContext)
			if len(diags) != 0 {
				t.Fatalf("valid catch operand: %v\n%s", diags, js)
			}
			cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
			cmd.Dir = scope
			cmd.Stdin = strings.NewReader(js + "\n" + `import * as T from "effect/Effect";console.log(JSON.stringify(await T.runPromise(T.match(scenario(),{onFailure:e=>["Failure",e],onSuccess:v=>["Success",v]}))));`)
			out, err := cmd.CombinedOutput()
			if err != nil || strings.TrimSpace(string(out)) != tc.want {
				t.Fatalf("written try must run before the catch boundary: %v; %s\n%s", err, out, js)
			}
		})
	}
}

func TestCatchHeldOperandCaseRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile(filepath.Join(root, "typescript/vibelang/cases/catch-held-operand/main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	js, _, diags := Emit(string(source), testContext)
	if len(diags) != 0 {
		t.Fatalf("valid held-operand case: %v\n%s", diags, js)
	}
	scope := mapperTestScope(t, root)
	cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\n" + `import * as T from "effect/Effect";console.log(JSON.stringify(await T.runPromise(main())));`)
	out, err := cmd.CombinedOutput()
	if err != nil || strings.TrimSpace(string(out)) != `[7,99,7,99,7,99,7,99,7,99,7,99,"outer",7]` {
		t.Fatalf("held operand case: %v; %s\n%s", err, out, js)
	}
}
