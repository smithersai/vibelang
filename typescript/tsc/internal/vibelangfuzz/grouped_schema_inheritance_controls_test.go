package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
	"maps"
	"path/filepath"
	"strings"
	"testing"
)

func TestGroupedSchemaInheritanceControlsQuoted(t *testing.T) {
	const quote = "| an `extends` clause, `error UserNotFound extends NotFound { … }`, in either error form | `EK2117` |"
	if !strings.Contains(SpecText("003-failures.md"), quote) {
		t.Fatal("inheritance boundary changed")
	}
	TestSchemaFactoryMigrationReturnsQuoted(t)
}
func FuzzGroupedSchemaInheritanceControls(f *testing.F) {
	startShortBudget(f)
	keys := []string{"parent", "child", "both", "namespace", "unicode"}
	for _, key := range keys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestGroupedSchemaInheritanceControlsQuoted(t)
		grouped := "(\"a\" | \"b\") | null"
		if mode&1 != 0 {
			grouped = "((\"a\" | \"b\") | null)[]"
		}
		name := "value"
		if key == "unicode" {
			name = "値"
		}
		parent, child := grouped, "number"
		if key == "child" {
			parent, child = "number", grouped
		}
		if key == "both" {
			child = grouped
		}
		source := "abstract schema error Family { " + name + ":" + parent + " }\nschema error Child extends Family { extra:" + child + " }\n"
		if key == "namespace" {
			source = "namespace N {\n" + source + "}\n"
		}
		files := map[string]string{"main.vibe": source}
		before := toolsCompile(t, w, "FuzzGroupedSchemaInheritanceControls", files)
		defer before.Remove()
		errors := 0
		for _, d := range before.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == 2117 {
				errors++
				continue
			}
			t.Fatalf("unexpected original error: %s", d.String())
		}
		if errors != 1 {
			t.Fatalf("original inheritance must remain rejected: %v", before.Diagnostics)
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{MigrationOnly: true})
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		if len(result.Files) == 0 {
			t.Fatalf("no preserving migration: %v", result.Refused)
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		after := toolsCompile(t, w, "FuzzGroupedSchemaInheritanceControls", fixed)
		defer after.Remove()
		if !toolsErrorFree(after) {
			t.Fatalf("full migration errors: %v\n%s", after.Diagnostics, fixed["main.vibe"])
		}
		if !strings.Contains(fixed["main.vibe"], ".Union(") {
			t.Fatalf("lost grouped codec: %s", fixed["main.vibe"])
		}
	})
}
