package vibelang

import (
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
)

func TestFileSystemServiceAdvice(t *testing.T) {
	var rows []struct{ Key, Source, Advice string }
	data, err := os.ReadFile("../vibelangfuzz/testdata/file-system-service-advice.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	ambient := ""
	for _, module := range []string{"node:fs", "fs"} {
		ambient += "declare module " + strconv.Quote(module) + " { "
		for _, name := range []string{"readFile", "writeFile", "mkdir", "stat", "createReadStream", "createWriteStream", "watch", "glob"} {
			ambient += "export const " + name + ": (...args:any[])=>unknown; "
		}
		ambient += "}\n"
	}
	for _, row := range rows {
		t.Run(row.Key, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = row.Source
			files["/workspace/x/src/node.d.ts"] = ambient
			files["/workspace/x/src/tsconfig.json"] = strings.Replace(files["/workspace/x/src/tsconfig.json"], `"files":["main.vibe"]`, `"files":["main.vibe","node.d.ts"]`, 1)
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
