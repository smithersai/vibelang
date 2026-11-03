package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// VIP-4's required bridge preserves the previous $trusted channel split.
func TestForeignThrowsGateFix(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/foreign-throws-gate.fail"), root)
	result := fixCase(t, dir)
	if result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("fix: %v, refused %v", result.Err, result.Refused)
	}
	var text string
	for name, fixed := range result.Files {
		if filepath.Base(name.AsString()) == "main.vibe" {
			text = fixed.Text
			if err := os.WriteFile(name.AsString(), []byte(text), 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	if !strings.Contains(text, "Effect.try({ try: () => range(s)") || !strings.Contains(text, "foreignRangeErrorClass: typeof RangeError") || !strings.Contains(text, "die(error)") {
		t.Fatalf("missing preserving bridge:\n%s", text)
	}
	if again := fixCase(t, dir); len(again.Files) != 0 || len(again.Refused) != 0 {
		t.Fatalf("not idempotent: files %v, refused %v", again.Order, again.Refused)
	}
}

// Import each formerly implicit failure class under a distinct fresh name.
func TestForeignThrowsGateFixImports(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/foreign-throws-gate.fail"), root)
	lib := filepath.Join(dir, "lib.ts")
	text, err := os.ReadFile(lib)
	if err != nil {
		t.Fatal(err)
	}
	source := "export class First extends Error {}\nexport class Second extends Error {}\n" + strings.Replace(string(text), "/** @throws {RangeError} */", "/** @throws {First}\n * @throws {Second} */", 1)
	if err := os.WriteFile(lib, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	result := fixCase(t, dir)
	if result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("fix: %v, refused %v", result.Err, result.Refused)
	}
	var fixed string
	for name, file := range result.Files {
		if filepath.Base(name.AsString()) == "main.vibe" {
			fixed = file.Text
		}
	}
	for _, want := range []string{"First as foreignFirst", "Second as foreignSecond", "typeof foreignFirst", "typeof foreignSecond"} {
		if !strings.Contains(fixed, want) {
			t.Errorf("missing %q in:\n%s", want, fixed)
		}
	}
}

// A running operand needs the old callee/operand/class-read ordering. Leave
// this form for a manual bridge instead of moving a read across the operand.
func TestForeignThrowsGateFixKeepsEffectOperands(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/foreign-throws-gate.fail"), root)
	source := "import { range } from \"./lib.js\"\nconst one = effect (): string!! => \"value\"\nexport effect function probe() { return range(try one()) }\n"
	if err := os.WriteFile(filepath.Join(dir, "main.vibe"), []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	result := fixCase(t, dir)
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	for _, fixed := range result.Files {
		if strings.Contains(fixed.Text, "Effect.try") {
			t.Fatalf("moved an operand across callee/class reads:\n%s", fixed.Text)
		}
	}
}

// An earlier nonthrowing overload made this numeric call's exceptions defects
// in the former emitter. The selected numeric signature now requires a bridge,
// but --fix must not turn those defects into new typed failures.
func TestForeignThrowsGateFixPreservesOverloadChannels(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/foreign-throws-gate.fail"), root)
	lib := "/** @throws {never} */\nexport declare function read(s: string): string\n/** @throws {RangeError} */\nexport declare function read(n: number): number\n"
	source := "import { read } from \"./lib.js\"\nexport effect function probe(): number!! { return read(1) }\n"
	for name, text := range map[string]string{"lib.ts": lib, "main.vibe": source} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	result := fixCase(t, dir)
	if result.Err != nil || len(result.Refused) != 0 {
		t.Fatalf("fix: %v, refused %v", result.Err, result.Refused)
	}
	var text string
	for name, fixed := range result.Files {
		if filepath.Base(name.AsString()) == "main.vibe" {
			text = fixed.Text
		}
	}
	if !strings.Contains(text, "orDie(") || strings.Contains(text, "instanceof") {
		t.Fatalf("changed the legacy overload's failure channel:\n%s", text)
	}
}

// An inaccessible class prevented the former emitter from bridging the whole
// call, including any reachable siblings. Preserve all its exceptions as defects.
func TestForeignThrowsGateFixUnreachableContract(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	for name, tag := range map[string]string{
		"private": "/** @throws {Hidden} */",
		"mixed":   "/** @throws {RangeError}\n * @throws {Hidden} */",
	} {
		t.Run(name, func(t *testing.T) {
			dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/foreign-throws-gate.fail"), root)
			lib := "class Hidden extends Error {}\n" + tag + "\nexport function range(s: string): string { if (!s) throw new Hidden(s); return s }\n"
			if err := os.WriteFile(filepath.Join(dir, "lib.ts"), []byte(lib), 0600); err != nil {
				t.Fatal(err)
			}
			main := "import { range } from \"./lib.js\"\nexport effect function probe(s: string) { return range(s) }\n"
			if err := os.WriteFile(filepath.Join(dir, "main.vibe"), []byte(main), 0600); err != nil {
				t.Fatal(err)
			}
			result := fixCase(t, dir)
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("fix: %v, refused %v", result.Err, result.Refused)
			}
			text := ""
			for name, fixed := range result.Files {
				if filepath.Base(name.AsString()) == "main.vibe" {
					text = fixed.Text
					if err := os.WriteFile(name.AsString(), []byte(text), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			if !strings.Contains(text, "orDie(Effect.try({ try: () => range(s)") || strings.Contains(text, "instanceof") {
				t.Fatalf("inaccessible contract lost its defect bridge:\n%s", text)
			}
			if again := fixCase(t, dir); len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not idempotent: files %v, refused %v", again.Order, again.Refused)
			}
		})
	}
}
