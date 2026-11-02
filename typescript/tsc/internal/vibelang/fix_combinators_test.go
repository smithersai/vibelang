package vibelang

import (
	"strings"
	"testing"
)

func TestFixVIPProgramCombinators(t *testing.T) {
	source := `import { Effect } from "effect"
export effect function main() {
 const a = try Effect.all([effect () => { try Effect.yieldNow(); return 1 }])
 const b = try Effect.all({ b: () => { try Effect.yieldNow(); return 2 } })
 const c = try Effect.retry(() => { try Effect.yieldNow(); return 3 }, { times: 1 })
 const d = try Effect.forEach([1], effect (n) => { try Effect.yieldNow(); return n })
 return [a, b, c, d]
}`
	program, file, _, _ := editorProgram(t, source)
	program.GetSemanticDiagnostics(t.Context(), file)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	edits, _ := effectEdits(c, file)
	got := applyEdits(source, mergeInsertions(edits))
	want := strings.ReplaceAll(strings.ReplaceAll(source, "effect () => {", "effect {"), "() => {", "effect {")
	if got != want {
		t.Fatalf("got:\n%s\nwant:\n%s", got, want)
	}
}

// Program arguments are selected by their checked destination, including
// imported aliases and curried calls. Callback arguments keep their function.
func TestFixVIPProgramCombinatorDestinations(t *testing.T) {
	for _, call := range []string{
		"Effect.all([PROGRAM])",
		"Effect.all([PROGRAM] as const)",
		"Effect.all((([PROGRAM] as const)))",
		"Effect.all([...[PROGRAM]])",
		"Effect.all([...([PROGRAM] as const)])",
		"Effect.all({ ...{ a: PROGRAM } })",
		"Effect.raceAll([...[PROGRAM]])",
		"Effect.all(([PROGRAM]))",
		"Effect.all({ a: PROGRAM })",
		"Effect.raceAll([PROGRAM])",
		"Effect.raceAllFirst([PROGRAM])",
		"Effect.retry(PROGRAM, { times: 1 })",
		"Effect.retry({ times: 1 })(PROGRAM)",
		"Effect.scoped(PROGRAM)",
		"Effect.exit(PROGRAM)",
		"Effect.timeout(PROGRAM, \"1 second\")",
		"Effect.withSpan(PROGRAM, \"test\")",
		"Effect.map(PROGRAM, (n) => n + 1)",
		"Effect.ensuring(PROGRAM, effect { return undefined })",
		"Effect.ensuring(effect { return 1 }, PROGRAM)",
		"Effect.zip(PROGRAM, effect { return 2 })",
		"Effect.race(PROGRAM, effect { return 2 })",
		"Effect.onExit(PROGRAM, effect (_exit) => { try Effect.yieldNow() })",
		"Effect.acquireRelease(PROGRAM, effect (_n) => { try Effect.yieldNow() })",
	} {
		t.Run(call, func(t *testing.T) {
			literal := "() => { try Effect.yieldNow(); return 1 }"
			if strings.Contains(call, "[PROGRAM]") {
				literal = "effect " + literal
			}
			source := "import { Effect } from \"effect\"\nexport effect function main() { return try " + strings.ReplaceAll(call, "PROGRAM", literal) + " }"
			want := strings.ReplaceAll(source, literal, "effect { try Effect.yieldNow(); return 1 }")
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == 1 {
					t.Fatalf("source diagnostic %d: %s %v", d.Code(), d.MessageText(), d.MessageArgs())
				}
			}
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			edits, _ := effectEdits(c, file)
			done()
			got := applyEdits(source, mergeInsertions(edits))
			if got != want {
				t.Fatalf("got %s\nwant %s", got, want)
			}
			fixed, fixedFile, _, _ := editorProgram(t, got)
			fixed.GetSemanticDiagnostics(t.Context(), fixedFile)
			fc, release := fixed.GetTypeCheckerForFile(t.Context(), fixedFile)
			defer release()
			again, _ := effectEdits(fc, fixedFile)
			if len(again) != 0 {
				t.Fatalf("second pass: %+v", again)
			}
		})
	}
}

