package vibelangmapper

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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

// Written effect callbacks decide their form even across a host boundary:
// the case's effect functions and lambdas project with no form choice.
func assertSubtypeHostForms(t *testing.T, source string) {
	t.Helper()
	checked := Project(source, testContext)
	_, _, emitted := Emit(source, testContext)
	for _, diagnostics := range [][]Diagnostic{checked.Diagnostics, emitted} {
		if len(diagnostics) != 0 {
			t.Fatalf("written effect callbacks need no form choice: %v", diagnostics)
		}
	}
}

func TestSubtypeReturnHostBoundaryWrittenKind(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("../../../..", "typescript/vibelang/cases/effect-subtype-returns/main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	assertSubtypeHostForms(t, string(source))
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
