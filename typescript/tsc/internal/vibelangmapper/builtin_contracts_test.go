package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestBuiltinUncaughtContract keeps a built-in's expected failure in both
// renderings even when its enclosing Effect function does not catch it.
func TestBuiltinUncaughtContract(t *testing.T) {
	source := `export function parse(text: string) { return JSON.parse(text) as { port: number } }`
	for name, p := range map[string]Projection{"checking": Project(source, testContext), "executable": Executable(source, testContext)} {
		t.Run(name, func(t *testing.T) {
			if !strings.Contains(p.Text, "$trusted") || !strings.Contains(p.Text, "[SyntaxError]") {
				t.Fatalf("missing uncaught contract:\n%s", p.Text)
			}
			if strings.Contains(p.Text, "parse$direct") {
				t.Fatalf("escaping failure compiled as plain:\n%s", p.Text)
			}
		})
	}
}

// TestBuiltinVIP4Contract projects a global that VIP-4's table annotates
// beyond JSON.parse and decodeURI with its shipped failure class: "the Intl
// locale lookups RangeError".
func TestBuiltinVIP4Contract(t *testing.T) {
	source := `export function locales(tag: string) { return Intl.getCanonicalLocales(tag) }`
	for name, p := range map[string]Projection{"checking": Project(source, testContext), "executable": Executable(source, testContext)} {
		t.Run(name, func(t *testing.T) {
			if !strings.Contains(p.Text, "$trusted") || !strings.Contains(p.Text, "[RangeError]") {
				t.Fatalf("missing Intl.getCanonicalLocales contract:\n%s", p.Text)
			}
		})
	}
}

// TestBuiltinPlainCatch pins D54's synchronous direct entry, which a plain
// Array.map callback must call with JavaScript exception handling (D260).
func TestBuiltinPlainCatch(t *testing.T) {
	source := `function parseOr(text: string, fallback: number) { try { return JSON.parse(text) as number } catch(e) { return fallback } } export function main() { return ["1", "{"].map((text) => parseOr(text, 0)) }`
	p := Executable(source, testContext)
	if !strings.Contains(p.Text, "function parseOr$direct(") || strings.Contains(p.Text, "$trustedPlain") || strings.Contains(p.Text, "$caught") {
		t.Fatalf("plain body must retain native exceptions:\n%s", p.Text)
	}
}

// stockBuiltinProject assembles a stock compiler scope using the same pin
// and runtime as the parity harness, without changing the case sources.
func stockBuiltinProject(t *testing.T) (string, string) {
	t.Helper()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	scope := filepath.Join(mapperTestScope(t, root), "node_modules")
	if err := os.Symlink(scope, filepath.Join(dir, "node_modules")); err != nil {
		t.Fatal(err)
	}
	prelude, err := os.ReadFile(filepath.Join(root, "packages/ts-mapper/prelude.d.ts"))
	if err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{"package.json": `{"name":"vibelang-ts-mapper","type":"module","exports":{"./prelude":"./prelude.d.ts"}}`, "prelude.d.ts": string(prelude)} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return dir, stockTypeScriptPath(t, root)
}

// TestD251PlainCast proves that contextual typing of a plain cast does not
// let the data guard invent a Config/Exit intersection for an any-valued call.
func TestD251PlainCast(t *testing.T) {
	dir, stock := stockBuiltinProject(t)
	requireStockTypeScript(t, stock)
	source := `import { $gen, $run } from "./prelude.js";
export function parsed(text: string) { return $gen(function* () { return (yield* $run(JSON.parse(text))) as { port: number } }) }
export function plain(text: string) { return $gen(function* () { return yield* $run({ port: 80 }) }) }
`
	if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(stock, "--ignoreConfig", "--declaration", "--emitDeclarationOnly", "--skipLibCheck", "--strict", "--target", "esnext", "--module", "nodenext", "main.ts")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("plain cast rejected: %v\n%s", err, out)
	}
	decl, err := os.ReadFile(filepath.Join(dir, "main.d.ts"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(decl), "port: number;") {
		t.Fatalf("lost cast type:\n%s", decl)
	}
	if !strings.Contains(string(decl), "}, never, never>") {
		t.Fatalf("plain cast invented effect channels:\n%s", decl)
	}
	// A genuine Exit remains a data boundary even under the same cast context.
	negative := source + `
import { Exit } from "effect";
 declare function data(): Exit.Exit<number>;
 export function disguised() { return $gen(function* () { return (yield* $run(data())) as unknown as { port: number } }) }
 `
	if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte(negative), 0600); err != nil {
		t.Fatal(err)
	}
	cmd = exec.Command(stock, "--ignoreConfig", "--noEmit", "--skipLibCheck", "--strict", "--target", "esnext", "--module", "nodenext", "main.ts")
	cmd.Dir = dir
	out, err = cmd.CombinedOutput()
	if err == nil || strings.Count(string(out), "error TS") != 1 || !strings.Contains(string(out), "D251: data in a run position") {
		t.Fatalf("real data cast lost its boundary: %v\n%s", err, out)
	}
}

