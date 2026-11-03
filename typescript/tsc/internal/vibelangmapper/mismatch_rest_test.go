package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestRemainingMismatchContracts checks the actual declarations as well as
// execution: generic Match stages retain inference and a fork keeps the child's Scope.
func TestRemainingMismatchContracts(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.Symlink(filepath.Join(mapperTestScope(t, root), "node_modules"), filepath.Join(dir, "node_modules")); err != nil {
		t.Fatal(err)
	}
	write := func(name, text string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	prelude, err := os.ReadFile(filepath.Join(root, "packages/ts-mapper/prelude.d.ts"))
	if err != nil {
		t.Fatal(err)
	}
	write("prelude.d.ts", string(prelude))
	write("package.json", `{"name":"vibelang-ts-mapper","type":"module","exports":{"./prelude":"./prelude.d.ts"}}`)
	source := `
import { Match } from "effect"
service Pool { acquire(): number!!Scope }
export function lease() { return Pool.acquire() }
export function forkedLease() { fork(() => lease()); return "forked" }
export function phase(x: "a" | "b") { return pipe(Match.value(x), Match.when("a", () => "A"), Match.orElse((s) => "other " + s)) }
export function main() { return { phases: [phase("a"), phase("b")] } }
`
	projection := Project(source, testContext)
	if len(projection.Diagnostics) > 0 {
		t.Fatal(projection.Diagnostics)
	}
	write("main.ts", projection.Text)
	stock := stockTypeScriptPath(t, root)
	requireStockTypeScript(t, stock)
	cmd := exec.Command(stock, "--ignoreConfig", "--declaration", "--emitDeclarationOnly", "--strict", "--skipLibCheck", "--target", "esnext", "--module", "nodenext", "main.ts")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("stock: %v\n%s\n%s", err, out, projection.Text)
	}
	declarations, err := os.ReadFile(filepath.Join(dir, "main.d.ts"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`phase(x: "a" | "b"): Effect.Effect<string, never, never>`, `forkedLease(): Effect.Effect<string, never, Pool | Scope.Scope>`} {
		if !strings.Contains(string(declarations), want) {
			t.Errorf("missing %s:\n%s", want, declarations)
		}
	}
	js, _, ds := Emit(source, testContext)
	if len(ds) > 0 {
		t.Fatal(ds)
	}
	write("main.mjs", js+"\nimport { Effect as RunnerEffect } from \"effect\";\nconsole.log(JSON.stringify(await RunnerEffect.runPromise(main())))")
	cmd = exec.Command("node", "--no-warnings", "main.mjs")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("exec: %v\n%s\n%s", err, out, js)
	}
	if strings.TrimSpace(string(out)) != `{"phases":["A","other b"]}` {
		t.Fatalf("result: %s", out)
	}
}
