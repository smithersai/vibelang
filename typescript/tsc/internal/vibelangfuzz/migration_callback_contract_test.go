package vibelangfuzz

import (
	"maps"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const migrationCallbackContractQuote = "a type without `@throws` admits only `never`"

func TestMigrationCallbackContractQuoted(t *testing.T) {
	if !strings.Contains(SpecText("003-failures.md"), migrationCallbackContractQuote) {
		t.Fatalf("Chapter 3 no longer says %q", migrationCallbackContractQuote)
	}
}

// A callback in original TypeScript admits a foreign thrower. Retaining it in
// VibeLang requires an imported foreign signature and defect bridges, rather
// than silently making the original callback nonthrowing.
func FuzzMigrationCallbackContract(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"migration/string", "vip/string", "migration/token", "vip/array", "migration/object"} {
		f.Add(key)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		TestMigrationCallbackContractQuoted(t)
		mode, shape, ok := strings.Cut(key, "/")
		if !ok || mode != "migration" && mode != "vip" {
			mode = "migration"
			shape = "string"
		}
		typ, imports, foreign := "string", "", "export const foreign = (s: string): string => s;\n"
		switch shape {
		case "token":
			typ = "Token"
			imports = "import type {Token} from \"./foreign.js\";\n"
			foreign = "export type Token = string & {readonly token: unique symbol};\nexport const foreign = (s: string): Token => s as Token;\n"
		case "object":
		case "array":
			typ = "ReadonlyArray<string>"
			foreign = "export const foreign = (s: string): ReadonlyArray<string> => [s];\n"
		default:
			shape = "string"
		}
		source := "import {foreign} from \"./foreign.js\";\n" + imports + "const apply = (make: (s: string) => " + typ + ") => effect {return make(\"id\")};\nexport const p = apply(foreign);\n"
		if shape == "object" {
			source = "import * as Effect from \"effect/Effect\";\nimport {foreign} from \"./foreign.js\";\nconst apply = <Id>(input: {readonly make: (s: string) => Id}) => Effect.map(Effect.succeed(\"id\"),(id) => input.make(id));\nexport const p = apply({make: foreign});\n"
		}
		files := map[string]string{"foreign.ts": foreign, "main.vibe": source}
		before := toolsCompile(t, w, "FuzzMigrationCallbackContract", files)
		defer before.Remove()
		config := toolsConfig(w, before.Dir)
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{MigrationOnly: mode == "migration", VIPOnly: mode == "vip"})
		if result.Err != nil {
			Gap(t, "FuzzMigrationCallbackContract", mode+"/"+shape, "Chapter 7: preserving migration failed: %v", result.Err)
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		after := toolsCompile(t, w, "FuzzMigrationCallbackContract", fixed)
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, "FuzzMigrationCallbackContract", mode+"/"+shape, "Chapter 3: callback contract or defect bridge was lost: %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), fixed["main.vibe"])
		}
	})
}
