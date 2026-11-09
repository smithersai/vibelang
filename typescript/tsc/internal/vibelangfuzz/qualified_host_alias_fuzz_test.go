package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const qualifiedHostAliasQuote = "A global is banned when the symbol has a declaration in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, none in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist below."

func qualifiedHostAliasQuoted(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("005-services.md"), qualifiedHostAliasQuote) {
		t.Fatal(qualifiedHostAliasQuote)
	}
}
func TestQualifiedHostAliasQuoted(t *testing.T) { qualifiedHostAliasQuoted(t) }
func FuzzQualifiedHostAlias(f *testing.F) {
	startShortBudget(f)
	qualifiedHostAliasQuoted(f)
	var rows []struct {
		Key, Source, Mode string
		Errors            []string
	}
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/qualified-host-alias.json"))
	if err != nil {
		f.Fatal(err)
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		f.Fatal(err)
	}
	for _, row := range rows {
		f.Add([]byte(row.Key + "\x00\x00"))
		f.Add([]byte(row.Key + "\x00\x01"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		qualifiedHostAliasQuoted(t)
		parts := strings.SplitN(string(data), "\x00", 2)
		index := slices.IndexFunc(rows, func(row struct {
			Key, Source, Mode string
			Errors            []string
		}) bool {
			return row.Key == parts[0]
		})
		if index < 0 {
			index = len(data) % len(rows)
		}
		row := rows[index]
		source := row.Source
		if len(parts) > 1 && len(parts[1]) > 0 && parts[1][0]&1 != 0 {
			source = "// preserve qualified alias trivia\n" + strings.ReplaceAll(source, "Alias", "Älias")
		}
		files := map[string]string{"main.vibe": source, "node_modules/@types/node/package.json": `{"name":"@types/node","types":"index.d.ts"}`,
			"node_modules/@types/node/index.d.ts": "declare namespace Bun {namespace platform {const value:number;namespace nested {const value:number;namespace deeper {const value:number}}}}declare namespace HostRuntime {namespace platform {const value:number;namespace nested {const value:number;namespace deeper {const value:number}}}}declare namespace Bun {namespace platform {namespace TypesOnly {interface Value {id:number}}}}declare namespace HostRuntime {namespace platform {namespace TypesOnly {interface Value {id:number}}}}",
			"node_modules/library/package.json":   `{"name":"library","types":"index.d.ts"}`,
			"node_modules/library/index.d.ts":     "export namespace platform {const value:number}",
			"package.json":                        fmt.Sprintf(`{"type":%q}`, row.Mode)}
		r, err := w.Compile(t.Context(), Project{Config: "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[],\"noEmit\":true},\"files\":[\"main.vibe\",\"node_modules/@types/node/index.d.ts\"]}", Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var codes []string
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			prefix := d.Source()
			if prefix == "" {
				prefix = "TS"
			}
			codes = append(codes, fmt.Sprintf("%s%d", prefix, d.Code()))
		}
		slices.Sort(codes)
		if !slices.Equal(codes, row.Errors) {
			Gap(t, "FuzzQualifiedHostAlias", row.Key, "%s: expected %v, got %v", qualifiedHostAliasQuote, row.Errors, codes)
			return
		}
		ExpectPending(t, "FuzzQualifiedHostAlias", row.Key)
		ExpectPending(t, "FuzzQualifiedHostAlias", specCorpusKey(t))
	})
}
