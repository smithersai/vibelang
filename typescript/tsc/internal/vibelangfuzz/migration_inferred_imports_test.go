package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const migrationInferredImportsTarget = "FuzzMigrationInferredImports"
const migrationInferredImportsQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."
const migrationInferredImportsCounterpart = "Where a VIP is silent, its TypeScript or pinned TC39 counterpart applies."

func TestMigrationInferredImportsQuoted(t *testing.T) {
	for chapter, quote := range map[string]string{"001-functions.md": migrationInferredImportsQuote, "000-intro.md": migrationInferredImportsCounterpart} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

func migrationInferredImportsPrograms() map[string]string {
	programs := map[string]string{
		"opencode-schema-parse-options": "import { Schema } from \"effect\"\nexport const decode = Schema.decodeUnknownSync(Schema.String)\n",
	}
	for _, home := range []string{"root", "subpath"} {
		for _, library := range []string{"Schema", "Codec"} {
			head := "import { Schema } from \"effect\";\n"
			if library == "Codec" {
				head = "import { Schema as Codec } from \"effect\";\n"
			}
			if home == "subpath" {
				head = "import * as " + library + " from \"effect/Schema\";\n"
			}
			for _, method := range []string{"decodeUnknownSync", "encodeSync"} {
				for typ, expression := range map[string]string{"string": library + ".String", "number": library + ".Number", "array": library + ".Array(" + library + ".String)", "struct": library + ".Struct({ value: " + library + ".String })"} {
					programs[home+":"+library+":"+method+":"+typ] = head + "export const decode = " + library + "." + method + "(" + expression + ");\n"
				}
			}
			programs[home+":"+library+":shadow-SchemaAST"] = head + "export const SchemaAST = \"local\";\nexport const decode = " + library + ".decodeUnknownSync(" + library + ".String);\n"
			for kind, binding := range map[string]string{
				"type":       "export type SchemaAST = string;",
				"namespace":  "export namespace SchemaAST { export type Local = string }",
				"nested":     "{ const SchemaAST = \"local\"; }",
				"used-value": "export const SchemaAST = { errors: \"local\" }; export const local = SchemaAST.errors;",
			} {
				programs[home+":"+library+":shadow-SchemaAST-"+kind] = head + binding + "\nexport const decode = " + library + ".decodeUnknownSync(" + library + ".String);\n"
			}
		}
	}
	return programs
}

func migrationInferredImportsSource(source string, choice uint8) string {
	switch choice % 4 {
	case 1, 3:
		for _, library := range []string{"Schema", "Codec"} {
			alias := library + "Input"
			source = strings.ReplaceAll(source, "{ "+library+" }", "{ "+library+" as "+alias+" }")
			source = strings.ReplaceAll(source, "as "+library+" from", "as "+alias+" from")
			source = strings.ReplaceAll(source, "as "+library+" }", "as "+alias+" }")
			source = strings.ReplaceAll(source, library+".", alias+".")
		}
	}
	if choice%4 >= 2 {
		source = "// decoder factory with a local public export\n" + strings.ReplaceAll(source, "const decode =", "const read =")
	}
	return source
}

// OpenCode's decoder factory is ordinary TypeScript in both source kinds.
// Compare its declarations byte for byte, including module qualifiers, against
// the same compiler checking its TypeScript counterpart. Only bounded import,
// codec, schema-shape, local-shadow and export-alias mutations are generated;
// arbitrary functions would introduce the separate thrown-contract rule.
// Chapter 007 / inferred Schema types preserve native namespace and aliases: docs/design/src/007-tooling.md#7632e2a24e933861

func FuzzMigrationInferredImports(f *testing.F) {
	startShortBudget(f)
	programs := migrationInferredImportsPrograms()
	keys := []string{}
	for key := range programs {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	for choice := uint8(1); choice < 4; choice++ {
		f.Add("opencode-schema-parse-options", choice)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice uint8) {
		TestMigrationInferredImportsQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		choice %= 4
		source := migrationInferredImportsSource(programs[key], choice)
		outputs := []map[string]string{}
		for _, extension := range []string{"ts", "vibe"} {
			var result *Result
			var err error
			within(t, "emit inferred library declaration", func() {
				result, err = w.Compile(t.Context(), Project{Files: map[string]string{"main." + extension: source}})
			})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if HasError(result.Diagnostics) {
				if extension == "ts" {
					t.Fatalf("the ordinary TypeScript decoder control must compile: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
				}
				Gap(t, migrationInferredImportsTarget, fmt.Sprintf("admission:%s:%d", key, choice), "Chapter1: %q; TypeScript control passes, Vibe reports %v\n%s", migrationInferredImportsQuote, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
			}
			declarations := map[string]string{}
			for name, text := range result.Outputs {
				if strings.HasSuffix(name, ".d.ts") {
					declarations[name] = text
				}
			}
			if len(declarations) == 0 {
				t.Fatal("decoder emitted no declarations")
			}
			outputs = append(outputs, declarations)
		}
		equal := len(outputs[0]) == len(outputs[1])
		for name, text := range outputs[0] {
			other, exists := outputs[1][name]
			equal = equal && exists && other == text
		}
		if !equal {
			Gap(t, migrationInferredImportsTarget, fmt.Sprintf("declaration:%s:%d", key, choice), "Chapter1: %q; inferred library names must use the native TypeScript qualifier.\nTypeScript: %v\nVibe: %v\n%s", migrationInferredImportsQuote, outputs[0], outputs[1], source)
		}
		ExpectPending(t, migrationInferredImportsTarget, fmt.Sprintf("admission:%s:%d", key, choice))
		ExpectPending(t, migrationInferredImportsTarget, fmt.Sprintf("declaration:%s:%d", key, choice))
		ExpectPending(t, migrationInferredImportsTarget, specCorpusKey(t))
	})
}
