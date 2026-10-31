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
	if want := strings.TrimPrefix(string(want), "// expect: EK4401\n"); got != "// expect: EK4401\n"+want {
		t.Errorf("--fix writes\n%s\nwant\n%s", got, want)
	}
	if len(result.Refused) != 0 {
		t.Errorf("refused: %v", result.Refused)
	}
	if again := fixCase(t, copyCompilerFixture(t, twin, root)); len(again.Files) != 0 {
		t.Errorf("fixing the twin again changes %v", again.Order)
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
