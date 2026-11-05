package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// 007: a quick fix preserves coldness as well as the choice's value.
func TestOptionMatchProgramFix(t *testing.T) {
	for _, source := range []string{
		"export function choose(v: Option.Option<number>): Effect.Effect<number> { return Option.match(v, {onNone: () => Effect.succeed(0), onSome: n => Effect.succeed(n)}) }",
		"export effect function choose(v: Option.Option<number>) { return try Option.match(v, {onNone: () => Effect.succeed(0), onSome: n => Effect.succeed(n)}) }",
		"export function choose(v: Option.Option<number>) { return Option.match(v, {onNone: () => Effect.fail('missing'), onSome: n => Effect.succeed(n)}) }",
		"export function choose(v: Option.Option<number>) { return Option.match(v, {onNone: effect () => 0, onSome: effect n => n}) }",
		"export effect function choose(v: Option.Option<number>) { try Option.match(v, {onNone: () => Effect.void, onSome: n => Effect.fail(n)}); return 0 }",
	} {
		fixed := applyQuickFix(t, source, EK4839.Code)
		if strings.Contains(fixed, "Option.match(") || !strings.Contains(fixed, "when Option.Some(") {
			t.Fatalf("program choice was not fixed:\n%s", fixed)
		}
		// try on the do expression would leave its program unrun (EK4801).
		if tried := strings.Contains(source, "try Option.match("); tried != (strings.Contains(fixed, "try $optionSome(") && strings.Contains(fixed, "try $optionNone()")) || strings.Contains(fixed, "try (") {
			t.Fatalf("try must run the selected arm's program, and only when the original ran it:\n%s", fixed)
		}
		p, f, _, _ := editorProgram(t, fixed)
		for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("%s\n%s", d.String(), fixed)
			}
		}
	}
}

func TestOptionMatchProgramDeclarations(t *testing.T) {
	for _, source := range []string{
		"export function choose(v: Option.Option<number>) { return Option.match(v, {onNone: () => Effect.fail('missing'), onSome: n => Effect.succeed(n)}) }",
		"export effect function choose(v: Option.Option<number>) { return try Option.match(v, {onNone: () => Effect.fail('missing'), onSome: n => Effect.succeed(n)}) }",
	} {
		_, file, _, _ := editorProgram(t, source)
		dir := filepath.Dir(file.FileName().AsString())
		config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"emitDeclarationOnly":true,"outDir":"out"},"files":["main.vibe"]}`
		if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0600); err != nil {
			t.Fatal(err)
		}
		before := migrationRuleDeclarations(t, dir, nil)
		fixed := applyQuickFix(t, source, EK4839.Code)
		if err := os.WriteFile(file.FileName().AsString(), []byte(fixed), 0600); err != nil {
			t.Fatal(err)
		}
		after := migrationRuleDeclarations(t, dir, nil)
		if !reflect.DeepEqual(before, after) {
			t.Fatalf("declaration changed:\n%v\n%v\n%s", before, after, fixed)
		}
	}
}

// A handler written with Effect.fnUntraced(function* …) is EK1002's error,
// typed any until that fix rewrites it. EK4839 waits for it instead of
// refusing first and blocking it (t3code DesktopObservability.ts:455).
func TestOptionMatchWaitsForGeneratorHandler(t *testing.T) {
	source := `interface Shape { readonly write: (s: string) => Effect.Effect<void> }
const Noop: Shape = { write: () => Effect.void }
export const make = (sink: Option.Option<string>): Effect.Effect<Shape> =>
  Option.match(sink, {
    onNone: () => Effect.succeed(Noop),
    onSome: Effect.fnUntraced(function* (file) {
      const prefix = yield* Effect.succeed(file)
      return { write: (s: string) => Effect.sync(() => { void (prefix + s) }) } satisfies Shape
    }),
  })
`
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	config := `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"exactOptionalPropertyTypes":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	result := fixCase(t, dir)
	fixed := result.Files[file.FileName()]
	if fixed == nil || fixed.Counts[EK4839.Code] != 1 || fixed.Counts[EK1002.Code] != 1 || strings.Contains(fixed.Text, "Option.match(") || strings.Contains(fixed.Text, "function*") {
		t.Fatalf("want EK1002 then EK4839 fixed, refused %+v:\n%+v", result.Refused, fixed)
	}
	var report strings.Builder
	result.Report(&report, func(name tspath.RootedFilePath) string { return filepath.Base(name.AsString()) })
	if strings.Contains(report.String(), "refused site") {
		t.Fatalf("refused sites:\n%s", report.String())
	}
}

