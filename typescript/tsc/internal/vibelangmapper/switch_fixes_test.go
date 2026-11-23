package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestProviderMethodForm pins D173 under VIP-1: a provider method written
// effect returns an Effect, and the provide block runs the body under it.
func TestProviderMethodForm(t *testing.T) {
	p := Project(`service Names { all(): ReadonlyArray<string>!!; count(): number!! } export effect function main() { provide Names = { effect all() { return ["b"] }, effect count() { try sleep("1 millis"); return 2 } } { return try (try Names).all() } }`, testContext)
	if len(p.Diagnostics) != 0 {
		t.Fatalf("provider diagnostics: %v", p.Diagnostics)
	}
	for _, want := range []string{`all() { return $gen(`, `count() { return $gen(`, `$provideService(Names, "Names", {`, `.all()))`} {
		if !strings.Contains(p.Text, want) {
			t.Fatalf("missing %s:\n%s", want, p.Text)
		}
	}
}

// TestSwitchFixStockTypesAndExecution checks actual declarations and runs the
// emitted JavaScript, so a matching text edit alone cannot satisfy the switch gate.
func TestSwitchFixStockTypesAndExecution(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	stock := stockTypeScriptPath(t, root)
	requireStockTypeScript(t, stock)
	scope := filepath.Join(mapperTestScope(t, root), "node_modules")
	dir := t.TempDir()
	if err := os.Symlink(scope, filepath.Join(dir, "node_modules")); err != nil {
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
service Names { all(): ReadonlyArray<string>!! }
export function apply(f: (x: number) => number, x: number) { return f(x) }
export function parsed() { try { return JSON.parse("{") } catch (e) { return (e as Error).name } }
export function rethrow() { try { return JSON.parse("{") } catch (e) { throw e } }
export effect function main() {
 provide Names = { effect all() { return ["b"] } } {
  return [parsed(), try (try Names).all(), apply((x) => x * 2, 2)]
 }
}`
	projection := Project(source, testContext)
	if len(projection.Diagnostics) > 0 {
		t.Fatalf("%v", projection.Diagnostics)
	}
	write("main.ts", projection.Text)
	cmd := exec.Command(stock, "--ignoreConfig", "--declaration", "--emitDeclarationOnly", "--skipLibCheck", "--strict", "--target", "esnext", "--module", "nodenext", "main.ts")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("stock: %v\n%s\n%s", err, out, projection.Text)
	}
	declarations, err := os.ReadFile(filepath.Join(dir, "main.d.ts"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`apply(f: (x: number) => number, x: number): number;`,
		`parsed(): any;`,
		`rethrow(): any;`,
	} {
		if !strings.Contains(string(declarations), want) {
			t.Errorf("missing %s:\n%s", want, declarations)
		}
	}
	js, _, ds := Emit(source, testContext)
	if len(ds) > 0 {
		t.Fatalf("%v", ds)
	}
	// The runner is ordinary JavaScript, outside the projected source, with its own import.
	write("main.mjs", js+"\nimport * as RunnerEffect from \"effect/Effect\"\nconsole.log(JSON.stringify(await RunnerEffect.runPromise(main())))")
	cmd = exec.Command("node", "--no-warnings", "main.mjs")
	cmd.Dir = dir
	out, err = cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("exec: %v\n%s\n%s", err, out, js)
	}
	if strings.TrimSpace(string(out)) != `["SyntaxError",["b"],4]` {
		t.Fatalf("caught failure: %s", out)
	}
}

// TestBuiltinContractsGenerated keeps the projector's contracts generated from
// the checker's globalThrowsTable (VIP-4), the one list of what JavaScript's
// globals throw, even when an annotation changes without go generate.
func TestBuiltinContractsGenerated(t *testing.T) {
	fresh := filepath.Join(t.TempDir(), "builtin_contracts_generated.go")
	if out, err := exec.Command("go", "run", "gen_builtin_contracts.go", "-o", fresh).CombinedOutput(); err != nil {
		t.Fatalf("go run gen_builtin_contracts.go: %v\n%s", err, out)
	}
	want, err := os.ReadFile(fresh)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile("builtin_contracts_generated.go")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatalf("builtin contracts changed; run go generate builtin_contracts.go:\n%s", want)
	}
}
