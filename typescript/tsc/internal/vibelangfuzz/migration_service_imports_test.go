package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

const migrationServiceImportsTarget = "FuzzMigrationServiceImports"
const migrationServiceImportsQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func TestMigrationServiceImportsQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), migrationServiceImportsQuote) {
		t.Fatalf("Chapter1 no longer says %q", migrationServiceImportsQuote)
	}
	for _, quote := range []string{"declare namespace Users { type Shape = $Users$Shape }", "member modifiers and callable throw metadata are retained."} {
		if !strings.Contains(SpecText("005-services.md"), quote) {
			t.Fatalf("Chapter 5 no longer says %q", quote)
		}
	}
}

func migrationServiceImportPrograms() map[string][2]string {
	pairs := map[string][2]string{}
	add := func(key, prefix, name, tag, fields, shape string) {
		vibe := prefix + "export service " + name + " { static readonly key = " + tag + "; " + fields + " }\n"
		// VIP-9/detail181's native source counterpart includes the same public
		// Shape alias; a bare Context.Service class has no such namespace.
		carrier := name + "_shape"
		native := prefix + "type " + carrier + " = { " + shape + " }\n" +
			"export class " + name + " extends Context.Service<" + name + ", " + carrier + ">()(" + tag + ") {}\n" +
			"export declare namespace " + name + " { type Shape = " + carrier + " }\n"
		pairs[key] = [2]string{vibe, native}
	}
	// Alchemy round3-service-import pattern, using the preserving migration:
	// its written readonly modifier remains explicit under VIP-9. Keep its
	// Context subpath import separate from generated Store names and keys.
	add("alchemy-service-context-subpath", "import * as Context from \"effect/Context\";\n", "Correlation", "\"app/Correlation\"", "readonly id: string", "readonly id: string")
	for _, form := range []string{"root", "subpath"} {
		prefix := "import { Context } from \"effect\";\n"
		if form == "subpath" {
			prefix = "import * as Context from \"effect/Context\";\n"
		}
		for _, field := range []string{"string", "array", "optional", "nested"} {
			typ := map[string]string{"string": "string", "array": "ReadonlyArray<string>", "optional": "string", "nested": "{value: number}"}[field]
			optional := ""
			if field == "optional" {
				optional = "?"
			}
			for _, written := range []bool{false, true} {
				modifier, label := "", "implicit"
				if written {
					modifier, label = "readonly ", "written"
				}
				add(form+":"+field+":"+label, prefix, "Store", "\"probe/Store\"", modifier+"value"+optional+": "+typ, modifier+"value"+optional+": "+typ)
			}
		}
	}
	for _, alias := range []string{"Ctx", "ServiceContext", "DatabaseContext", "ContextAlias"} {
		for _, field := range []string{"string", "array", "optional", "nested"} {
			base := pairs["subpath:"+field+":written"]
			for i := range base {
				base[i] = strings.ReplaceAll(base[i], "import * as Context ", "import * as "+alias+" ")
				base[i] = strings.ReplaceAll(base[i], "Context.", alias+".")
			}
			pairs["alchemy-context-alias:"+alias+":"+field] = base
		}
	}
	return pairs
}

// Alchemy4: a source Context import is part of its TypeScript
// declaration counterpart. Compare complete emitted bytes; normalizing away
// import modules/bindings would miss the reported migration-gate failure.
func FuzzMigrationServiceImports(f *testing.F) {
	startShortBudget(f)
	pairs := migrationServiceImportPrograms()
	keys := make([]string, 0, len(pairs))
	for key := range pairs {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		f.Add(key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestMigrationServiceImportsQuoted(t)
		if _, ok := pairs[key]; !ok {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		pair := pairs[key]
		outputs := [2]string{}
		for _, index := range []int{1, 0} {
			file := "main.vibe"
			if index == 1 {
				file = "main.ts"
			}
			var result *Result
			var err error
			within(t, "emit service import declaration", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{file: pair[index]}}) })
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if HasError(result.Diagnostics) {
				if index == 1 {
					t.Fatalf("invalid native service counterpart: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), pair[index])
				}
				Gap(t, migrationServiceImportsTarget, "compile:"+key, "service must compile before declaration comparison: %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), pair[index])
			}
			output, ok := result.Outputs["out/main.d.ts"]
			if !ok {
				t.Fatalf("no declaration emitted for %s", file)
			}
			outputs[index] = output
		}
		if strings.HasPrefix(key, "alchemy-context-alias:") {
			if outputs[1] != outputs[0] {
				Gap(t, migrationServiceImportsTarget, "declaration:"+key, "Chapter1: %q; keep the written Context alias exactly. Native:\n%s\nVibe:\n%s", migrationServiceImportsQuote, outputs[1], outputs[0])
			}
			ExpectPending(t, migrationServiceImportsTarget, "compile:"+key)
			ExpectPending(t, migrationServiceImportsTarget, "declaration:"+key)
			ExpectPending(t, migrationServiceImportsTarget, specCorpusKey(t))
			return
		}
		if diff := compareDeclarationTexts(t, outputs[1], outputs[0]); diff != "" {
			Gap(t, migrationServiceImportsTarget, "declaration:"+key, "Chapter1: %q\nnative declaration:\n%s\nVibe declaration:\n%s\n%s\nAPI:\n%s", migrationServiceImportsQuote, outputs[1], outputs[0], pair[0], diff)
		}
		ExpectPending(t, migrationServiceImportsTarget, "compile:"+key)
		ExpectPending(t, migrationServiceImportsTarget, "declaration:"+key)
		ExpectPending(t, migrationServiceImportsTarget, specCorpusKey(t))
	})
}
