package vibelang

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestPathServiceAdvice(t *testing.T) {
	var rows []struct{ Key, Source, Advice string }
	data, err := os.ReadFile("../vibelangfuzz/testdata/path-service-advice.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	ambient := "declare var process:{cwd():string};declare var __dirname:string;declare var __filename:string;\ndeclare module \"node:path\" { export const basename: (...args:any[])=>unknown; export const dirname: (...args:any[])=>unknown; export const extname: (...args:any[])=>unknown; export const format: (...args:any[])=>unknown; export const isAbsolute: (...args:any[])=>unknown; export const join: (...args:any[])=>unknown; export const normalize: (...args:any[])=>unknown; export const parse: (...args:any[])=>unknown; export const relative: (...args:any[])=>unknown; export const resolve: (...args:any[])=>unknown; export const toNamespacedPath: (...args:any[])=>unknown; export const sep: string; }\ndeclare module \"path\" { export const basename: (...args:any[])=>unknown; export const dirname: (...args:any[])=>unknown; export const extname: (...args:any[])=>unknown; export const format: (...args:any[])=>unknown; export const isAbsolute: (...args:any[])=>unknown; export const join: (...args:any[])=>unknown; export const normalize: (...args:any[])=>unknown; export const parse: (...args:any[])=>unknown; export const relative: (...args:any[])=>unknown; export const resolve: (...args:any[])=>unknown; export const toNamespacedPath: (...args:any[])=>unknown; export const sep: string; }\ndeclare module \"node:path/posix\" { export const basename: (...args:any[])=>unknown; export const dirname: (...args:any[])=>unknown; export const extname: (...args:any[])=>unknown; export const format: (...args:any[])=>unknown; export const isAbsolute: (...args:any[])=>unknown; export const join: (...args:any[])=>unknown; export const normalize: (...args:any[])=>unknown; export const parse: (...args:any[])=>unknown; export const relative: (...args:any[])=>unknown; export const resolve: (...args:any[])=>unknown; export const toNamespacedPath: (...args:any[])=>unknown; export const sep: string; }\ndeclare module \"path/posix\" { export const basename: (...args:any[])=>unknown; export const dirname: (...args:any[])=>unknown; export const extname: (...args:any[])=>unknown; export const format: (...args:any[])=>unknown; export const isAbsolute: (...args:any[])=>unknown; export const join: (...args:any[])=>unknown; export const normalize: (...args:any[])=>unknown; export const parse: (...args:any[])=>unknown; export const relative: (...args:any[])=>unknown; export const resolve: (...args:any[])=>unknown; export const toNamespacedPath: (...args:any[])=>unknown; export const sep: string; }\ndeclare module \"node:path/win32\" { export const basename: (...args:any[])=>unknown; export const dirname: (...args:any[])=>unknown; export const extname: (...args:any[])=>unknown; export const format: (...args:any[])=>unknown; export const isAbsolute: (...args:any[])=>unknown; export const join: (...args:any[])=>unknown; export const normalize: (...args:any[])=>unknown; export const parse: (...args:any[])=>unknown; export const relative: (...args:any[])=>unknown; export const resolve: (...args:any[])=>unknown; export const toNamespacedPath: (...args:any[])=>unknown; export const sep: string; }\ndeclare module \"path/win32\" { export const basename: (...args:any[])=>unknown; export const dirname: (...args:any[])=>unknown; export const extname: (...args:any[])=>unknown; export const format: (...args:any[])=>unknown; export const isAbsolute: (...args:any[])=>unknown; export const join: (...args:any[])=>unknown; export const normalize: (...args:any[])=>unknown; export const parse: (...args:any[])=>unknown; export const relative: (...args:any[])=>unknown; export const resolve: (...args:any[])=>unknown; export const toNamespacedPath: (...args:any[])=>unknown; export const sep: string; }\ndeclare module \"node:url\" { export const fileURLToPath:(url:URL)=>string;export const pathToFileURL:(path:string)=>URL }\ndeclare module \"url\" { export const fileURLToPath:(url:URL)=>string;export const pathToFileURL:(path:string)=>URL }\n"
	for _, row := range rows {
		t.Run(row.Key, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = row.Source
			files["/workspace/x/src/node_modules/@types/node/package.json"] = `{"name":"@types/node","types":"index.d.ts"}`
			files["/workspace/x/src/node_modules/@types/node/index.d.ts"] = ambient
			files["/workspace/x/src/tsconfig.json"] = strings.Replace(files["/workspace/x/src/tsconfig.json"], `"files":["main.vibe"]`, `"files":["main.vibe","node_modules/@types/node/index.d.ts"]`, 1)
			count := 0
			for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
				if d.Code() == EK4402.Code {
					count++
					if text := diagnosticWithNotes(d); !strings.Contains(text, row.Advice) {
						t.Errorf("chapter 005 requires the service key lookup; want %q in:\n%s", row.Advice, text)
					}
				}
			}
			if count != 1 {
				t.Fatalf("want exactly one platform diagnostic, got %d", count)
			}
		})
	}
}
