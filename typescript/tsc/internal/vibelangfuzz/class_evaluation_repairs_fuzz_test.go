package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const classEvaluationRepairQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."

func TestClassEvaluationRepairsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), classEvaluationRepairQuote) {
		t.Fatal(classEvaluationRepairQuote)
	}
}

func FuzzClassEvaluationRepairs(f *testing.F) {
	startShortBudget(f)
	for shape := uint8(0); shape < 6; shape++ {
		f.Add(shape, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, shape, variation uint8) {
		TestClassEvaluationRepairsQuoted(t)
		call := "JSON.parse(" + fmt.Sprintf("%q", []string{"invalid", "{", "["}[variation%3]) + ")"
		if variation&4 != 0 {
			call = "JSON.parse(JSON.stringify(" + fmt.Sprintf("%q", "invalid") + ")!)"
		}
		declarations := []string{
			"class C extends " + call + " {}",
			"class C extends (" + call + ") {}",
			"schema error E { value: { readonly [" + call + "]: string } }",
			"schema error E { value?: { readonly [" + call + "]: string } }",
			"schema error E { value: Array<{ readonly [" + call + "]: string }> }",
			"schema error E { value: [{ readonly [" + call + "]: string }] }",
		}
		source := strings.Repeat("// class evaluation\n", int(variation%3)) +
			"export effect function f(): number!! {\n " + declarations[int(shape)%len(declarations)] + "\n return 1\n}\n"
		files := map[string]string{"main.vibe": source}
		before := toolsCompile(t, w, "FuzzClassEvaluationRepairs", files)
		defer before.Remove()
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		if result.Err != nil || len(result.Refused) != 0 {
			t.Fatalf("repair failed: %+v", result)
		}
		var fixed string
		for name, file := range result.Files {
			if filepath.Base(name.AsString()) == "main.vibe" {
				fixed = file.Text
			}
		}
		if !strings.Contains(fixed, "try Effect.orDie(Effect.try({ try: () => JSON.parse(") {
			Gap(t, "FuzzClassEvaluationRepairs", "bridge", "class evaluation changed its defect channel: %s", fixed)
			return
		}
		after := toolsCompile(t, w, "FuzzClassEvaluationRepairs", map[string]string{"main.vibe": fixed})
		defer after.Remove()
		if !toolsErrorFree(after) {
			t.Fatalf("fixed source has errors: %v\n%s", after.Diagnostics, fixed)
		}
		if err := os.WriteFile(filepath.Join(after.Dir, "main.vibe"), []byte(fixed), 0600); err != nil {
			t.Fatal(err)
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
		if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
			t.Fatalf("repair not idempotent: %+v", again)
		}
	})
}
