package vibelangmapper

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// S5-1 delegates known subtype data only at an explicit or resolved boundary.
func TestSubtypeReturnBoundaries(t *testing.T) {
	for _, body := range []string{
		`function annotated(): Effect.Effect<number> { return Exit.succeed(5) }`,
		`const named: (n: number) => Effect.Effect<number> = (n) => Exit.succeed(n + 5)`,
		`function region(): Effect.Effect<number> { try { return Exit.succeed(7) } finally {} }`,
		`const callback: (n: number) => Effect.Effect<number> = function(n) { return (Exit.succeed(n)) }`,
		`function stored(): Effect.Effect<number> { const program = Exit.succeed(4); return program }`,
		`function accept(f: (n: number) => Effect.Effect<number>) { return f(1) }; const callback = accept((n) => Exit.succeed(n))`,
	} {
		source := `import * as Effect from "effect/Effect"; import * as Exit from "effect/Exit"; ` + body
		for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
			if len(projection.Diagnostics) != 0 {
				t.Fatalf("%v\n%s", projection.Diagnostics, projection.Text)
			}
			if strings.Count(projection.Text, "$returnRun(") != 1 {
				t.Fatalf("want one return delegation: %s", projection.Text)
			}
			if strings.Contains(projection.Text, "$run(Exit.succeed(") {
				t.Fatalf("D24 data ran: %s", projection.Text)
			}
		}
	}
}

func TestSubtypeReturnPlainData(t *testing.T) {
	for _, body := range []string{
		`const plain = (): Exit.Exit<number> => Exit.succeed(1)`,
		`const fallback = () => Exit.succeed(1)`,
		`const load = (): Effect.Effect<number> => { sleep(1); return 2 }`,
		`function double(n: number): number!! { return n * 2 }`,
		`function exact(): Effect.Effect<Exit.Exit<number>> { return Effect.succeed(Exit.succeed(8)) }`,
		`function opaque(): Effect.Effect<number> { return Action.make(1) }`,
		`function data(): Effect.Effect<Exit.Exit<number>, never, never> { return Exit.succeed(1) }`,
		`function broad(): Effect.Effect<unknown, never, never> { return Exit.fail("data") }`,
		`function object(): Effect.Effect<object, never, never> { return Exit.succeed(1) }`,
		`type Result = Exit.Exit<number> | string; function union(): Effect.Effect<Result> { return Exit.succeed(1) }`,
		`type Result = number; function outer() { type Result = Exit.Exit<number> | number; const named: () => Effect.Effect<Result> = () => Exit.succeed(1); return named() }`,
		`const data: (n: number) => Effect.Effect<Exit.Exit<number>> = (n) => Exit.succeed(n)`,
		`interface Service { readonly confine: (x: Exit.Exit<number>) => Effect.Effect<Exit.Exit<number>> }; const noop: Service = { confine: (x) => x }`,
	} {
		source := `import * as Effect from "effect/Effect"; import * as Exit from "effect/Exit"; import { Action } from "./host.js"; ` + body
		for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
			if strings.Contains(projection.Text, "$returnRun(") || strings.Contains(projection.Text, "$run(Exit.succeed(") || strings.Contains(projection.Text, "$run(Exit.fail(") {
				t.Fatal(projection.Text)
			}
		}
	}
}

// The unchanged acceptance case requires host callback signatures. Keep its
// EK9100 limitation explicit instead of asserting a guessed callback form.
func assertSubtypeHostChoices(t *testing.T, source string) {
	t.Helper()
	checked := Project(source, testContext)
	_, _, emitted := Emit(source, testContext)
	for _, diagnostics := range [][]Diagnostic{checked.Diagnostics, emitted} {
		if len(diagnostics) != 5 {
			t.Fatalf("want five unresolved host callbacks: %v", diagnostics)
		}
		for _, d := range diagnostics {
			if d.Code != CodeFormChoice || !strings.Contains(d.Message, "another file") {
				t.Fatalf("unexpected diagnostic: %v", d)
			}
		}
	}
}

func TestSubtypeReturnHostBoundaryUnknown(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("../../../..", "typescript/vibelang/cases/effect-subtype-returns/main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	assertSubtypeHostChoices(t, string(source))
}

func TestSubtypeReturnFailureDiagnostic(t *testing.T) {
	source := `import * as Effect from "effect/Effect"; import * as Exit from "effect/Exit"; function wrongError(): Effect.Effect<number, never, never> { return Exit.fail("bad") }`
	for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		found := false
		for _, diagnostic := range projection.Diagnostics {
			if diagnostic.Code == 2001 {
				found = true
			}
		}
		if !found {
			t.Fatalf("missing EK9201: %v", projection.Diagnostics)
		}
	}
}

func TestSubtypeReturnArgumentsUntouched(t *testing.T) {
	source := `import * as Effect from "effect/Effect"; import * as Layer from "effect/Layer"; function main() { const pending: Effect.Effect<number> = Effect.succeed(1); return Effect.provide(pending, Layer.empty) }`
	for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		if len(projection.Diagnostics) != 0 {
			t.Fatalf("%v", projection.Diagnostics)
		}
		if strings.Contains(projection.Text, "$returnRun(") {
			t.Fatal(projection.Text)
		}
	}
}
