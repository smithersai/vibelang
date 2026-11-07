package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestConcurrentHeadExecutionProjection(t *testing.T) {
	for _, head := range []struct{ name, binding, rows string }{
		{"object-default", "{ n = do { try Effect.void; 7 } }", "[{}]"},
		{"array-default", "[n = do { try Effect.void; 7 }]", "[[]]"},
		{"computed-key", "{ [do { try Effect.void; \"n\" }]: n }", "[{n:7}]"},
	} {
		t.Run(head.name, func(t *testing.T) {
			source := "export effect function sample() { let total=0; for concurrent(1) (const " + head.binding + " of " + head.rows + ") { total += n } return total }"
			for _, p := range []Projection{Project(source, testContext), Executable(source, testContext)} {
				if len(p.Diagnostics) != 0 {
					t.Fatalf("head initialization is effect code: %v\n%s", p.Diagnostics, p.Text)
				}
				assertParses(t, p.Text)
				assertValidMap(t, p, source)
			}
		})
	}
}

func TestConcurrentHeadExecutionRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile(filepath.Join(root, "typescript/vibelang/cases/concurrent-head-execution/main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	js, _, diagnostics := Emit(string(source), testContext)
	if len(diagnostics) != 0 {
		t.Fatalf("item defaults must emit: %v\n%s", diagnostics, js)
	}
	cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\nimport * as TestEffect from \"effect/Effect\"; console.log(JSON.stringify(await TestEffect.runPromise(main())));")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("runtime: %v\n%s\n%s", err, output, js)
	}
	if got := strings.TrimSpace(string(output)); got != "[7,2,8,9,10,11,7,4]" {
		t.Fatalf("wrong default order/scope: %s", got)
	}
}
