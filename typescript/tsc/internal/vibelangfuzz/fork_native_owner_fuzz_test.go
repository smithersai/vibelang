package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestForkNativeOwnerQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", "\x60fork\x60 starts a fiber and gives its \x60Fiber\x60. The form names the owner, which interrupts the fiber when it ends.")
	chapterSays(t, "002-running.md", "const f = yield* Effect.forkChild(worker())")
}

// Ordinary Fiber values retain TypeScript's call, storage and capture rules.
// Mutate transparent source regions and operand grouping without extending a
// lexical resource Scope to the keyword operation.
func FuzzForkNativeOwner(f *testing.F) {
	startShortBudget(f)
	rows := []struct{ key, native, actual string }{
		{"argument", "const child=yield* Effect.forkChild(p);return yield* Fiber.join(identity(child))", "const child=fork p;return join identity(child)"},
		{"array", "const child=yield* Effect.forkChild(p);return yield* collect([child])", "const child=fork p;return try collect([child])"},
		{"return", "return yield* Effect.forkChild(p)", "return fork p"},
		{"closure", "const child=yield* Effect.forkChild(p);const later=()=>Fiber.join(child);return yield* later()", "const child=fork p;const later=()=>Fiber.join(child);return try later()"},
		{"block", "{const child=yield* Effect.forkChild(p);return yield* Fiber.join(child)}", "{const child=fork p;return join child}"},
		{"loop", "for(let i=0;i<1;i++){const child=yield* Effect.forkChild(p);return yield* Fiber.join(child)}", "for(let i=0;i<1;i++){const child=fork p;return join child}"},
	}
	for _, row := range rows {
		for _, flags := range []byte{0, 1, 2, 3, 4, 5, 6, 7, 8, 16} {
			f.Add(row.key, flags)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, flags byte) {
		TestForkNativeOwnerQuoted(t)
		i := slices.IndexFunc(rows, func(row struct{ key, native, actual string }) bool { return row.key == key })
		if i < 0 {
			i = 0
			for _, b := range []byte(key) {
				i = (i*31 + int(b)) % len(rows)
			}
		}
		row := rows[i]
		native, actual := row.native, row.actual
		if flags&1 != 0 {
			native = strings.ReplaceAll(native, "(p)", "((/* operand */ p))")
			actual = strings.ReplaceAll(actual, "fork p", "fork (/* operand */ p)")
		}
		if flags&2 != 0 {
			native = "{" + native + "}"
			actual = "{" + actual + "}"
		}
		programType := "Effect.Effect<number,string>"
		if flags&4 != 0 {
			programType = "Effect.Effect<number,string,R>"
		}
		if flags&8 != 0 {
			programType = "any"
		}
		if flags&16 != 0 {
			programType = "never"
		}
		source := "import {Fiber} from \"effect\";const identity=<T>(x:T):T=>x;const collect=<A,E>(xs:ReadonlyArray<Fiber.Fiber<A,E>>)=>Effect.all(xs.map(Fiber.join));" +
			"export function native<R>(p:" + programType + "){return Effect.gen(function*(){" + native + "})}" +
			"export effect function actual<R>(p:" + programType + "){" + actual + "}" +
			"const forward:typeof native=actual;const backward:typeof actual=native;void forward;void backward;"
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: DefaultConfig})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		if errors := r3Errors(result.Diagnostics); len(errors) != 0 {
			Gap(t, "FuzzForkNativeOwner", fmt.Sprintf("%s:%d", row.key, flags&31), "native forkChild accepts the same Fiber uses, got %v", errors)
		}
		for name, output := range result.Outputs {
			if strings.HasSuffix(name, ".js") && strings.Contains(output, ".$fork(") {
				Gap(t, "FuzzForkNativeOwner", fmt.Sprintf("%s:%d", row.key, flags&31), "keyword fork emitted the retired region-owned helper")
			}
		}
	})
}
