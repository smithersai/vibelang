package vibelangmapper

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// VIP-21's expression form returns the same cold Stream as a declaration.
func TestProducerExpressionProjection(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		producer     bool
	}{
		{"anonymous", "const values=effect function* () { yield 1 }", true},
		{"named", "const values=effect function* items() { yield 1 }", true},
		{"parenthesized", "const values=(effect function* () { yield 1 })", true},
		{"generic", "const values=effect function* <T>(value:T) { yield value }", true},
		{"default", "const values=effect function* (value=1) { yield value }", true},
		{"rest", "const values=effect function* (...values:number[]) { for(const value of values) yield value }", true},
		{"property", "const holder={values:effect function* () { yield 1 }}", true},
		{"array", "const values=[effect function* () { yield 1 }]", true},
		{"native", "const values=function* () { yield 1 }", false},
		{"native-async", "const values=async function* () { yield 1 }", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, mode := range []string{"checking", "lint", "execution"} {
				t.Run(mode, func(t *testing.T) {
					ctx := testContext
					ctx.Lint = mode == "lint"
					var projection Projection
					if mode == "execution" {
						projection = Executable(tc.source, ctx)
					} else {
						projection = Project(tc.source, ctx)
					}
					if len(projection.Diagnostics) != 0 {
						t.Fatalf("diagnostics: %v", projection.Diagnostics)
					}
					if strings.Contains(projection.Text, "$produce(") != tc.producer {
						t.Fatalf("producer=%t:\n%s", tc.producer, projection.Text)
					}
					assertParses(t, projection.Text)
					assertValidMap(t, projection, tc.source)
				})
			}
		})
	}
}

func TestProducerExpressionRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	for _, form := range []string{"effect function* (value=5)", "effect function* items(value=5)", "(effect function* (value=5)"} {
		t.Run(form, func(t *testing.T) {
			source := "import * as Eff from \"effect/Effect\"; import * as Str from \"effect/Stream\"; let starts=0; const factory=" + form + " { starts++; yield value; try Eff.void; yield value+1 }"
			if strings.HasPrefix(form, "(") {
				source += ")"
			}
			source += ";"
			js, _, diagnostics := Emit(source, testContext)
			if len(diagnostics) != 0 {
				t.Fatalf("diagnostics: %v\n%s", diagnostics, js)
			}
			runner := js + "\nimport * as TestEffect from \"effect/Effect\"; import * as TestStream from \"effect/Stream\"; const stream=factory(); const before=starts; const values=await TestEffect.runPromise(TestStream.runCollect(stream)); console.log(JSON.stringify([before,starts,...values]));"
			cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "--input-type=module")
			cmd.Dir = scope
			cmd.Stdin = strings.NewReader(runner)
			output, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("runtime: %v\n%s\n%s", err, output, js)
			}
			if strings.TrimSpace(string(output)) != "[0,1,5,6]" {
				t.Fatalf("cold Stream result: %s", output)
			}
		})
	}
}
