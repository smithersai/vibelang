package vibelangmapper

import (
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestEffectBlockSourceOwnership(t *testing.T) {
	for _, source := range []string{
		"export const value = effect { return Effect.fail(1) catch effect (e) => e + 1 }",
		"export const value = effect { const inner = effect { return Effect.fail(1) catch effect (e) => e }; return try inner }",
		"export effect function main() { return (effect { return 1 }) catch effect () => 2 }",
		"export effect function main() { return try effect { return 1 } }",
		"export effect function main() { const n = try effect { return 1 }\n  return n }",
		"export effect function main() { return try /* block */ effect { return 1 } }",
		"export effect function main() {\n  const n = 1\n  try effect { return n }\n  return n\n}",
		"export effect function main() { if (Math.random() > 2) try effect { return 1 }\n  return 2 }",
	} {
		got := Project(source, testContext)
		if len(got.Diagnostics) != 0 {
			t.Fatalf("explicit block: %v\n%s", got.Diagnostics, source)
		}
	}
	for _, source := range []string{
		"export const value = effect { const plain = () => Effect.fail(1) catch effect (e) => e; return 0 }",
		"export const value = () => Effect.fail(1) catch effect (e) => e",
	} {
		got := Project(source, testContext)
		count := 0
		for _, d := range got.Diagnostics {
			if d.Code == 504 {
				count++
			}
		}
		if count != 1 {
			t.Fatalf("plain boundary: want one EK0504, got %v\n%s", got.Diagnostics, source)
		}
	}
}

func TestEffectBlockRuntimeOwnership(t *testing.T) {
	// A try that runs a block directly loses its word in lower, so the block
	// must still run once, in place, at each position.
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	source := `import { Effect } from "effect"
let runs = 0
export function counter(): number { return runs }
export const value = effect {
    runs++
    return Effect.fail(1) catch () => 7
}
export effect function nested() {
    return try effect { runs++; return 5 }
}
export effect function statement() {
    const before = 1
    try effect { runs += before }
    return runs
}
export effect function branch(run: boolean) {
    if (run) try effect { runs += 10 }
    return runs
}
`
	js, _, diagnostics := Emit(source, testContext)
	if len(diagnostics) != 0 {
		t.Fatalf("%v\n%s", diagnostics, js)
	}
	runner := `
import * as E from "effect/Effect";
const p = nested();
const result = [counter(), E.isEffect(value), E.isEffect(p)];
result.push(await E.runPromise(value), counter());
result.push(await E.runPromise(value), counter());
result.push(await E.runPromise(p), counter());
result.push(await E.runPromise(statement()));
result.push(await E.runPromise(branch(false)), await E.runPromise(branch(true)));
console.log(JSON.stringify(result));
`
	cmd := exec.CommandContext(t.Context(), node, "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + runner)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%v\n%s\n%s", err, out, js)
	}
	if got, want := strings.TrimSpace(string(out)), "[0,true,true,7,1,7,2,5,3,4,4,14]"; got != want {
		t.Fatalf("got %s; want %s\n%s", got, want, js)
	}
}
