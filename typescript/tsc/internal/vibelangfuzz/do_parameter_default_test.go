package vibelangfuzz

import (
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-2 on a return in a parameter default. The quotes are the oracle; the
// compiler's lowering is its own choice.
const (
	doParameterReturnQuote = "A `return` in a parameter default stays legal, as the pinned proposal says, and acts as `return` at the top of the body: a plain function returns the value, an `async` function fulfills with it"
	doParameterLengthQuote = "so the `return` returns from the function; `length` is unchanged"
	doParameterTDZQuote    = "including its temporal-dead-zone exception: JavaScript has none, so VibeLang has none."
)

func TestDoParameterDefaultQuoted(t *testing.T) {
	chapter, err := os.ReadFile(SpecPath("../vips/0002-effect-blocks-and-do.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{doParameterReturnQuote, doParameterLengthQuote, doParameterTDZQuote} {
		if !strings.Contains(string(chapter), quote) {
			t.Errorf("VIP-2 no longer says %q", quote)
		}
	}
}

// TestDoParameterDefaultReturn holds the lowering of a returning parameter
// default to JavaScript's parameter semantics, which the VIP differential
// witnesses cannot express in Effect TypeScript: the function's length, a
// later parameter's temporal dead zone, a closure sharing the body's binding,
// the order of the later defaults, this in a method, an async function's
// fulfilment, and the declaration output of an untyped parameter.
func TestDoParameterDefaultReturn(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		Missing(t, "TestDoParameterDefaultReturn needs node on PATH")
	}
	w := NewWorkspace(t)
	for _, test := range []struct {
		name, source, want string
		allowed            []string // TypeScript error codes the native program also has
		declaration        string   // text out/main.d.ts must hold
	}{
		{
			name:   "rest function plain",
			source: "export function run() { const log: string[] = []; function f(stop: boolean, a: number = do { log.push(\"default\"); if (stop) return -1; 1 }, ...rest: number[]) { log.push(\"body:\" + rest.join(\":\")); return a + rest.reduce((sum, n) => sum + n, 0) }; return [f(false, undefined, 2, 3), f(true, undefined, 2, 3), f(false, 4, 2, 3), f.length, log] }",
			want:   "[6,-1,9,1,[\"default\",\"body:2:3\",\"default\",\"body:2:3\"]]",
		},
		{
			name:   "rest function async",
			source: "export async function run() { const log: string[] = []; async function f(stop: boolean, a: number = do { log.push(\"default\"); if (stop) return -1; 1 }, ...rest: number[]) { log.push(\"body:\" + rest.join(\":\")); return a + rest.reduce((sum, n) => sum + n, 0) }; return [await f(false, undefined, 2, 3), await f(true, undefined, 2, 3), await f(false, 4, 2, 3), f.length, log] }",
			want:   "[6,-1,9,1,[\"default\",\"body:2:3\",\"default\",\"body:2:3\"]]",
		},
		{
			name:   "rest expression plain",
			source: "export function run() { const log: string[] = []; const f = function(stop: boolean, a: number = do { log.push(\"default\"); if (stop) return -1; 1 }, ...rest: number[]) { log.push(\"body:\" + rest.join(\":\")); return a + rest.reduce((sum, n) => sum + n, 0) }; return [f(false, undefined, 2, 3), f(true, undefined, 2, 3), f(false, 4, 2, 3), f.length, log] }",
			want:   "[6,-1,9,1,[\"default\",\"body:2:3\",\"default\",\"body:2:3\"]]",
		},
		{
			name:   "rest expression async",
			source: "export async function run() { const log: string[] = []; const f = async function(stop: boolean, a: number = do { log.push(\"default\"); if (stop) return -1; 1 }, ...rest: number[]) { log.push(\"body:\" + rest.join(\":\")); return a + rest.reduce((sum, n) => sum + n, 0) }; return [await f(false, undefined, 2, 3), await f(true, undefined, 2, 3), await f(false, 4, 2, 3), f.length, log] }",
			want:   "[6,-1,9,1,[\"default\",\"body:2:3\",\"default\",\"body:2:3\"]]",
		},
		{
			name:   "rest arrow plain",
			source: "export function run() { const log: string[] = []; const f = (stop: boolean, a: number = do { log.push(\"default\"); if (stop) return -1; 1 }, ...rest: number[]) => { log.push(\"body:\" + rest.join(\":\")); return a + rest.reduce((sum, n) => sum + n, 0) }; return [f(false, undefined, 2, 3), f(true, undefined, 2, 3), f(false, 4, 2, 3), f.length, log] }",
			want:   "[6,-1,9,1,[\"default\",\"body:2:3\",\"default\",\"body:2:3\"]]",
		},
		{
			name:   "rest arrow async",
			source: "export async function run() { const log: string[] = []; const f = async (stop: boolean, a: number = do { log.push(\"default\"); if (stop) return -1; 1 }, ...rest: number[]) => { log.push(\"body:\" + rest.join(\":\")); return a + rest.reduce((sum, n) => sum + n, 0) }; return [await f(false, undefined, 2, 3), await f(true, undefined, 2, 3), await f(false, 4, 2, 3), f.length, log] }",
			want:   "[6,-1,9,1,[\"default\",\"body:2:3\",\"default\",\"body:2:3\"]]",
		},
		{
			name:   "rest method plain",
			source: "export function run() { const log: string[] = []; const box = { read(stop: boolean, a: number = do { log.push(\"default\"); if (stop) return -1; 1 }, ...rest: number[]) { log.push(\"body:\" + rest.join(\":\")); return a + rest.reduce((sum, n) => sum + n, 0) } }; const f = box.read; return [f(false, undefined, 2, 3), f(true, undefined, 2, 3), f(false, 4, 2, 3), f.length, log] }",
			want:   "[6,-1,9,1,[\"default\",\"body:2:3\",\"default\",\"body:2:3\"]]",
		},
		{
			name:   "rest method async",
			source: "export async function run() { const log: string[] = []; const box = { async read(stop: boolean, a: number = do { log.push(\"default\"); if (stop) return -1; 1 }, ...rest: number[]) { log.push(\"body:\" + rest.join(\":\")); return a + rest.reduce((sum, n) => sum + n, 0) } }; const f = box.read; return [await f(false, undefined, 2, 3), await f(true, undefined, 2, 3), await f(false, 4, 2, 3), f.length, log] }",
			want:   "[6,-1,9,1,[\"default\",\"body:2:3\",\"default\",\"body:2:3\"]]",
		},
		{
			name:   "rest earlier closure follows reassignment",
			source: "export function run() { function f(read = () => rest, a: number = do { if (false) return -1; 1 }, ...rest: number[]) { const initial = rest; rest = [...rest, a]; return [read() === rest, read() === initial, read().slice(), read.name] }; return [f(undefined, undefined, 2, 3), f(undefined, 4, 5)] }",
			want:   "[[true,false,[2,3,1],\"read\"],[true,false,[5,4],\"read\"]]",
		},
		{
			name:   "rest temporal dead zone through closure",
			source: "export function run() { function f(read = () => rest, a: number = do { read(); if (false) return -1; 1 }, ...rest: number[]) { return rest.length }; try { return f() } catch(e) { return (e as Error).constructor.name } }",
			want:   "\"ReferenceError\"",
		},
		{
			name:        "rest generic declaration",
			source:      "export function collect<T>(value: T, seed: number = do { if (false) return [value]; 0 }, ...rest: T[]) { return [value, ...rest] }\nexport function run() { return [collect(\"a\", undefined, \"b\"), collect(1, 3, 2), collect.length] }",
			want:        "[[\"a\",\"b\"],[1,2],1]",
			declaration: "collect<T>(value: T, seed?: number, ...rest: T[]): T[]",
		},
		{
			name:        "rest contextual arrow type",
			source:      "export const f: (stop?: boolean, ...rest: number[]) => number = (stop = do { if (false) return 8; false }, ...rest) => rest.reduce((sum, n) => sum + n, 0)\nexport function run() { return [f(undefined, 2, 3), f(true, 4), f.length] }",
			want:        "[5,4,0]",
			declaration: "(stop?: boolean, ...rest: number[]) => number",
		},
		{
			name:   "earlier closure function plain read",
			source: "export function run() { function f(read = () => a, a: number = do { if (false) return -1; 1 }) { return [a, read()] }; return [f(), f(undefined, 5), f(() => 7)] }",
			want:   "[[1,1],[5,5],[1,7]]",
		},
		{
			name:   "earlier closure function plain mutation",
			source: "export function run() { function f(read = () => a, a: number = do { if (false) return -1; 1 }) { a = 9; return [a, read()] }; return [f(), f(undefined, 5), f(() => 7)] }",
			want:   "[[9,9],[9,9],[9,7]]",
		},
		{
			name:   "earlier closure function async read",
			source: "export async function run() { async function f(read = () => a, a: number = do { if (false) return -1; 1 }) { return [a, read()] }; return [await f(), await f(undefined, 5), await f(() => 7)] }",
			want:   "[[1,1],[5,5],[1,7]]",
		},
		{
			name:   "earlier closure function async mutation",
			source: "export async function run() { async function f(read = () => a, a: number = do { if (false) return -1; 1 }) { a = 9; return [a, read()] }; return [await f(), await f(undefined, 5), await f(() => 7)] }",
			want:   "[[9,9],[9,9],[9,7]]",
		},
		{
			name:   "earlier closure expression plain read",
			source: "export function run() { const f = function(read = () => a, a: number = do { if (false) return -1; 1 }) { return [a, read()] }; return [f(), f(undefined, 5), f(() => 7)] }",
			want:   "[[1,1],[5,5],[1,7]]",
		},
		{
			name:   "earlier closure expression plain mutation",
			source: "export function run() { const f = function(read = () => a, a: number = do { if (false) return -1; 1 }) { a = 9; return [a, read()] }; return [f(), f(undefined, 5), f(() => 7)] }",
			want:   "[[9,9],[9,9],[9,7]]",
		},
		{
			name:   "earlier closure expression async read",
			source: "export async function run() { const f = async function(read = () => a, a: number = do { if (false) return -1; 1 }) { return [a, read()] }; return [await f(), await f(undefined, 5), await f(() => 7)] }",
			want:   "[[1,1],[5,5],[1,7]]",
		},
		{
			name:   "earlier closure expression async mutation",
			source: "export async function run() { const f = async function(read = () => a, a: number = do { if (false) return -1; 1 }) { a = 9; return [a, read()] }; return [await f(), await f(undefined, 5), await f(() => 7)] }",
			want:   "[[9,9],[9,9],[9,7]]",
		},
		{
			name:   "earlier closure arrow plain read",
			source: "export function run() { const f = (read = () => a, a: number = do { if (false) return -1; 1 }) => { return [a, read()] }; return [f(), f(undefined, 5), f(() => 7)] }",
			want:   "[[1,1],[5,5],[1,7]]",
		},
		{
			name:   "earlier closure arrow plain mutation",
			source: "export function run() { const f = (read = () => a, a: number = do { if (false) return -1; 1 }) => { a = 9; return [a, read()] }; return [f(), f(undefined, 5), f(() => 7)] }",
			want:   "[[9,9],[9,9],[9,7]]",
		},
		{
			name:   "earlier closure arrow async read",
			source: "export async function run() { const f = async (read = () => a, a: number = do { if (false) return -1; 1 }) => { return [a, read()] }; return [await f(), await f(undefined, 5), await f(() => 7)] }",
			want:   "[[1,1],[5,5],[1,7]]",
		},
		{
			name:   "earlier closure arrow async mutation",
			source: "export async function run() { const f = async (read = () => a, a: number = do { if (false) return -1; 1 }) => { a = 9; return [a, read()] }; return [await f(), await f(undefined, 5), await f(() => 7)] }",
			want:   "[[9,9],[9,9],[9,7]]",
		},
		{
			name:   "earlier closure method plain read",
			source: "export function run() { const box = { f(read = () => a, a: number = do { if (false) return -1; 1 }) { return [a, read()] } }; const f = (...args: Parameters<typeof box.f>) => box.f(...args); return [f(), f(undefined, 5), f(() => 7)] }",
			want:   "[[1,1],[5,5],[1,7]]",
		},
		{
			name:   "earlier closure method plain mutation",
			source: "export function run() { const box = { f(read = () => a, a: number = do { if (false) return -1; 1 }) { a = 9; return [a, read()] } }; const f = (...args: Parameters<typeof box.f>) => box.f(...args); return [f(), f(undefined, 5), f(() => 7)] }",
			want:   "[[9,9],[9,9],[9,7]]",
		},
		{
			name:   "earlier closure method async read",
			source: "export async function run() { const box = { async f(read = () => a, a: number = do { if (false) return -1; 1 }) { return [a, read()] } }; const f = (...args: Parameters<typeof box.f>) => box.f(...args); return [await f(), await f(undefined, 5), await f(() => 7)] }",
			want:   "[[1,1],[5,5],[1,7]]",
		},
		{
			name:   "earlier closure method async mutation",
			source: "export async function run() { const box = { async f(read = () => a, a: number = do { if (false) return -1; 1 }) { a = 9; return [a, read()] } }; const f = (...args: Parameters<typeof box.f>) => box.f(...args); return [await f(), await f(undefined, 5), await f(() => 7)] }",
			want:   "[[9,9],[9,9],[9,7]]",
		},
		{
			name:   "earlier closure observes the later initializer's temporal dead zone",
			source: "export function run() { function f(read: () => number = () => a, a: number = do { if (false) return -1; read() }) { return a }; try { return f() } catch (e) { return (e as Error).constructor.name } }",
			want:   "\"ReferenceError\"",
		},
		{
			name:   "earlier value read by returning default",
			source: "export function run() { function f(x = 3, a: number = do { return x }) { return a }; return f() }",
			want:   "3",
		},
		{
			name:   "earlier closure writes later binding",
			source: "export function run() { function f(write = (n: number) => a = n, a: number = do { if (false) return -1; 1 }) { write(8); return a }; return f() }",
			want:   "8",
		},
		{
			name:   "anonymous callback keeps its parameter name",
			source: "export function run() { function f(read = () => a, a: number = do { if (false) return -1; 1 }) { return read.name }; return f() }",
			want:   "\"read\"",
		},
		{
			name:   "anonymous class observes its parameter name during initialization",
			source: "export function run() { function f(C = class { static observed = this.name }, a: number = do { if (false) return -1; 1 }) { return [C.name,C.observed] }; return f() }",
			want:   "[\"C\",\"C\"]",
		},
		{
			name:   "contextual callback default keeps its parameter type",
			source: "export function run() { const f: (read?: (n: number) => number, a?: number) => number = (read = n => n + a, a: number = do { if (false) return -1; 1 }) => read(2); return f() }",
			want:   "3",
		},
		{
			name:   "written callback default keeps its parameter type",
			source: "export function run() { function f(read: (n: number) => number = n => n + a, a: number = do { if (false) return -1; 1 }) { return read(2) }; return f() }",
			want:   "3",
		},
		{
			name:        "length and declaration output",
			source:      "export function first(a: number = do { return 1 }, b = 2) { return a + b }\nexport function second(x: number, a = do { return x }) { return a }\nexport function run() { return [first.length, second.length, first(), first(1), second(3)] }",
			want:        "[0,1,1,3,3]",
			declaration: "first(a?: number, b?: number): number",
		},
		{
			name:        "untyped parameter takes its default's type",
			source:      "let early = true\nexport const arrow = (a = do { if (early) return \"early\"; 1 }, b = 2) => [a, b]\nexport function run() { early = false; const later = arrow(); early = true; return [arrow(), later, arrow(1)] }",
			want:        "[\"early\",[1,2],[1,2]]",
			declaration: "(a?: number, b?: number) => ",
		},
		{
			name:    "temporal dead zone of a later parameter",
			source:  "export function run() { function f(a: number = do { return typeof read }, read = () => 1) { return a + read() }\ntry { return f() } catch (e) { return (e as Error).constructor.name } }",
			want:    "\"ReferenceError\"",
			allowed: []string{"2448", "2454"},
		},
		{
			name:   "closure shares the body's binding",
			source: "export function run() { function f(a: number = do { return 0 }, g = () => a) { a = 2; return g() }\nreturn f(1) }",
			want:   "2",
		},
		{
			name:   "later defaults run after the return",
			source: "export function run() { const log: string[] = []\nfunction f(a: number = do { log.push(\"a\"); return -1 }, b: number = (log.push(\"b\"), 2), c = (log.push(\"c\"), 3)) { log.push(\"body\"); return a + b + c }\nreturn [f(), log.slice(), f(1), log.slice(), f(1, 1), log.slice()] }",
			want:   "[-1,[\"a\"],6,[\"a\",\"b\",\"c\",\"body\"],5,[\"a\",\"b\",\"c\",\"body\",\"c\",\"body\"]]",
		},
		{
			name:   "this in a method's default",
			source: "export function run() { class Box { constructor(readonly base: number) {} read(a: number = do { return this.base }) { return a + 1 } }\nreturn [new Box(5).read(), new Box(5).read(1)] }",
			want:   "[5,2]",
		},
		{
			name:   "async function fulfills with the value",
			source: "export async function later(a: number = do { return 7 }) { return a + 1 }\nexport async function run() { return [await later(), await later(1)] }",
			want:   "[7,2]",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			r, err := w.Compile(t.Context(), Single(test.source))
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			for _, d := range r.Diagnostics {
				if code := strings.TrimPrefix(diagnosticCodeName(d.Source(), d.Code()), "TS"); d.Category() == diagnostics.CategoryError && !slices.Contains(test.allowed, code) {
					t.Errorf("unexpected %s: %s", code, d.MessageText())
				}
			}
			if test.declaration != "" && !strings.Contains(r.Outputs["out/main.d.ts"], test.declaration) {
				t.Errorf("declaration output lacks %q:\n%s", test.declaration, r.Outputs["out/main.d.ts"])
			}
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, "main.js"), []byte(r.Outputs["out/main.js"]), 0o644); err != nil {
				t.Fatal(err)
			}
			runner := "import { run } from \"./main.js\"\nlet out\ntry { let value = run(); if (value instanceof Promise) value = await value; out = JSON.stringify(value) } catch (e) { out = \"threw \" + e.constructor.name }\nprocess.stdout.write(out)\n"
			if err := os.WriteFile(filepath.Join(dir, "runner.mjs"), []byte(runner), 0o644); err != nil {
				t.Fatal(err)
			}
			out, err := exec.CommandContext(t.Context(), "node", filepath.Join(dir, "runner.mjs")).CombinedOutput()
			if err != nil {
				t.Fatalf("node: %v\n%s\n%s", err, out, r.Outputs["out/main.js"])
			}
			if string(out) != test.want {
				t.Errorf("%s\nprinted %s, want %s\n%s", doParameterReturnQuote, out, test.want, r.Outputs["out/main.js"])
			}
		})
	}
}
