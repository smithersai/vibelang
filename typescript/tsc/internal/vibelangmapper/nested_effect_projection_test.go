package vibelangmapper

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Chapter 1: "Calling an `effect` function returns its Effect unrun".
// Chapter 2: "`effect { … }` is an expression. It builds an Effect from
// the block without running it." Each written activation owns its body,
// including when native callbacks surround it.
func TestNestedEffectProjection(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"sync", "try", "map", "method"} {
		for depth := 1; depth <= 3; depth++ {
			t.Run(fmt.Sprintf("%s/depth-%d", kind, depth), func(t *testing.T) {
				holder := ""
				for level := 1; level <= depth; level++ {
					body := "runs++; const value = try sync(() => 1); return value + 1"
					if level > 1 {
						body = "runs++; const child = " + holder + "; const value = try child.run(); return value + 1"
					}
					switch kind {
					case "sync":
						holder = "try sync(() => ({ run: effect () => { " + body + " } }))"
					case "try":
						holder = "try Effect.try(() => ({ run: () => effect { " + body + " } }))"
					case "map":
						holder = "(try sync(() => [0].map(() => ({ run: effect () => { " + body + " } }))))[0]"
					case "method":
						holder = "try sync(() => ({ effect run() { " + body + " } }))"
					}
				}
				source := "let runs = 0; export function counter(): number { return runs }; export effect function main() { return " + holder + " }"
				projected := Project(source, testContext)
				if len(projected.Diagnostics) != 0 {
					t.Fatalf("projection diagnostics: %v\n%s", projected.Diagnostics, projected.Text)
				}
				if got := strings.Count(projected.Text, "$gen(function*"); got != depth+1 {
					t.Fatalf("got %d generator boundaries, want %d\n%s", got, depth+1, projected.Text)
				}
				if got := strings.Count(projected.Text, "yield* $run("); got < depth+1 {
					t.Fatalf("nested try was not projected: %d runs\n%s", got, projected.Text)
				}
				js, _, diagnostics := Emit(source, testContext)
				if len(diagnostics) != 0 {
					t.Fatalf("emit diagnostics: %v\n%s", diagnostics, js)
				}
				runner := `
import * as E from "effect/Effect";
const holder = await E.runPromise(main());
const program = holder.run();
const result = [counter(), E.isEffect(program)];
result.push(await E.runPromise(program), counter());
result.push(await E.runPromise(program), counter());
console.log(JSON.stringify(result));
`
				cmd := exec.CommandContext(t.Context(), node, "--no-warnings", "--input-type=module")
				cmd.Dir = scope
				cmd.Stdin = strings.NewReader(js + runner)
				out, err := cmd.CombinedOutput()
				if err != nil {
					t.Fatalf("projected runtime: %v\n%s\n%s", err, out, js)
				}
				want := fmt.Sprintf("[0,true,%d,%d,%d,%d]", depth+1, depth, depth+1, 2*depth)
				if got := strings.TrimSpace(string(out)); got != want {
					t.Fatalf("got %s, want %s\n%s", got, want, js)
				}
			})
		}
	}
}
