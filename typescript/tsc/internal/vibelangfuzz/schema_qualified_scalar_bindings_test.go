package vibelangfuzz

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const qualifiedScalarTarget = "FuzzSchemaQualifiedScalarBinding"
const qualifiedScalarQuote = "These names mean the TypeScript-library bindings, selected by ordinary type lookup, as VIP-15's mapped generics do. A shadowing declaration supplies no schema."

func TestSchemaQualifiedScalarBindingQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("../vips/0044-durable-values.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), qualifiedScalarQuote) {
		t.Fatalf("VIP-44 no longer says %q", qualifiedScalarQuote)
	}
}

func FuzzSchemaQualifiedScalarBinding(f *testing.F) {
	startShortBudget(f)
	names := []string{"Date", "URL", "RegExp", "Uint8Array", "Error"}
	for _, name := range names {
		f.Add(name + "/0/0")
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestSchemaQualifiedScalarBindingQuoted(t)
		if key == "" || len(key) > 128 {
			return
		}
		parts := strings.Split(key, "/")
		name := names[int(key[0])%len(names)]
		for _, candidate := range names {
			if parts[0] == candidate {
				name = candidate
			}
		}
		shape, home := int(key[len(key)-1])%6, 0
		if len(parts) > 1 {
			if n, err := strconv.Atoi(parts[1]); err == nil {
				shape = int(uint(n) % 6)
			}
		}
		if len(parts) > 2 {
			if n, err := strconv.Atoi(parts[2]); err == nil {
				home = int(uint(n) % 2)
			}
		}
		field, codec := "globalThis."+name, "Schema."+name
		if name == "Error" {
			codec = "Schema.Defect().pipe(Schema.refine((u): u is Error => u instanceof Error))"
		}
		switch shape {
		case 1:
			field, codec = "readonly "+field+"[]", "Schema.Array("+codec+")"
		case 2:
			field, codec = "readonly ["+field+"]", "Schema.Tuple(["+codec+"])"
		case 3:
			field, codec = field+" | null", "Schema.Union(["+codec+", Schema.Null])"
		case 4:
			field, codec = "ReadonlySet<"+field+">", "Schema.ReadonlySet("+codec+")"
		case 5:
			field, codec = "ReadonlyMap<string, "+field+">", "Schema.ReadonlyMap(Schema.String, "+codec+")"
		}
		vibe := "export schema Example = " + field
		expected := "export const Example = " + codec
		nativeType := field
		if home == 1 {
			vibe = "export schema Example { readonly value: " + field + " }"
			expected = "export const Example = Schema.Struct({ value: " + codec + " })"
			nativeType = "{ readonly value: " + field + " }"
		}
		native := "import {Schema} from 'effect'; " + expected + "; type Native = " + nativeType + "; " +
			"export function a(value: Native): typeof Example.Type { return value } export function b(value: typeof Example.Type): Native { return value }"
		precise := fmt.Sprintf("binding:%s/%d/%d", name, shape, home)
		for _, row := range []struct{ file, source string }{{"main.ts", native}, {"main.vibe", vibe}} {
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{row.file: row.source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					if row.file == "main.ts" {
						t.Fatalf("invalid native counterpart: %s\n%s", specDiagnosticText(d), native)
					}
					Gap(t, qualifiedScalarTarget, precise, "%s\n%s\n%s", qualifiedScalarQuote, specDiagnosticText(d), vibe)
					return
				}
			}
		}
	})
}
