package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
	"maps"
	"path/filepath"
	"strings"
	"testing"
)

func TestSchemaFactoryMigrationReturnsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("006-data.md"), schemaWrittenMutabilityQuote) {
		t.Fatal("missing TypeScript mutability rule")
	}
}
func FuzzSchemaFactoryMigrationReturns(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"root", "namespace", "extra-payload", "unicode"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		toolsGuard(t, "FuzzSchemaFactoryMigrationReturns", func() {
			TestSchemaFactoryMigrationReturnsQuoted(t)
			field := "n"
			if key == "unicode" {
				field = "値"
			}
			payload := field + ":Mutable;count:number"
			if mode&1 != 0 {
				payload += ";note?:string"
			}
			source := "const Mutable=Schema.mutableKey(Schema.Number)\nabstract schema error Base {value:{" + payload + "}}\nschema error Child extends Base {}\n"
			if key == "extra-payload" {
				source = strings.Replace(source, "Child extends Base {}", "Child extends Base {extra:{value:Mutable}}", 1)
			}
			if key == "namespace" {
				source = "namespace N {" + source + "}\n"
			}
			files := map[string]string{"main.vibe": source}
			before := toolsCompile(t, w, "FuzzSchemaFactoryMigrationReturns", files)
			defer before.Remove()
			result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{MigrationOnly: true})
			if result.Err != nil {
				t.Fatal(result.Err)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			if strings.Contains(fixed["main.vibe"], "infer _") {
				t.Fatal("migration retained a retired generated return marker")
			}
			after := toolsCompile(t, w, "FuzzSchemaFactoryMigrationReturns", fixed)
			defer after.Remove()
			if !toolsErrorFree(after) {
				t.Fatalf("migrated native schema has errors: %v\n%s", after.Diagnostics, fixed["main.vibe"])
			}
		})
	})
}
