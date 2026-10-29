package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestBuiltinContractRenderings retains built-in failure contracts in Effect
// regions; a plain executable body keeps JavaScript calls and catch (D260).
func TestBuiltinContractRenderings(t *testing.T) {
	plain := `export function main() { try { return JSON.parse("{") } catch (e) { return e instanceof SyntaxError ? "caught SyntaxError" : "wrong" } }`
	effect := `import { Effect } from "effect"; export function main() { try { Effect.succeed(0); return JSON.parse("{") } catch (e) { return e instanceof SyntaxError ? "caught SyntaxError" : "wrong" } }`
	for name, pair := range map[string][2]Projection{
		"checking":   {Project(plain, testContext), Project(effect, testContext)},
		"executable": {Executable(plain, testContext), Executable(effect, testContext)},
	} {
		t.Run(name, func(t *testing.T) {
			for i, projection := range pair {
				if name == "executable" && i == 0 {
					if strings.Contains(projection.Text, "$trusted") || !strings.Contains(projection.Text, "JSON.parse") || !strings.Contains(projection.Text, "catch (e)") {
						t.Fatalf("plain body lost JavaScript catch:\n%s", projection.Text)
					}
				} else if !strings.Contains(projection.Text, "$trusted") || !strings.Contains(projection.Text, "[SyntaxError]") {
					t.Fatalf("missing built-in contract:\n%s", projection.Text)
				}
			}
		})
	}
}

// TestProviderMethodForm pins D173: even a pure service method returns an
// Effect when supplied by a provide block.
func TestProviderMethodForm(t *testing.T) {
	p := Project(`service Names { all(): ReadonlyArray<string>!!; count(): number!! } export function main() { provide Names = { all() { return ["b"] }, count() { sleep("1 millis"); return 2 } } { return Names.all() } }`, testContext)
	if len(p.Diagnostics) != 0 {
		t.Fatalf("provider diagnostics: %v", p.Diagnostics)
	}
	if !strings.Contains(p.Text, `all() { return $gen(`) {
		t.Fatalf("plain provider method:\n%s", p.Text)
	}
}

// TestCallbackContractChannels pins D12/D68: a callback's unwritten error
// and requirement channels remain polymorphic in its enclosing declaration.
func TestCallbackContractChannels(t *testing.T) {
	p := Project(`export function apply(f: (x: number) => number, x: number) { return f(x) } export function main() { return apply((x) => x * 2, 2) }`, testContext)
	if !strings.Contains(p.Text, "apply<E, R>") || !strings.Contains(p.Text, "Effect.Effect<number, E, R>") {
		t.Fatalf("plain callback type:\n%s", p.Text)
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
export function parsed() { try { return JSON.parse("{") } catch (e) { return e.name } }
export function rethrow() { try { return JSON.parse("{") } catch (e) { throw e } }
function ordered() {
 const original = JSON.parse
 try { return JSON.parse(sync(() => { JSON.parse = () => 0; return "{" })) }
 catch (e) { return e.name }
 // D229/EK4405: cleanup receives the saved function as a hatch input.
 finally { sync((original) => { JSON.parse = original }, original) }
}
export function main() {
 provide Names = { all() { return ["b"] } } {
  return [parsed(), Names.all(), apply((x) => x * 2, 2), ordered()]
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
		`apply<E, R>(f: (x: number) => Effect.Effect<number, E, R>, x: number): Effect.Effect<number, E, R>`,
		`parsed(): Effect.Effect<any, never, never>`,
		`rethrow(): Effect.Effect<any, SyntaxError, never>`,
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
	if strings.TrimSpace(string(out)) != `["SyntaxError",["b"],4,"SyntaxError"]` {
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

// TestBuiltinContractBoundaries keeps shadowed names and ambiguous spreads
// from silently acquiring the wrong failure contract.
func TestBuiltinContractBoundaries(t *testing.T) {
	for _, source := range []string{
		`function f(JSON: { parse(s: string): number }) { try { return JSON.parse("{") } catch (e) { return 0 } }`,
		`function f(decodeURI: (s: string) => string) { try { return decodeURI("%") } catch (e) { return "" } }`,
	} {
		p := Project(source, testContext)
		if strings.Contains(p.Text, "$trusted") {
			t.Fatalf("shadowed built-in: %s", p.Text)
		}
	}
	for _, source := range []string{
		`function f(args: [string]) { try { return JSON.parse(...args) } catch(e) { return 0 } }`,
		`function f(SyntaxError: typeof Error) { try { return JSON.parse("{") } catch(e) { return 0 } }`,
	} {
		p := Project(source, testContext)
		if len(p.Diagnostics) != 1 || p.Diagnostics[0].Code != CodeUnprojectedForm {
			t.Fatalf("need explicit contract: %v\n%s", p.Diagnostics, p.Text)
		}
	}
}
