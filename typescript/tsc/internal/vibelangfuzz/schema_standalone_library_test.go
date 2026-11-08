package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const schemaStandaloneTarget = "FuzzSchemaStandaloneLibraryAlias"
const schemaStandaloneQuote = "Each row is written from the TypeScript type, as VIP-15's mapping is."

func TestSchemaStandaloneLibraryAliasQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("../vips/0044-durable-values.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), schemaStandaloneQuote) {
		t.Fatalf("VIP-44 no longer says %q", schemaStandaloneQuote)
	}
}

func FuzzSchemaStandaloneLibraryAlias(f *testing.F) {
	startShortBudget(f)
	names := []string{"Date", "URL", "RegExp", "Uint8Array", "Error"}
	for _, name := range names {
		f.Add(name, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, shape uint8) {
		TestSchemaStandaloneLibraryAliasQuoted(t)
		if len(key) == 0 || len(key) > 128 {
			return
		}
		name := names[int(key[0])%len(names)]
		for _, candidate := range names {
			if key == candidate {
				name = candidate
			}
		}
		field, codec := name, "Schema."+name
		if name == "Error" {
			codec = "Schema.Defect().pipe(Schema.refine((u): u is Error => u instanceof Error))"
		}
		switch shape % 4 {
		case 1:
			field, codec = "readonly "+field+"[]", "Schema.Array("+codec+")"
		case 2:
			field, codec = "readonly ["+field+"]", "Schema.Tuple(["+codec+"])"
		case 3:
			field, codec = field+" | null", "Schema.Union(["+codec+", Schema.Null])"
		}
		native := "import {Schema} from 'effect'; const Codec=" + codec + "; type Native=" + field + "; export function a(x:Native):typeof Codec.Type{return x} export function b(x:typeof Codec.Type):Native{return x}"
		vibe := "export schema Example = " + field
		for _, row := range []struct{ file, source string }{{"main.ts", native}, {"main.vibe", vibe}} {
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{row.file: row.source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					if row.file == "main.ts" {
						t.Fatalf("invalid native counterpart: %s", specDiagnosticText(d))
					}
					Gap(t, schemaStandaloneTarget, fmt.Sprintf("alias:%s/%d", name, shape%4), schemaStandaloneQuote+"; %s\n%s", specDiagnosticText(d), vibe)
					return
				}
			}
		}
	})
}
