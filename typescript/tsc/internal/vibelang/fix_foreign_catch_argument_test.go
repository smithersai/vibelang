package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The catch operand's parser-made arrow has no effect keyword to edit.
func TestForeignCallFixCatchArgument(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	for _, handler := range []string{
		"() => \"cancel\"",
		"effect () => \"cancel\"",
		"effect (e) => match (e) { when { _tag: \"Cancelled\" }: \"cancel\" as const; default: throw e; }",
	} {
		t.Run(handler, func(t *testing.T) {
			dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/foreign-call-catch-argument.fail"), root)
			source := "import { terminal, view } from './foreign.ts'\nexport effect function main() { return terminal.prompt.screen(view({ initialValue: 'cancel' as const })) catch " + handler + " }\n"
			if err := os.WriteFile(filepath.Join(dir, "main.vibe"), []byte(source), 0600); err != nil {
				t.Fatal(err)
			}
			result := fixCase(t, dir)
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("fix: %v; refused: %+v", result.Err, result.Refused)
			}
			for file, fixed := range result.Files {
				if filepath.Base(file.AsString()) == "main.vibe" {
					if !strings.Contains(fixed.Text, "screen(try Effect.orDie(Effect.try(") || strings.Contains(fixed.Text, "effect terminal") {
						t.Fatalf("changed catch operand: %s", fixed.Text)
					}
				}
				if err := os.WriteFile(file.AsString(), []byte(fixed.Text), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if len(result.Files) == 0 {
				t.Fatal("foreign call was not fixed")
			}
			if again := fixCase(t, dir); again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("not idempotent: %+v", again)
			}
		})
	}
}
