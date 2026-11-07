package vibelangmapper

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestForkOwnerExplicitTryRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	for _, operator := range []string{"fork", "fork.in(s)", "fork.scoped", "fork.detached"} {
		t.Run(operator, func(t *testing.T) {
			source := `import { Effect as E, Fiber as F, Scope as S } from "effect"; export effect function scenario(s:S.Scope) { const f=OP ((try E.succeed(E.succeed(7))) as E.Effect<number>); return try F.join(f) }`
			js, _, diagnostics := Emit(strings.Replace(source, "OP", operator, 1), testContext)
			if len(diagnostics) != 0 {
				t.Fatalf("valid fork operand: %v\n%s", diagnostics, js)
			}
			cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
			cmd.Dir = scope
			cmd.Stdin = strings.NewReader(js + `
import * as TestEffect from "effect/Effect"; const result=await TestEffect.runPromise(TestEffect.scoped(TestEffect.gen(function*(){const s=yield* TestEffect.scope; return yield* scenario(s)}))); console.log(JSON.stringify(result));`)
			output, err := cmd.CombinedOutput()
			if err != nil || strings.TrimSpace(string(output)) != "7" {
				t.Fatalf("explicit try must run before forking its result: %v; %s\n%s", err, output, js)
			}
		})
	}
}
