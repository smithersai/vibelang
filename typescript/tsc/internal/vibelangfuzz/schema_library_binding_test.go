package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const schemaLibraryTarget = "FuzzSchemaLibraryBinding"
const schemaLibraryQuote = "The generic built-ins `Array<T>`, `ReadonlyArray<T>`, `Record<K, V>` and `Readonly<T>` in the table mean the corresponding TypeScript-library type bindings, selected by ordinary type lookup and alias resolution, not by spelling."

func TestSchemaLibraryBindingQuoted(t *testing.T) {
	text := SpecText("006-data.md")
	for _, quote := range []string{schemaLibraryQuote, "`Schema.mutable(Schema.Array(S))`", "`readonly T[]`, `ReadonlyArray<T>`"} {
		if !strings.Contains(text, quote) {
			t.Fatalf("Chapter6 no longer says %q; reread VIP15/detail286", quote)
		}
	}
}

type schemaLibraryBinding struct {
	key, header, reference string
	files                  map[string]string
	readonly               bool
}

// Detail286 requires ordinary type-meaning lookup and alias resolution, not
// spelling dispatch. Both native TS aliases and explicit VIP15 Schema
// counterparts independently check the selected library symbol and mutability.
func schemaLibraryBindings() []schemaLibraryBinding {
	var rows []schemaLibraryBinding
	for _, kind := range []string{"Array", "ReadonlyArray"} {
		ro := kind == "ReadonlyArray"
		stem := strings.ToLower(kind)
		add := func(key, header, reference string, files map[string]string) {
			rows = append(rows, schemaLibraryBinding{stem + "/" + key, header, reference, files, ro})
		}
		add("direct", "", kind, nil)
		add("qualified", "", "globalThis."+kind, nil)
		add("local-alias", "import Sequence = globalThis."+kind+";\n", "Sequence", nil)
		types := "export import Sequence = globalThis." + kind + ";\n"
		add("imported-alias", "import type { Sequence } from \"./types.js\";\n", "Sequence", map[string]string{"types.ts": types})
		add("namespace-alias", "import type * as Types from \"./types.js\";\n", "Types.Sequence", map[string]string{"types.ts": types})
		add("imported-canonical", "import type { "+kind+" } from \"./types.js\";\n", kind, map[string]string{"types.ts": "export import " + kind + " = globalThis." + kind + ";\n"})
		other := "ReadonlyArray"
		if ro {
			other = "Array"
		}
		add("cross-alias", "import type { "+other+" } from \"./types.js\";\n", other, map[string]string{"types.ts": "export import " + other + " = globalThis." + kind + ";\n"})
	}
	return rows
}

func schemaLibraryPrograms(row schemaLibraryBinding, field bool) (vibe, native string) {
	typ := row.reference + "<number>"
	codec := "Schema.Array(Schema.Number)"
	if !row.readonly {
		codec = "Schema.mutable(" + codec + ")"
	}
	access := "value.push(1)"
	declaration := "export schema S = " + typ + ";\n"
	if field {
		declaration = "export schema S { items: " + typ + " }\n"
		typ = "{ items: " + typ + " }"
		codec = "Schema.Struct({ items: Schema.mutableKey(" + codec + ") })"
		access = "value.items.push(1)"
	}
	vibe = row.header + declaration + "export function use(value: S) { return " + access + "; }\n"
	native = "import * as Schema from \"effect/Schema\";\n" + row.header +
		"const Expected = " + codec + ";\ntype Native = " + typ + ";\ntype Mapped = typeof Expected.Type;\n" +
		"export function useNative(value: Native) { return " + access + "; }\n" +
		"export function useMapped(value: Mapped) { return " + access + "; }\n"
	return
}

func schemaLibraryCodes(t *testing.T, w *Workspace, row schemaLibraryBinding, name, source string) []string {
	t.Helper()
	files := map[string]string{name: source, "package.json": "{\"type\":\"module\"}"}
	for name, source := range row.files {
		files[name] = source
	}
	var result *Result
	var err error
	within(t, "schema library binding", func() { result, err = w.Compile(t.Context(), Project{Files: files}) })
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	var codes []string
	errorCount := 0
	for _, d := range result.Diagnostics {
		if d.Category() == diagnostics.CategoryError {
			errorCount++
			prefix := d.Source()
			if prefix == "" {
				prefix = "TS"
			}
			codes = append(codes, fmt.Sprintf("%s%04d", prefix, d.Code()))
		}
	}
	if name == "main.ts" && row.readonly && errorCount != 2 {
		t.Fatalf("native alias and explicit Schema must each reject push, got %d diagnostics: %v", errorCount, codes)
	}
	slices.Sort(codes)
	return slices.Compact(codes)
}

func FuzzSchemaLibraryBinding(f *testing.F) {
	startShortBudget(f)
	rows := schemaLibraryBindings()
	for _, row := range rows {
		for _, home := range []string{"alias", "field"} {
			f.Add(row.key + "/" + home)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestSchemaLibraryBindingQuoted(t)
		if key == "" {
			return
		}
		row := rows[int(key[0])%len(rows)]
		field := key[len(key)-1]&1 != 0
		for _, candidate := range rows {
			for _, home := range []string{"alias", "field"} {
				if key == candidate.key+"/"+home {
					row, field = candidate, home == "field"
				}
			}
		}
		home := "alias"
		if field {
			home = "field"
		}
		precise := "library:" + row.key + "/" + home
		vibe, native := schemaLibraryPrograms(row, field)
		control := schemaLibraryCodes(t, w, row, "main.ts", native)
		var expected []string
		if row.readonly {
			expected = []string{"TS2339"}
		}
		if !slices.Equal(control, expected) {
			t.Fatalf("invalid native/library Schema control %s: want %v got %v\n%s", precise, expected, control, native)
		}
		actual := schemaLibraryCodes(t, w, row, "main.vibe", vibe)
		if !slices.Equal(actual, expected) {
			Gap(t, schemaLibraryTarget, precise, "VIP15/detail286: resolved library symbol selects its mapping and mutability; %s; want %v got %v\n%s", schemaLibraryQuote, expected, actual, vibe)
		}
		ExpectPending(t, schemaLibraryTarget, precise)
		ExpectPending(t, schemaLibraryTarget, specCorpusKey(t))
	})
}