// TestBuiltinContractsCase checks the landed case through stock TypeScript
// and emitted JavaScript so static and runtime switch behavior stay aligned.
func TestBuiltinContractsCase(t *testing.T) {
	dir, stock := stockBuiltinProject(t)
	requireStockTypeScript(t, stock)
	source, err := os.ReadFile("../../../vibelang/cases/builtin-contracts/main.vibe")
	if err != nil {
		t.Fatal(err)
	}
	p := Project(string(source)+"\nexport { parse }", testContext)
	if len(p.Diagnostics) > 0 {
		t.Fatalf("%v", p.Diagnostics)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte(p.Text), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(stock, "--ignoreConfig", "--declaration", "--emitDeclarationOnly", "--skipLibCheck", "--strict", "--target", "esnext", "--module", "nodenext", "main.ts")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("stock: %v\n%s\n%s", err, out, p.Text)
	}
	decl, err := os.ReadFile(filepath.Join(dir, "main.d.ts"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"}, SyntaxError, never>", "plain: number[];"} {
		if !strings.Contains(string(decl), want) {
			t.Errorf("missing %s:\n%s", want, decl)
		}
	}
	js, _, ds := Emit(string(source), testContext)
	if len(ds) > 0 {
		t.Fatalf("%v", ds)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.mjs"), []byte(js+"\nconsole.log(JSON.stringify(await Effect.runPromise(main())))"), 0600); err != nil {
		t.Fatal(err)
	}
	cmd = exec.Command("node", "--no-warnings", "main.mjs")
	cmd.Dir = dir
	out, err = cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("exec: %v\n%s", err, out)
	}
	if strings.TrimSpace(string(out)) != `{"parsed":{"port":8080},"config":[8080,-1],"failure":"SyntaxError","plain":[1,0]}` {
		t.Fatalf("wrong result: %s", out)
	}
}

// TestBuiltinPlainCatchExceptions pins D260 for nested catches, catches
// without a binding, and explicit throws, under every tracing mode. An
// Effect catch still lets an unlisted exception through as a defect.
func TestBuiltinPlainCatchExceptions(t *testing.T) {
	source := `import { Effect } from "effect";
export function read(text: string) { try { return JSON.parse(text) as number } catch (e) { return e.name } }
export function anonymous(text: string) { try { return JSON.parse(text) as number } catch { return "fallback" } }
export function nested(text: string) { try { try { return JSON.parse(text) as number } catch (e) { throw e } } catch (e) { return e.name } }
export function unsafe(text: string) { try { return JSON.parse(text) as number } catch(e) { throw e } }
export function effectful(text: string) { try { Effect.succeed(0); return JSON.parse(text) as number } catch { return "caught" } }`
	for _, tracing := range []string{"", "all", "exported"} {
		t.Run(tracing, func(t *testing.T) {
			dir, _ := stockBuiltinProject(t)
			ctx := testContext
			ctx.Tracing = tracing
			js, _, ds := Emit(source, ctx)
			if len(ds) > 0 {
				t.Fatalf("%v", ds)
			}
			runner := `
import { Effect as Runner, Cause as RunnerCause, Exit as RunnerExit } from "effect";
const expected = [await Runner.runPromise(read("{")), await Runner.runPromise(anonymous("{")), await Runner.runPromise(nested("{"))];
const escaped = await Runner.runPromise(Runner.flip(unsafe("{")));
const original = JSON.parse;
JSON.parse = () => { throw new TypeError("defect") };
const caught = await Promise.all([read("{"), anonymous("{"), nested("{")].map((p) => Runner.runPromise(p)));
const defects = await Promise.all([unsafe("{"), effectful("{")].map((p) => Runner.runPromise(Runner.exit(p))));
JSON.parse = original;
console.log(JSON.stringify([expected, escaped.name, caught, defects.every((e) => RunnerExit.isFailure(e) && RunnerCause.hasDies(e.cause))]));`
			if err := os.WriteFile(filepath.Join(dir, "main.mjs"), []byte(js+runner), 0600); err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command("node", "--no-warnings", "main.mjs")
			cmd.Dir = dir
			out, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("exec: %v\n%s\n%s", err, out, js)
			}
			if strings.TrimSpace(string(out)) != `[["SyntaxError","fallback","SyntaxError"],"SyntaxError",["TypeError","fallback","TypeError"],true]` {
				t.Fatalf("wrong plain/Effect catch behavior: %s", out)
			}
		})
	}
}
