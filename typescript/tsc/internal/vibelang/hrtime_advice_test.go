package vibelang

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestHrtimeAdvice(t *testing.T) {
	var rows []struct {
		Key, Source string
		Host, Tuple bool
	}
	data, err := os.ReadFile("../vibelangfuzz/testdata/hrtime-advice.json")
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
			files["/workspace/x/src/node_modules/@types/node/package.json"] = `{"name":"@types/node","types":"index.d.ts"}`
			files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ES2022","module":"NodeNext","types":[],"skipLibCheck":true,"noEmit":true},"files":["main.vibe","node_modules/@types/node/index.d.ts"]}`
			files["/workspace/x/src/node_modules/@types/node/index.d.ts"] = `declare namespace NodeJS { interface HRTime { (previous?:[number,number]):[number,number]; bigint():bigint } }
declare var process: {hrtime:NodeJS.HRTime};
declare module "process" {export const hrtime:NodeJS.HRTime}
declare module "node:process" {export const hrtime:NodeJS.HRTime}`
			count := 0
			for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
				if d.Code() != EK4402.Code {
					continue
				}
				count++
				text := diagnosticWithNotes(d)
				want := "try Clock.monotonicTimeNanos"
				if row.Tuple {
					want = "Duration.toHrTime(try Clock.monotonicTimeNanos)"
				}
				for _, part := range []string{want, "same clock", "origin"} {
					if !strings.Contains(text, part) {
						t.Errorf("missing %q in:\n%s", part, text)
					}
				}
				if !row.Tuple && strings.Contains(text, "Duration.toHrTime") {
					t.Errorf("bigint advice converts to a tuple:\n%s", text)
				}
			}
			if row.Host != (count > 0) {
				t.Fatalf("want host diagnostic presence %t, got %d", row.Host, count)
			}
		})
	}
}
