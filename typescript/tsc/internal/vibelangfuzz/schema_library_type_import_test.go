package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const schemaTypeImportTarget = "FuzzSchemaLibraryTypeOnlyImport"
const schemaTypeImportQuote = "These names mean the TypeScript-library bindings, selected by ordinary type lookup, as VIP-15's mapped generics do. A shadowing declaration supplies no schema."

func TestSchemaLibraryTypeOnlyImportQuoted(t *testing.T) {
	text, err := os.ReadFile(SpecPath("../vips/0044-durable-values.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), schemaTypeImportQuote) {
		t.Fatalf("VIP-44 no longer says %q", schemaTypeImportQuote)
	}
}

func FuzzSchemaLibraryTypeOnlyImport(f *testing.F) {
	startShortBudget(f)
	names := []string{"Date", "URL", "RegExp", "Uint8Array", "Error"}
	for _, name := range names {
		for syntax := range uint8(4) {
			f.Add(name, syntax, uint8(0), false)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, syntax, shape uint8, alias bool) {
		TestSchemaLibraryTypeOnlyImportQuoted(t)
		if key == "" || len(key) > 128 {
			return
		}
		name := names[int(key[0])%len(names)]
		for _, candidate := range names {
			if key == candidate {
				name = candidate
			}
		}
		module := "import Library=globalThis." + name + "; export {Library};"
		prefix := "import type {Library as Native} from './types.js'; "
		field := "Native"
		switch syntax % 4 {
		case 1:
			prefix = "import {type Library as Native} from './types.js'; "
		case 2:
			module = "import Library=globalThis." + name + "; export type {Library};"
			prefix = "import {Library as Native} from './types.js'; "
		case 3:
			prefix = "import type * as Types from './types.js'; "
			field = "Types.Library"
		}
		codec := "Schema." + name
		if name == "Error" {
			codec = "Schema.Defect().pipe(Schema.refine((u):u is globalThis.Error=>u instanceof globalThis.Error))"
		}
		switch shape % 3 {
		case 1:
			field, codec = "readonly "+field+"[]", "Schema.Array("+codec+")"
		case 2:
			field, codec = "ReadonlyMap<"+field+",number>", "Schema.ReadonlyMap("+codec+",Schema.Number)"
		}
		native := "import * as Schema from 'effect/Schema'; " + prefix + "const Codec=" + codec + "; type Shape=" + field + "; export function a(x:Shape):typeof Codec.Type{return x} export function b(x:typeof Codec.Type):Shape{return x}"
		vibe := prefix + "export schema Example {readonly value:" + field + "}"
		if alias {
			vibe = prefix + "export schema Example=" + field
		}
		for _, row := range []struct{ file, source string }{{"main.ts", native}, {"main.vibe", vibe}} {
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{row.file: row.source, "types.ts": module}})
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
				Gap(t, schemaTypeImportTarget, fmt.Sprintf("%s/%d/%d/%t", name, syntax%4, shape%3, alias), schemaTypeImportQuote+"; %s\n%s", specDiagnosticText(d), vibe)
				return
			}
		}
	})
}

func TestSchemaLibraryTypeOnlyValueControls(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range []string{
		"import type {Library as Native} from './types.js'; export const value=Native",
		"import type {Codec} from './types.js'; export schema Example=Codec",
		"import type * as Types from './types.js'; export const value=Types.Library",
	} {
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "types.ts": "import {Schema} from 'effect'; import Library=globalThis.Date; export {Library}; export const Codec=Schema.String"}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		found := false
		for _, d := range result.Diagnostics {
			if d.Code() == 1361 {
				found = true
			}
		}
		if !found {
			t.Fatalf("ordinary value use must retain TS1361: %s; %v", source, result.Diagnostics)
		}
	}
	for _, source := range []string{
		"export schema Example=Date; const Date=0",
		"let Date:number; export schema Example=Date",
	} {
		result, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("%s\n%s", specDiagnosticText(d), source)
			}
		}
	}
}

func TestSchemaLibraryTypeOnlyImportUnused(t *testing.T) {
	w := NewWorkspace(t)
	config := strings.Replace(DefaultConfig, `"strict": true,`, `"strict": true, "noUnusedLocals": true,`, 1)
	config = strings.TrimSuffix(config, "\n}") + ",\n" + `"files":["main.vibe","types.ts"]` + "\n}"
	for _, source := range []string{
		"import type {Library as Native} from './types.js'; export schema Example=Native",
		"import type * as Types from './types.js'; export schema Example=Types.Library",
	} {
		result, err := w.Compile(t.Context(), Project{Config: config, Files: map[string]string{
			"main.vibe": source,
			"types.ts":  "import Library=globalThis.Date; export {Library}",
		}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				t.Errorf("%s", specDiagnosticText(d))
			}
		}
	}
}
