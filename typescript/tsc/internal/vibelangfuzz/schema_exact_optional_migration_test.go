package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const schemaOptionalDefaultQuote = "| `name?: T` / `T?` | `Schema.optional(S)`: missing or present `undefined` | `Schema.optionalKey(S)`: missing only |"

func TestSchemaExactOptionalQuoted(t *testing.T) {
	chapterSays(t, "007-tooling.md", "A rewrite that can't preserve types, behavior and declaration output refuses at that site")
	if !strings.Contains(SpecText("006-data.md"), schemaOptionalDefaultQuote) {
		t.Fatalf("006-data.md no longer contains %q", schemaOptionalDefaultQuote)
	}
}

// VIP-15's TypeScript meaning and Chapter 7's behavior-preserving fixes:
// a compatibility upgrade spells the old undefined acceptance explicitly.
// Vary the source position, nesting, readonly key and project option, and
// assert both the preserved decoder choice and a stable second fix.
func FuzzSchemaExactOptionalMigration(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	for _, key := range []string{"schema", "schema-error", "tuple", "data", "nested-native"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(7))
		f.Add(key, uint8(8))
		f.Add(key, uint8(15))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestSchemaExactOptionalQuoted(t)
		typ, mod := "string", ""
		if mode&2 != 0 {
			typ = "number"
		}
		if mode&4 != 0 {
			mod = "readonly "
		}
		source := "export schema S { " + mod + "value?: " + typ + " }\n"
		switch key {
		case "schema-error":
			source = "export schema error S { value?: " + typ + " }\n"
		case "nested-native":
			source = "export schema S { value?: { inside?: string } }\nexport interface Native { value?: string }\n"
		case "tuple":
			source = "export schema S = readonly [(" + typ + ")?]\n"
		case "data":
			source = "export data S { Some { value?: " + typ + " } }\n"
		default:
			key = "schema"
		}
		exact := mode&1 != 0
		migrate := mode&8 == 0
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"exactOptionalPropertyTypes":%t,"declaration":true,"outDir":"out"},"files":["main.vibe"]}`, exact)
		before, err := w.CompileOrdered(t.Context(), Project{Files: map[string]string{"main.vibe": source}, Config: config}, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		if HasError(before.Diagnostics) {
			t.Fatalf("bad generated program: %v", before.Diagnostics)
		}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{MigrationOnly: migrate})
		if fixed.Err != nil || len(fixed.Refused) != 0 {
			t.Fatalf("migration failed: %+v", fixed)
		}
		after := source
		for _, file := range fixed.Files {
			after = file.Text
		}
		want := exact && migrate && key != "data"
		if strings.Contains(after, "| undefined") != want {
			Gap(t, "FuzzSchemaExactOptionalMigration", key, "exact=%t\nbefore:\n%s\nafter:\n%s", exact, source, after)
		}
		if key == "nested-native" {
			for _, fragment := range []string{"readonly value?", "readonly inside?", "export interface Native { readonly value?: string }"} {
				if strings.Contains(after, fragment) != migrate {
					Gap(t, "FuzzSchemaExactOptionalMigration", key+":readonly:"+fragment, "explicit legacy upgrade alone writes readonly; migrate=%t\n%s", migrate, after)
				}
			}
		}
		checked, err := w.CompileOrdered(t.Context(), Project{Files: map[string]string{"main.vibe": after}, Config: config}, OrderTsc, true)
		if err != nil {
			t.Fatal(err)
		}
		defer checked.Remove()
		if HasError(checked.Diagnostics) {
			Gap(t, "FuzzSchemaExactOptionalMigration", key+":errors", "%v", checked.Diagnostics)
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, checked.Dir), vibelang.FixOptions{MigrationOnly: migrate})
		if again.Err != nil || len(again.Refused) != 0 || len(again.Files) != 0 {
			Gap(t, "FuzzSchemaExactOptionalMigration", key+":idempotence", "%+v", again)
		}
	})
}
