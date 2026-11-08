package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const libraryAliasTarget = "FuzzSchemaLibraryImportAlias"
const libraryAliasQuote = "These names mean the TypeScript-library bindings, selected by ordinary type lookup, as VIP-15's mapped generics do. A shadowing declaration supplies no schema."

func TestSchemaLibraryImportAliasQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("../vips/0044-durable-values.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), libraryAliasQuote) {
		t.Fatalf("VIP-44 no longer says %q", libraryAliasQuote)
	}
}

func FuzzSchemaLibraryImportAlias(f *testing.F) {
	startShortBudget(f)
	names := []string{"Date", "URL", "RegExp", "Uint8Array", "Error"}
	for _, name := range names {
		f.Add(name, uint8(0), uint8(0), false)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, spelling, shape uint8, alias bool) {
		TestSchemaLibraryImportAliasQuoted(t)
		if key == "" || len(key) > 128 {
			return
		}
		name := names[int(key[0])%len(names)]
		for _, candidate := range names {
			if key == candidate {
				name = candidate
			}
		}
		written := []string{"Native", "Date", "Error"}[spelling%3]
		field, codec := written, "Schema."+name
		if name == "Error" {
			codec = "Schema.Defect().pipe(Schema.refine((u):u is globalThis.Error=>u instanceof globalThis.Error))"
		}
		switch shape % 4 {
		case 1:
			field, codec = "readonly "+field+"[]", "Schema.Array("+codec+")"
		case 2:
			field, codec = "ReadonlySet<"+field+">", "Schema.ReadonlySet("+codec+")"
		case 3:
			field, codec = "ReadonlyMap<"+field+", number>", "Schema.ReadonlyMap("+codec+", Schema.Number)"
		}
		prefix := "import " + written + " = globalThis." + name + "; "
		native := "import * as Schema from 'effect/Schema'; " + prefix + "const Codec=" + codec + "; type NativeShape=" + field + "; export function a(x:NativeShape):typeof Codec.Type{return x} export function b(x:typeof Codec.Type):NativeShape{return x}"
		vibe := prefix + "export schema Example {readonly value: " + field + "}"
		if alias {
			vibe = prefix + "export schema Example = " + field
		}
		for _, row := range []struct{ file, source string }{{"main.ts", native}, {"main.vibe", vibe}} {
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{row.file: row.source}})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			for _, d := range result.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if row.file == "main.ts" {
					t.Fatalf("invalid native counterpart: %s", specDiagnosticText(d))
				}
				Gap(t, libraryAliasTarget, fmt.Sprintf("%s/%s/%d/%t", name, written, shape%4, alias), libraryAliasQuote+"; %s\n%s", specDiagnosticText(d), vibe)
				return
			}
		}
	})
}