// FuzzOptionMatchGeneratorHandler varies where an EK1002 generator stands in
// a direct Option.match: which handler holds it, Effect.gen, Effect.fn or
// Effect.fnUntraced, the yields in its body and the Option import. One --fix
// run fixes both EK1002 and EK4839 and refuses no site (chapter 7: "One
// vibelang --fix run applies fixes until none applies").
func FuzzOptionMatchGeneratorHandler(f *testing.F) {
	for _, seed := range [][]byte{{0, 0, 0, 0}, {1, 1, 2, 1}, {2, 0, 1, 0}, {0, 1, 0, 1}, {1, 2, 3, 0}} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		pick := func(i int) byte {
			if len(data) == 0 {
				return 0
			}
			return data[i%len(data)]
		}
		option, imports := "Option", ""
		if pick(3)&1 != 0 {
			option, imports = "O", "import * as O from \"effect/Option\"\n"
		}
		generator := func(param, value string) string {
			body := "return " + value + " + 1"
			for i := 0; i < int(pick(2)%3); i++ {
				body = fmt.Sprintf("const v%d = yield* Effect.succeed(%s + %d); ", i, value, i) + body
			}
			switch pick(0) % 3 {
			case 0:
				return "(" + param + ") => Effect.gen(function* () { " + body + " })"
			case 1:
				return "Effect.fn(\"handler\")(function* (" + param + ") { " + body + " })"
			}
			return "Effect.fnUntraced(function* (" + param + ") { " + body + " })"
		}
		none, some := "() => Effect.succeed(0)", generator("n: number", "n")
		if pick(1)%2 == 1 {
			none, some = generator("", "0"), "(n: number) => Effect.succeed(n)"
		}
		source := imports + fmt.Sprintf("export const pick = (v: %s.Option<number>): Effect.Effect<number> =>\n  %s.match(v, {\n    onNone: %s,\n    onSome: %s,\n  })\n", option, option, none, some)
		_, file, _, _ := editorProgram(t, source)
		result := fixCase(t, filepath.Dir(file.FileName().AsString()))
		fixed := result.Files[file.FileName()]
		var report strings.Builder
		result.Report(&report, func(name tspath.RootedFilePath) string { return filepath.Base(name.AsString()) })
		if fixed == nil || strings.Contains(fixed.Text, option+".match(") || strings.Contains(fixed.Text, "function*") || strings.Contains(report.String(), "refused") {
			t.Fatalf("source:\n%s\nreport:\n%s\nfixed: %+v", source, report.String(), fixed)
		}
	})
}

// Chapter 7 keeps generator migration ahead of Option.match's preserving fix.
// generator-match-advice.fail passes explicit producers, which stay EK1002's
// error with no rewrite (VIP-21), so the match repair keeps waiting for them.
// The same source with native generators migrates both, then the match.
func TestPublicGeneratorMatchAdviceWitness(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	fixture := filepath.Join(root, "typescript/vibelang/cases/generator-match-advice.fail")

	producers := fixCase(t, copyCompilerFixture(t, fixture, root))
	for _, file := range producers.Files {
		if file.Counts[EK1002.Code] != 0 || file.Counts[EK4839.Code] != 0 ||
			strings.Count(file.Text, "effect function*") != 2 || !strings.Contains(file.Text, "Option.match(") {
			t.Fatalf("expected explicit producers and their match unchanged; got %+v", file)
		}
	}

	dir := copyCompilerFixture(t, fixture, root)
	main := filepath.Join(dir, "main.vibe")
	source, err := os.ReadFile(main)
	if err != nil {
		t.Fatal(err)
	}
	text := strings.ReplaceAll(string(source), "effect function*", "function*")
	text = strings.ReplaceAll(text, "yield try ", "return yield* ")
	if err := os.WriteFile(main, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
	result := fixCase(t, dir)
	for _, file := range result.Files {
		if file.Counts[EK1002.Code] != 2 || file.Counts[EK4839.Code] != 1 ||
			strings.Contains(file.Text, "function* (") || strings.Contains(file.Text, "Option.match(") {
			t.Fatalf("expected both generators before the match repair; got %+v", file)
		}
	}
	if len(result.Files) != 1 || len(result.Refused) != 0 {
		t.Fatalf("expected one fully migrated file with no refusals: %+v", result)
	}
}
