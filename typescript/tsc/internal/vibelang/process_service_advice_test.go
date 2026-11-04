package vibelang

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestProcessServiceAdvice(t *testing.T) {
	var rows []struct{ Key, Source, Advice string }
	data, err := os.ReadFile("../vibelangfuzz/testdata/process-service-advice.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		t.Run(row.Key, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = row.Source
			files["/workspace/x/src/node.d.ts"] = "declare module \"node:os\" { export const hostname:any;export const availableParallelism:any;export const platform:any;export const arch:any; }declare module \"os\" { export const hostname:any;export const availableParallelism:any;export const platform:any;export const arch:any; }declare module \"node:process\" { export const pid:any;export const platform:any;export const arch:any;export const execPath:any;export const versions:any;export const version:any;export const memoryUsage:any;export const kill:any; }declare module \"process\" { export const pid:any;export const platform:any;export const arch:any;export const execPath:any;export const versions:any;export const version:any;export const memoryUsage:any;export const kill:any; }"
			files["/workspace/x/src/node_modules/@types/node/index.d.ts"] = "declare var process: {pid:any;platform:any;arch:any;execPath:any;versions:any;version:any;memoryUsage:any;kill:any;};"
			files["/workspace/x/src/node_modules/@types/node/package.json"] = `{"name":"@types/node","types":"index.d.ts"}`
			files["/workspace/x/src/tsconfig.json"] = "{\"compilerOptions\":{\"strict\":true,\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"types\":[],\"skipLibCheck\":true,\"noEmit\":true},\"files\":[\"main.vibe\",\"node.d.ts\",\"node_modules/@types/node/index.d.ts\"]}"
			count := 0
			for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
				if d.Code() != EK4402.Code {
					continue
				}
				count++
				if text := diagnosticWithNotes(d); !strings.Contains(text, row.Advice) {
					t.Errorf("VIP33 injected service advice: want %q in:\n%s", row.Advice, text)
				}
			}
			if count != 1 {
				t.Fatalf("want one platform diagnostic, got %d", count)
			}
		})
	}
}
