package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// fiberNameErrors counts the EK1702 reports of source.
func fiberNameErrors(t *testing.T, source string) int {
	t.Helper()
	_, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range file.Diagnostics() {
		if d.Code() == reservedFiberName.Code {
			count++
		}
	}
	return count
}

// Appendix A: under [+Effect] fork and join cannot name a variable, parameter,
// label or shorthand property; a member and plain code keep the ordinary name.
func TestReservedFiberNames(t *testing.T) {
	for _, word := range []string{"fork", "join"} {
		for _, test := range []struct {
			name, source string
			want         int
		}{
			{"local", `export effect function f() { const W = 1; return W }`, 1},
			{"let", `export effect function f() { let W = 1; return W + 0 }`, 1},
			{"parameter", `export effect function f(W: number) { return 1 }`, 1},
			{"effect arrow parameter", `export const f = effect (W: number) => 1`, 1},
			{"bare effect arrow parameter", `export const f = effect W => 1`, 1},
			{"plain arrow head in effect code", `export effect function f() { return (W: number) => 1 }`, 1},
			{"bare plain arrow head in effect code", `export effect function f() { return [1].map(W => 1) }`, 1},
			{"async arrow head in effect code", `export effect function f() { return async (W: number) => 1 }`, 1},
			{"destructuring", `export effect function f(o: { W: number }) { const { W } = o; return 1 }`, 1},
			{"array destructuring", `export effect function f(o: number[]) { const [W] = o; return 1 }`, 1},
			{"for-of", `export effect function f() { const g = () => 1; for (const W of [1]) { g() } return 1 }`, 1},
			{"label", `export effect function f() { W: for (;;) { break W } return 1 }`, 1},
			{"nested function name", `export effect function f() { function W() { return 1 } return 1 }`, 1},
			{"nested class name", `export effect function f() { class W { } return 1 }`, 1},
			{"plain expression name in effect code", `export effect function f() { return function W() { return 1 } }`, 0},
			{"renamed destructuring", `export effect function f(o: { W: number }) { const { W: v } = o; return v }`, 0},
			{"member read", `export effect function f(o: { W: number }) { return o.W }`, 0},
			{"object key", `export effect function f() { return { W: 1 } }`, 0},
			{"plain local", `export function f() { const W = 1; return W }`, 0},
			{"plain parameter", `export function f(W: number) { return W }`, 0},
			{"plain function in effect code", `export effect function f() { const g = () => { const W = 1; return W }; return g() }`, 0},
			{"nested function head resets", `export effect function f() { function h(W: number) { return W } return h(1) }`, 0},
			{"field initializer resets", `export effect function f() { class C { v = ((W: number) => W)(1) } return new C().v }`, 0},
			{"top-level declaration", `export function W(n: number) { return n }`, 0},
			{"effect declaration name", `export effect function W() { return 1 }`, 0},
			{"effect shorthand declaration name", `export effect W() { return 1 }`, 0},
		} {
			t.Run(word+"/"+test.name, func(t *testing.T) {
				if got := fiberNameErrors(t, strings.ReplaceAll(test.source, "W", word)); got != test.want {
					t.Fatalf("EK1702 reports: %d, want %d, in %s", got, test.want, test.source)
				}
			})
		}
	}
}

// fixFiberText runs --fix to a fixed point and returns the fixed text and what
// a second run does.
func fixFiberText(t *testing.T, source string) string {
	t.Helper()
	p, file, _, _ := editorProgram(t, source)
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
	fixed, ok := result.Files[file.FileName()]
	if !ok || len(result.Refused) != 0 {
		t.Fatalf("--fix refused or left the file: %+v", result)
	}
	if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
		t.Fatal(err)
	}
	again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), p.CommandLine(), FixOptions{})
	if len(again.Files) != 0 {
		t.Fatalf("second fix changed the project: %+v", again)
	}
	return fixed.Text
}

// A binding named fork or join that a program calls stays that binding's call
// through --fix: the .ts twin never meant the fiber operation. opencode's run
// coordinator holds this shape, and rewriting it without the rename waited for
// its cleanup instead of acknowledging it.
func TestFiberNameFix(t *testing.T) {
	for _, test := range []struct{ name, source, want string }{
		{"opencode coordinator, already migrated", `import { Effect } from "effect"
export const make = effect () => {
  const fork = (e: Effect.Effect<void>) => 1
  return effect (wait: Effect.Effect<void>): number!! => {
    fork(wait)
    return 1
  }
}
`, `export const make = effect () => {
  const fork2 = (e: void!!) => 1
  return effect (wait: void!!): number!! => {
    fork2(wait)
    return 1
  }
}
`},
		{"parameter and shorthand keep the key", `export effect function f(join: number) {
  return { join }
}
`, `export effect function f(join2: number) {
  return { join: join2 }
}
`},
		{"destructuring keeps the key", `export effect function f(o: { fork: number }) {
  const { fork } = o
  return fork
}
`, ""},
		{"label and its jumps", `export effect function f() {
  fork: for (;;) { break fork }
  return 1
}
`, `export effect function f() {
  fork2: for (;;) { break fork2 }
  return 1
}
`},
		{"a generator's local", `import { Effect } from "effect"
export const f = Effect.gen(function* () {
  const fork = (n: number) => n
  return fork(1)
})
`, `export const f = effect {
  const fork2 = (n: number) => n
  return fork2(1)
}
`},
		{"an exported binding keeps its exported name", `import { Effect } from "effect"
export const fork = (n: number) => n
export const f = Effect.gen(function* () {
  return fork(1)
})
`, `const fork2 = (n: number) => n
export { fork2 as fork }
export const f = effect {
  return fork2(1)
}
`},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixed := fixFiberText(t, test.source)
			if test.want != "" && fixed != test.want {
				t.Fatalf("--fix writes\n%s\nwant\n%s", fixed, test.want)
			}
			if fiberNameErrors(t, fixed) != 0 {
				t.Fatalf("fixed source still reports EK1702:\n%s", fixed)
			}
		})
	}
}

// The rename reaches outside the generator: a binding another module sees
// through an import or an export specifier keeps its source name.
func TestFiberNameFixImports(t *testing.T) {
	fixed := fixFiberText(t, `import { Effect } from "effect"
import { join } from "effect/Array"
export const f = Effect.gen(function* () {
  return join(["a"], ",")
})
export { join }
`)
	for _, want := range []string{`import { join as join2 } from "effect/Array"`, `return join2(["a"], ",")`, `export { join2 as join }`} {
		if !strings.Contains(fixed, want) {
			t.Fatalf("--fix writes\n%s\nwithout %s", fixed, want)
		}
	}
}
