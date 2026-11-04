package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// D147 delays the operand, while the assertion describes the resulting program.
func TestS7AssertedProgramProjection(t *testing.T) {
	source := `import { Effect } from "effect"; function known(n: number) { return n }; export function main() { const direct = Effect.map(known(3) as Effect.Effect<number>, x => x + 1); const repeated = (known(4) as Effect.Effect<number>) |> Effect.all([%, %]); return { direct, repeated } }`
	projection := Project(source, testContext)
	if len(projection.Diagnostics) != 0 {
		t.Fatal(projection.Diagnostics)
	}
	if strings.Contains(projection.Text, `return (yield* $run(known(3))) as Effect.Effect<number>`) {
		t.Fatal(projection.Text)
	}
	dir, stock := stockBuiltinProject(t)
	requireStockTypeScript(t, stock)
	text := projection.Text + `
import type { Effect as Program } from "effect/Effect";
type Success<T> = T extends Program<infer A, any, any> ? A : never;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const directCheck: Equal<Success<ReturnType<typeof main>>["direct"], number> = true;
const repeatedCheck: Equal<Success<ReturnType<typeof main>>["repeated"], [number, number]> = true;
`
	if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(stock, "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--target", "esnext", "--module", "nodenext", "main.ts")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %s\n%s", err, out, text)
	}
}

// D24 diagnoses only structured results identifiable from this file's text.
func TestS7DiscardedStructuredCalls(t *testing.T) {
	source := `import { Config, Exit } from "effect"; import type { SqlClient } from "effect/sql/SqlClient"; export function migration(sql: SqlClient) { sql.unsafe("one"); (sql.unsafe("two")); Exit.fail("discarded"); Config.String("DISCARDED") }`
	for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		count := 0
		for _, d := range projection.Diagnostics {
			if d.Code == 4301 {
				count++
			}
		}
		if count != 4 {
			t.Fatalf("got %d EK4301 diagnostics: %v\n%s", count, projection.Diagnostics, projection.Text)
		}
	}
}

// D147 rejects a shared topic with incompatible evaluation boundaries.
func TestS7AssertedProgramMixedTopic(t *testing.T) {
	source := `import { Effect } from "effect"; function load(): Effect.Effect<unknown> { return 1 }; export function main() { return (load() as Effect.Effect<number>) |> Effect.race(%, Effect.succeed(%)) }`
	for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		found := false
		for _, d := range projection.Diagnostics {
			if d.Code == CodeUnprojectedForm {
				found = true
				want := "% stands for (load() as Effect.Effect<number>), which this pipe passes by name to a program elsewhere, so it cannot also be a value here."
				if d.Message != want || d.Start != strings.LastIndex(source, "%") || d.Length != 1 {
					t.Fatalf("unexpected EK9001: %v", d)
				}
			}
		}
		if !found {
			t.Fatalf("%v", projection.Diagnostics)
		}
	}
}

// A value parameter still sees an assertion of the completed value (TS2352).
func TestS7AssertedProgramValuePosition(t *testing.T) {
	dir, stock := stockBuiltinProject(t)
	requireStockTypeScript(t, stock)
	source := `import { Effect } from "effect"; function known() { return 1 }; export function valuePosition() { return (known() as Effect.Effect<number>) |> Effect.succeed(%) }`
	projection := Project(source, testContext)
	if len(projection.Diagnostics) != 0 {
		t.Fatal(projection.Diagnostics)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte(projection.Text), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(stock, "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--target", "esnext", "--module", "nodenext", "main.ts")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err == nil || !strings.Contains(string(out), "TS2352") {
		t.Fatalf("%v: %s\n%s", err, out, projection.Text)
	}
}

// D24's explicit invocation goes through $value; Exit constructors stay data.
func TestS7StructuredCallProjection(t *testing.T) {
	source := `import { Exit } from "effect"; import { sql } from "./sql.js"; export function main() { sql.unsafe("run")(); const data = sql.unsafe("keep"); const outcome = Exit.fail("keep"); return { data, outcome } }`
	for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		if len(projection.Diagnostics) != 0 {
			t.Fatal(projection.Diagnostics)
		}
		if !strings.Contains(projection.Text, "$value(") || !strings.Contains(projection.Text, `const outcome = Exit.fail("keep")`) {
			t.Fatal(projection.Text)
		}
	}
}

// D147 also sees assertions behind non-null and parenthesized wrappers.
func TestS7AssertedProgramWrappers(t *testing.T) {
	for _, input := range []string{`known() as Effect.Effect<number>`, `(known() as Effect.Effect<number>)!`, `((known() + 1) as Effect.Effect<number>)`} {
		source := `import { Effect } from "effect"; function known() { return 1 }; export function main() { return (` + input + `) |> Effect.map(%, x => x + 1) }`
		for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
			if len(projection.Diagnostics) != 0 {
				t.Fatal(projection.Diagnostics)
			}
			if !strings.Contains(projection.Text, " }) as Effect.Effect<number>") {
				t.Fatal(projection.Text)
			}
		}
	}
}

// D155 needs a running operand, not just a program-shaped parameter.
func TestS7MixedTopicUnknownInput(t *testing.T) {
	for _, left := range []string{"a()", "(a() as Effect.Effect<number>)"} {
		source := "function f() { return " + left + " |> retry(%, Schedule.recurs(2)) + % }"
		for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
			if len(projection.Diagnostics) == 0 {
				t.Fatal(projection.Text)
			}
			for _, d := range projection.Diagnostics {
				if d.Code != CodeFormChoice {
					t.Fatalf("unexpected diagnostic: %v", d)
				}
			}
		}
	}
}
