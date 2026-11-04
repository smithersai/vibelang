package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const pathServiceAdviceQuote = "A module is a namespace, not a service key"
const pathServiceLookupQuote = "There is no `Path.join(…)` shorthand for a service member; write `(try Path.Path).join(…)`."

func pathServiceAdviceQuoted(t testing.TB) {
	t.Helper()
	text := SpecText("005-services.md")
	for _, quote := range []string{pathServiceAdviceQuote, pathServiceLookupQuote} {
		if !strings.Contains(text, quote) {
			t.Fatalf("chapter 005 no longer says %q", quote)
		}
	}
}
func TestPathServiceAdviceQuoted(t *testing.T) { pathServiceAdviceQuoted(t) }
func FuzzPathServiceAdvice(f *testing.F) {
	startShortBudget(f)
	pathServiceAdviceQuoted(f)
	var rows []struct{ Key, Source, Advice string }
	data, err := os.ReadFile(filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/testdata/path-service-advice.json"))
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
	ambient := "declare var process:{cwd():string};declare var __dirname:string;declare var __filename:string;\ndeclare module \"node:path\" { export const basename: (...args:any[])=>unknown; export const dirname: (...args:any[])=>unknown; export const extname: (...args:any[])=>unknown; export const format: (...args:any[])=>unknown; export const isAbsolute: (...args:any[])=>unknown; export const join: (...args:any[])=>unknown; export const normalize: (...args:any[])=>unknown; export const parse: (...args:any[])=>unknown; export const relative: (...args:any[])=>unknown; export const resolve: (...args:any[])=>unknown; export const toNamespacedPath: (...args:any[])=>unknown; export const sep: string; }\ndeclare module \"path\" { export const basename: (...args:any[])=>unknown; export const dirname: (...args:any[])=>unknown; export const extname: (...args:any[])=>unknown; export const format: (...args:any[])=>unknown; export const isAbsolute: (...args:any[])=>unknown; export const join: (...args:any[])=>unknown; export const normalize: (...args:any[])=>unknown; export const parse: (...args:any[])=>unknown; export const relative: (...args:any[])=>unknown; export const resolve: (...args:any[])=>unknown; export const toNamespacedPath: (...args:any[])=>unknown; export const sep: string; }\ndeclare module \"node:path/posix\" { export const basename: (...args:any[])=>unknown; export const dirname: (...args:any[])=>unknown; export const extname: (...args:any[])=>unknown; export const format: (...args:any[])=>unknown; export const isAbsolute: (...args:any[])=>unknown; export const join: (...args:any[])=>unknown; export const normalize: (...args:any[])=>unknown; export const parse: (...args:any[])=>unknown; export const relative: (...args:any[])=>unknown; export const resolve: (...args:any[])=>unknown; export const toNamespacedPath: (...args:any[])=>unknown; export const sep: string; }\ndeclare module \"path/posix\" { export const basename: (...args:any[])=>unknown; export const dirname: (...args:any[])=>unknown; export const extname: (...args:any[])=>unknown; export const format: (...args:any[])=>unknown; export const isAbsolute: (...args:any[])=>unknown; export const join: (...args:any[])=>unknown; export const normalize: (...args:any[])=>unknown; export const parse: (...args:any[])=>unknown; export const relative: (...args:any[])=>unknown; export const resolve: (...args:any[])=>unknown; export const toNamespacedPath: (...args:any[])=>unknown; export const sep: string; }\ndeclare module \"node:path/win32\" { export const basename: (...args:any[])=>unknown; export const dirname: (...args:any[])=>unknown; export const extname: (...args:any[])=>unknown; export const format: (...args:any[])=>unknown; export const isAbsolute: (...args:any[])=>unknown; export const join: (...args:any[])=>unknown; export const normalize: (...args:any[])=>unknown; export const parse: (...args:any[])=>unknown; export const relative: (...args:any[])=>unknown; export const resolve: (...args:any[])=>unknown; export const toNamespacedPath: (...args:any[])=>unknown; export const sep: string; }\ndeclare module \"path/win32\" { export const basename: (...args:any[])=>unknown; export const dirname: (...args:any[])=>unknown; export const extname: (...args:any[])=>unknown; export const format: (...args:any[])=>unknown; export const isAbsolute: (...args:any[])=>unknown; export const join: (...args:any[])=>unknown; export const normalize: (...args:any[])=>unknown; export const parse: (...args:any[])=>unknown; export const relative: (...args:any[])=>unknown; export const resolve: (...args:any[])=>unknown; export const toNamespacedPath: (...args:any[])=>unknown; export const sep: string; }\ndeclare module \"node:url\" { export const fileURLToPath:(url:URL)=>string;export const pathToFileURL:(path:string)=>URL }\ndeclare module \"url\" { export const fileURLToPath:(url:URL)=>string;export const pathToFileURL:(path:string)=>URL }\n"
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		pathServiceAdviceQuoted(t)
		parts := strings.SplitN(string(data), "\x00", 2)
		index := slices.IndexFunc(rows, func(row struct{ Key, Source, Advice string }) bool { return row.Key == parts[0] })
		if index < 0 {
			index = len(data) % len(rows)
		}
		row := rows[index]
		source := row.Source
		if len(parts) > 1 && len(parts[1]) > 0 && parts[1][0]&1 != 0 {
			source = "// keep advice through import trivia\n" + strings.ReplaceAll(source, "Native", "Nâtive")
		}
		r, err := w.Compile(t.Context(), Project{Config: `{"compilerOptions":{"strict":true,"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","types":[],"skipLibCheck":true,"noEmit":true},"files":["main.vibe","node_modules/@types/node/index.d.ts"]}`, Files: map[string]string{"main.vibe": source, "node_modules/@types/node/index.d.ts": ambient, "node_modules/@types/node/package.json": `{"name":"@types/node","types":"index.d.ts"}`, "package.json": `{"type":"module"}`}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		count := 0
		for _, d := range r.Diagnostics {
			if d.Source() == "EK" && d.Code() == 4402 {
				count++
				if !strings.Contains(layerMergeAdviceText(d), row.Advice) {
					Gap(t, "FuzzPathServiceAdvice", row.Key, "%s: want %q, got %s", pathServiceAdviceQuote, row.Advice, layerMergeAdviceText(d))
					return
				}
			}
		}
		if count != 1 {
			Gap(t, "FuzzPathServiceAdvice", row.Key, "want one EK4402, got %d", count)
			return
		}
		ExpectPending(t, "FuzzPathServiceAdvice", row.Key)
		ExpectPending(t, "FuzzPathServiceAdvice", specCorpusKey(t))
	})
}