func TestFixVIPProgramLiteralContracts(t *testing.T) {
	for _, literal := range []string{
		"(): number!! => { return 1 }",
		"(n = 1): number!! => { return n }",
		"function (): number!! { return 1 }",
		"function named() { return 1 }",
	} {
		t.Run(literal, func(t *testing.T) {
			source := "import { Effect } from \"effect\"\nexport effect function main() { return try Effect.retry(" + literal + ", { times: 1 }) }"
			program, file, _, _ := editorProgram(t, source)
			program.GetSemanticDiagnostics(t.Context(), file)
			c, done := program.GetTypeCheckerForFile(t.Context(), file)
			edits, _ := effectEdits(c, file)
			done()
			got := applyEdits(source, mergeInsertions(edits))
			want := "import * as $effectPrograms from \"effect/Effect\"\n" + strings.Replace(source, literal, "$effectPrograms.suspend(effect "+literal+")", 1)
			if got != want {
				t.Fatalf("got %s\nwant %s", got, want)
			}
		})
	}
}

func TestFixVIPProgramImportHygiene(t *testing.T) {
	source := `import { Effect as Fx } from "effect"
const Effect = 0
const $effectPrograms = 0
export effect function main() {
 return try Fx.retry((n = 1): number!! => { return n }, { times: 1 })
}
`
	program, file, _, _ := editorProgram(t, source)
	program.GetSemanticDiagnostics(t.Context(), file)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	edits, _ := effectEdits(c, file)
	done()
	got := applyEdits(source, mergeInsertions(edits))
	if !strings.HasPrefix(got, "import * as $effectPrograms$1 from \"effect/Effect\"\n") ||
		!strings.Contains(got, "$effectPrograms$1.suspend(effect (n = 1): number!!") {
		t.Fatalf("non-hygienic rewrite: %s", got)
	}
	fixed, fixedFile, _, _ := editorProgram(t, got)
	for _, d := range fixed.GetSemanticDiagnostics(t.Context(), fixedFile) {
		if d.Category() == 1 {
			t.Fatalf("fixed diagnostic %d: %s", d.Code(), d.MessageText())
		}
	}
	fc, release := fixed.GetTypeCheckerForFile(t.Context(), fixedFile)
	defer release()
	again, _ := effectEdits(fc, fixedFile)
	if len(again) != 0 {
		t.Fatalf("second pass: %+v", again)
	}
}

func TestFixVIPProgramLiteralExpressions(t *testing.T) {
	source := `import { Effect } from "effect"
export effect function main() {
 return try Effect.all([effect () => 1, (effect () => Effect.succeed(2))])
}`
	want := `import { Effect } from "effect"
export effect function main() {
 return try Effect.all([effect { return 1 }, (effect { return try Effect.succeed(2) })])
}`
	program, file, _, _ := editorProgram(t, source)
	program.GetSemanticDiagnostics(t.Context(), file)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	edits, _ := effectEdits(c, file)
	got := applyEdits(source, mergeInsertions(edits))
	if got != want {
		t.Fatalf("got %s\nwant %s", got, want)
	}
}

func TestFixVIPProgramMarkedContract(t *testing.T) {
	source := `import { Effect } from "effect"
export effect function main() {
 return try Effect.all([effect (): number!! => Effect.succeed(1)])
}`
	want := `import * as $effectPrograms from "effect/Effect"
import { Effect } from "effect"
export effect function main() {
 return try Effect.all([$effectPrograms.suspend(effect (): number!! => try Effect.succeed(1))])
}`
	program, file, _, _ := editorProgram(t, source)
	program.GetSemanticDiagnostics(t.Context(), file)
	c, done := program.GetTypeCheckerForFile(t.Context(), file)
	defer done()
	edits, _ := effectEdits(c, file)
	got := applyEdits(source, mergeInsertions(edits))
	if got != want {
		t.Fatalf("got %s\nwant %s", got, want)
	}
}
