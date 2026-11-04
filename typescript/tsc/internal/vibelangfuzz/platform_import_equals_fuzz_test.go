package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const nodeImportEqualsQuote = "a `.vibe` file has no `node:*` value imports"
const nodeImportEqualsTypeQuote = "except an `import type` or `export type … from` declaration"

const nodeImportEqualsHostQuote = "A global is banned when the symbol has a declaration in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, none in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist below."

func nodeImportEqualsQuoted(t testing.TB) {
	t.Helper()
	text := SpecText("005-services.md")
	for _, quote := range []string{nodeImportEqualsQuote, nodeImportEqualsTypeQuote, nodeImportEqualsHostQuote} {
		if !strings.Contains(text, quote) {
			t.Fatal(quote)
		}
	}
}
func TestNodeImportEqualsQuoted(t *testing.T) { nodeImportEqualsQuoted(t) }
func FuzzPlatformImportEquals(f *testing.F) {
	startShortBudget(f)
	nodeImportEqualsQuoted(f)
	var rows []struct {
		Key, Source, Mode string
		Errors            []string
	}
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/platform-import-equals.json"))
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
	ambient := ""
	for _, name := range []string{"node:fs", "fs", "node:fs/promises", "child_process", "node:test", "node:sqlite", "test", "fs-extra"} {
		ambient += fmt.Sprintf("declare module %q { export const marker:number }\n", name)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		nodeImportEqualsQuoted(t)
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
		host := "declare namespace HostRuntime { const value:number; namespace platform { const value:number } }\ndeclare namespace Bun { const value:number; namespace platform { const value:number } }\n"
		if len(parts) > 1 && len(parts[1]) > 0 && parts[1][0]&1 != 0 {
			source = "// keep import trivia\n" + strings.ReplaceAll(source, "Host", "Hôte")
			host = strings.ReplaceAll(host, "Host", "Hôte")
		}
		kind := "module"
		if row.Mode == "cjs" {
			kind = "commonjs"
		}
		r, err := w.Compile(t.Context(), Project{Config: `{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"noEmit":true},"files":["main.vibe","node.d.ts","node_modules/@types/node/index.d.ts"]}`, Files: map[string]string{"main.vibe": source, "node.d.ts": ambient, "node_modules/@types/node/package.json": `{"name":"@types/node","types":"index.d.ts"}`, "node_modules/@types/node/index.d.ts": host, "package.json": fmt.Sprintf(`{"type":%q}`, kind)}})
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
			Gap(t, "FuzzPlatformImportEquals", row.Key, "%s; expected %v, got %v", nodeImportEqualsQuote, row.Errors, codes)
			return
		}
		ExpectPending(t, "FuzzPlatformImportEquals", row.Key)
		ExpectPending(t, "FuzzPlatformImportEquals", specCorpusKey(t))
	})
}
