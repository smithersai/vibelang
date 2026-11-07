package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestJoinNativePrimitiveRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "typescript/vibelang/cases/mapper-join-native/main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	for _, variant := range []struct{ name, before, operand string }{
		{"direct", "", "viewed"},
		{"grouped", "", "(viewed)"},
		{"asserted", "", "(viewed as F.Fiber<number>)"},
		{"completed", "try F.await(fiber);", "viewed"},
		{"factory", "function read(): F.Fiber<number> { return viewed }", "read()"},
		{"effect-factory", "", "((try E.succeed(viewed)) as F.Fiber<number>)"},
		{"hygiene", "const $join = 17; void $join;", "viewed"},
	} {
		t.Run(variant.name, func(t *testing.T) {
			source := strings.Replace(string(raw), "const value = join viewed", variant.before+" const value = join "+variant.operand, 1)
			js, _, diagnostics := Emit(source, testContext)
			if len(diagnostics) != 0 {
				t.Fatalf("valid Fiber join: %v\n%s", diagnostics, js)
			}
			cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
			cmd.Dir = scope
			cmd.Stdin = strings.NewReader(js + "\nimport * as TestEffect from \"effect/Effect\"; console.log(JSON.stringify(await TestEffect.runPromise(main())));")
			output, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("runtime: %v\n%s\n%s", err, output, js)
			}
			if got := strings.TrimSpace(string(output)); got != "[7,[]]" {
				t.Fatalf("join must preserve native Fiber.join observations: %s", got)
			}
		})
	}
}
