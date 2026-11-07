package vibelangfuzz

import (
	"encoding/json"
	"maps"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestRetiredStyleImportsQuoted(t *testing.T) {
	TestRetiredConfigOptionsQuoted(t)
	chapterSays(t, "007-tooling.md", "Written `./x.vibe` and `./x.vibex` imports follow the `.ts`/`.tsx` twin's source-extension checks, including `TS5097` for a value import without `allowImportingTsExtensions` or `rewriteRelativeImportExtensions`.")
	chapterSays(t, "007-tooling.md", "`rewriteRelativeImportExtensions` rewrites JavaScript specifiers, not declaration specifiers")
}

// A retired option must leave the bytes of the same admitted project unchanged.
func FuzzRetiredStyleImports(f *testing.F) {
	startShortBudget(f)
	for _, place := range []string{"root", "compilerOptions"} {
		for _, value := range []string{`".js"`, `".ts"`, `"extensionless"`, `"invalid"`, "42", "null", "{}"} {
			f.Add(place, value, byte(0))
			f.Add(place, value, byte(31))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, place, value string, mode byte) {
		TestRetiredStyleImportsQuoted(t)
		if place != "root" && place != "compilerOptions" {
			place = []string{"root", "compilerOptions"}[len(place)%2]
		}
		if len(value) > 1024 || !json.Valid([]byte(value)) {
			value = "null"
		}
		var setting any
		if err := json.Unmarshal([]byte(value), &setting); err != nil {
			t.Fatal(err)
		}
		ext := ".vibe"
		if mode&1 != 0 {
			ext = ".vibex"
		}
		main := "main" + ext
		leaf := "leaf" + ext
		source := "export { value } from \"./" + leaf + "\"\nimport type { T } from \"./plain\"\nexport type U = T | undefined\nexport const made = (): T => ({ n: 1 })\n"
		if mode&2 != 0 {
			source = "// retained é\r\n" + strings.ReplaceAll(source, "\n", "\r\n")
		}
		files := map[string]string{main: source, leaf: "export const value: number = 1\n", "plain.ts": "export type T = { readonly n: number }\n"}
		options := map[string]any{"target": "ES2022", "module": "preserve", "moduleResolution": "bundler", "strict": true, "skipLibCheck": true, "declaration": true, "outDir": "out", "rootDir": ".", "types": []string{}, "jsx": "preserve", "rewriteRelativeImportExtensions": true}
		compile := func(retired bool) *Result {
			opts := maps.Clone(options)
			config := map[string]any{"compilerOptions": opts, "files": []string{main, leaf, "plain.ts"}}
			if retired {
				entry := map[string]any{"declarationImportStyle": setting}
				if place == "root" {
					config["vibelang"] = entry
				} else {
					opts["vibelang"] = entry
				}
			}
			text, err := json.Marshal(config)
			if err != nil {
				t.Fatal(err)
			}
			result, err := w.Compile(t.Context(), Project{Files: maps.Clone(files), Config: string(text)})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(result.Remove)
			return result
		}
		before := compile(false)
		if len(before.Diagnostics) != 0 {
			t.Fatalf("native source-extension option did not admit fixture: %v", diagnosticTexts(before.Diagnostics))
		}
		after := compile(true)
		if len(after.Diagnostics) != 1 || !IsEK(after.Diagnostics[0]) || after.Diagnostics[0].Code() != 3011 || after.Diagnostics[0].Category() != diagnostics.CategoryWarning {
			Gap(t, "FuzzRetiredStyleImports", place, "chapter 007 retired option adds only EK3011 for every JSON value: %v", diagnosticTexts(after.Diagnostics))
		}
		if !reflect.DeepEqual(before.Outputs, after.Outputs) {
			Gap(t, "FuzzRetiredStyleImports", place, "chapter 007 retired option changed source import declarations or JavaScript")
		}
		ExpectPending(t, "FuzzRetiredStyleImports", place)
	})
}
