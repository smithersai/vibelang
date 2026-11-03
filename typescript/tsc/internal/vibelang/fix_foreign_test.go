package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// EK4401's fixture is the code that vibelang --fix meets once a migration's
// generators are effect code. Its twin, which the smoke harness runs, is what
// --fix writes: exceptions stay defects, and nothing joins E.
func TestForeignCallFix(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	fixture := filepath.Join(root, "typescript/vibelang/cases/ek4401-fix.fail")
	twin := filepath.Join(root, "typescript/vibelang/cases/ek4401-fix-fixed")
	want, err := os.ReadFile(filepath.Join(twin, "lib.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	result := fixCase(t, copyCompilerFixture(t, fixture, root))
	got := ""
	for file, fixed := range result.Files {
		if filepath.Base(file.AsString()) == "lib.vibe" {
			got = fixed.Text
		}
	}
	if want := strings.TrimPrefix(string(want), "// expect: EK0403\n"); got != "// expect: EK0403\n"+want {
		t.Errorf("--fix writes\n%s\nwant\n%s", got, want)
	}
	if len(result.Refused) != 0 {
		t.Errorf("refused: %v", result.Refused)
	}
	if again := fixCase(t, copyCompilerFixture(t, twin, root)); len(again.Files) != 0 {
		t.Errorf("fixing the twin again changes %v", again.Order)
	}
}

// --fix applies a round's fixes together, so calls in one function must not
// each pick the same name for an operand's const (Smithers: files, setup).
func TestForeignCallFixNamesEachInput(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/ek4401-fix.fail"), root)
	source := "import { double } from \"./plain.ts\"\nconst one = effect (): number!! => 1\nexport const value = effect () => {\n  const a = double(try one())\n  const b = double(try one())\n  const c = double(try one())\n  return [a, b, c]\n}\n"
	if err := os.WriteFile(filepath.Join(dir, "lib.vibe"), []byte(source), 0o644); err != nil {
		t.Fatal(err)
	}
	result := fixCase(t, dir)
	if len(result.Refused) != 0 {
		t.Fatalf("--fix refused: %+v", result.Refused)
	}
	for file, fixed := range result.Files {
		if filepath.Base(file.AsString()) == "lib.vibe" && strings.Count(fixed.Text, "orDie(") != 3 {
			t.Fatalf("--fix left a call:\n%s", fixed.Text)
		}
	}
}

// A const before the statement would run an operand once, or always, where the
// call runs it each time, or sometimes: the fix leaves these calls alone.
func TestForeignCallFixKeepsWhatRuns(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{
		"while":    "let i = 0\n  while (double(try one()) < 0) i++\n  return i",
		"for":      "let t = 0\n  for (let i = 0; i < double(try one()); i++) t++\n  return t",
		"unbraced": "if (n > 0) return double(try one())\n  return 0",
		"ternary":  "return n > 0 ? double(try one()) : 0",
		"and":      "return n > 0 && double(try one()) > 0",
	} {
		t.Run(name, func(t *testing.T) {
			dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/ek4401-fix.fail"), root)
			source := "import { double } from \"./plain.ts\"\nconst one = effect (): number!! => 1\nexport const value = effect (n: number) => {\n  " + body + "\n}\n"
			if err := os.WriteFile(filepath.Join(dir, "lib.vibe"), []byte(source), 0o644); err != nil {
				t.Fatal(err)
			}
			for file, fixed := range fixCase(t, dir).Files {
				if filepath.Base(file.AsString()) == "lib.vibe" && strings.Contains(fixed.Text, "Effect.orDie") {
					t.Errorf("--fix moved an operand:\n%s", fixed.Text)
				}
			}
		})
	}
}

// The wrapper's function loses what control flow proved about a property, so
// the fix keeps the proof: the guard joins the call in the function, or the read
// moves to a const under the guard.
func TestForeignCallFixKeepsNarrowing(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	for name, tc := range map[string]struct{ body, want string }{
		"ternary":        {"return o.p ? double(o.p) : 0", "return try Effect.orDie(Effect.try({ try: () => o.p ? double(o.p) : 0, catch: (error) => error }))"},
		"nested ternary": {"return o.p ? double(o.p) : n > 0 ? double(n) : double(0)", "return try Effect.orDie(Effect.try({ try: () => o.p ? double(o.p) : n > 0 ? double(n) : double(0), catch: (error) => error }))"},
		"and":            {"return o.p !== undefined && double(o.p) > 0", "try: () => o.p !== undefined && double(o.p) > 0"},
		"if block":       {"if (o.p) {\n    const r = double(o.p)\n    return r\n  }\n  return 0", "const n2 = o.p\n    const r = try Effect.orDie(Effect.try({ try: () => double(n2), catch: (error) => error }))"},
		"early return":   {"if (!o.p) return 0\n  return double(o.p)", "const n2 = o.p\n  return try Effect.orDie(Effect.try({ try: () => double(n2), catch: (error) => error }))"},
	} {
		t.Run(name, func(t *testing.T) {
			dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/ek4401-fix.fail"), root)
			source := "import { double } from \"./plain.ts\"\nexport const value = effect (n: number, o: { readonly p?: number }) => {\n  " + tc.body + "\n}\n"
			if err := os.WriteFile(filepath.Join(dir, "lib.vibe"), []byte(source), 0o644); err != nil {
				t.Fatal(err)
			}
			result := fixCase(t, dir)
			if len(result.Refused) != 0 {
				t.Errorf("refused: %v", result.Refused)
			}
			got := ""
			for file, fixed := range result.Files {
				if filepath.Base(file.AsString()) == "lib.vibe" {
					got = fixed.Text
				}
			}
			if !strings.Contains(got, tc.want) {
				t.Errorf("--fix writes\n%s\nwant it to hold\n%s", got, tc.want)
			}
		})
	}
}

// The corpus case: --fix writes the twin the smoke harness runs, and leaves it.
func TestForeignCallFixNarrowedTwin(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	fixture := filepath.Join(root, "typescript/vibelang/cases/opencode-narrowed-property-call.fail")
	twin := filepath.Join(root, "typescript/vibelang/cases/opencode-narrowed-property-call-fixed")
	want, err := os.ReadFile(filepath.Join(twin, "lib.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	result := fixCase(t, copyCompilerFixture(t, fixture, root))
	if len(result.Refused) != 0 {
		t.Errorf("refused: %v", result.Refused)
	}
	for file, fixed := range result.Files {
		if filepath.Base(file.AsString()) == "lib.vibe" && fixed.Text != "// expect: EK4401\n"+string(want) {
			t.Errorf("--fix writes\n%s\nwant\n%s", fixed.Text, want)
		}
	}
	if again := fixCase(t, copyCompilerFixture(t, twin, root)); len(again.Files) != 0 {
		t.Errorf("fixing the twin again changes %v", again.Order)
	}
}

// A call that runs before the read could change the property, so the const
// would read a different value: the fix leaves the call alone.
func TestForeignCallFixKeepsNarrowedReadOrder(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/ek4401-fix.fail"), root)
	source := "import { double } from \"./plain.ts\"\nconst touch = (): number => 1\nexport const value = effect (o: { p?: number }) => {\n  if (!o.p) return 0\n  return touch() + double(o.p)\n}\n"
	if err := os.WriteFile(filepath.Join(dir, "lib.vibe"), []byte(source), 0o644); err != nil {
		t.Fatal(err)
	}
	for file, fixed := range fixCase(t, dir).Files {
		if filepath.Base(file.AsString()) == "lib.vibe" && strings.Contains(fixed.Text, "= o.p\n") {
			t.Errorf("--fix moved the read past a call:\n%s", fixed.Text)
		}
	}
}
