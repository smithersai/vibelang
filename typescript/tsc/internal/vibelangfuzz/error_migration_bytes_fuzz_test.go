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

// Chapter 7: "A quick fix is offered only when it preserves evaluation order,
// coldness, types, comments, and declaration output; otherwise the diagnostic
// explains why it has no automatic fix." Detail 273 applies this rule to
// fieldless TaggedError classes with an explicit empty payload. Compare bytes
// with stock TypeScript, including the empty type argument, rather than the
// canonical migration gate (which can erase that spelling distinction).
func FuzzErrorMigrationDeclarationBytes(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	tsc := StockTypeScript(f)
	for _, seed := range []string{"error-twin:", "error-twin:braces", "error-twin:id", "error-twin:id;count?", "error-twin:id;count?;tags;cause?"} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		TestMigrationDeclarationFixQuoted(t)
		const target = "FuzzErrorMigrationDeclarationBytes"
		defer recoverCompilerPanic(t, target)
		e := parseErrorTwin(data)
		// Class methods/getters are not eligible for EK4830. Their native
		// declarations remain covered by FuzzErrorDeclarationTwin.
		e.method, e.getter = false, false
		source := strings.ReplaceAll(e.twin(), "Failure", "MissingBuildId")
		if len(e.fields) == 0 && e.braces {
			source = strings.Replace(source, `TaggedError("MissingBuildId")`, `TaggedError("MissingBuildId")<{}>`, 1)
		}
		original := Project{Files: map[string]string{"main.vibe": source}, Config: fmt.Sprintf(errorTwinConfig, "main.vibe")}
		var before *Compilation
		var err error
		within(t, "compile", func() { before, err = w.CompileOrdered(t.Context(), original, OrderTsc, true) })
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		if before.Program == nil || HasError(before.Diagnostics) {
			t.Fatalf("invalid generated source: %v\n%s", SortedKeys(Keys(before.Dir, before.Diagnostics)), source)
		}
		var fixed *vibelang.FixResult
		within(t, "fix", func() {
			fixed = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
		})
		if fixed.Err != nil {
			t.Fatal(fixed.Err)
		}
		afterSource := source
		for _, file := range fixed.Files {
			afterSource = file.Text
		}
		afterProject := Project{Files: map[string]string{"main.vibe": afterSource}, Config: original.Config}
		var after *Compilation
		within(t, "compile", func() { after, err = w.CompileOrdered(t.Context(), afterProject, OrderTsc, true) })
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if after.Program == nil || HasError(after.Diagnostics) {
			Gap(t, target, fmt.Sprintf("fix:fields-%d", len(e.fields)), "safe fix introduced errors: %v", SortedKeys(Keys(after.Dir, after.Diagnostics)))
		}
		stock := Project{Files: map[string]string{"main.ts": source}, Config: fmt.Sprintf(errorTwinConfig, "main.ts")}
		dir := emitDeclarationIdentityStock(t, w, tsc, stock)
		defer os.RemoveAll(dir)
		want, err := os.ReadFile(filepath.Join(dir, "__identity_out", "main.d.ts"))
		if err != nil {
			t.Fatal(err)
		}
		for _, side := range []struct {
			name string
			c    *Compilation
		}{{"before", before}, {"after", after}} {
			got, ok := side.c.Outputs["__identity_out/main.d.ts"]
			if !ok {
				t.Fatal("missing declaration output", side.c.Outputs)
			}
			if diff := compareDeclarationTexts(t, string(want), got); diff != "" {
				Gap(t, target, fmt.Sprintf("bytes:%s:fields-%d:explicit-%t", side.name, len(e.fields), e.braces), "Chapter 7: %s\nstock TypeScript:\n%s\n%s fix:\n%s\nsource:\n%s\nfixed:\n%s\nAPI:\n%s", migrationDeclarationFixQuote, want, side.name, got, source, afterSource, diff)
			}
		}
	})
}
