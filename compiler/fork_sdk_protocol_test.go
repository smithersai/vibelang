package compiler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func TestForkSDKLoweringProtocol(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is Unix-only")
	}
	source := "// 😀\r\nexport const answer = 42;\n"
	request := LanguageLoweringRequest{
		Project:       LanguageAnalysisRequest{Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}}},
		RuntimeImport: "vibelang/runtime",
		Outputs:       []LanguageLoweringOutput{{Path: "main.vibe", SourceName: "authored/main.vibe", OutputFileName: "/output/main.ts"}},
	}
	valid := LanguageLoweringResult{OK: true,
		Analysis:    LanguageAnalysisResult{Checked: true, Diagnostics: []Diagnostic{}, Files: []AnalyzedFile{{Path: "main.vibe", Analyzed: true, Errors: []AnalyzedError{}, Functions: []AnalyzedFunction{}}}},
		Diagnostics: []Diagnostic{}, Files: []LanguageLoweredFile{{Path: "main.vibe", Text: source,
			SourceMap: fmt.Sprintf(`{"version":3,"file":"main.ts","sourceRoot":"","sources":["authored/main.vibe"],"sourcesContent":[%q],"names":[],"mappings":"AAAA;AACA"}`, source)}},
	}
	file := func(v map[string]any) map[string]any { return v["files"].([]any)[0].(map[string]any) }
	changeMap := func(change func(map[string]any)) func(map[string]any) {
		return func(v map[string]any) {
			var sourceMap map[string]any
			if err := json.Unmarshal([]byte(file(v)["sourceMap"].(string)), &sourceMap); err != nil {
				t.Fatal(err)
			}
			change(sourceMap)
			encoded, err := json.Marshal(sourceMap)
			if err != nil {
				t.Fatal(err)
			}
			file(v)["sourceMap"] = string(encoded)
		}
	}
	for _, tc := range []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"valid", nil},
		{"missing completion", func(v map[string]any) { delete(v, "ok") }},
		{"null completion", func(v map[string]any) { v["ok"] = nil }},
		{"unexplained refusal", func(v map[string]any) { v["ok"] = false }},
		{"unknown field", func(v map[string]any) { v["ast"] = map[string]any{} }},
		{"missing file", func(v map[string]any) { v["files"] = []any{} }},
		{"duplicate file", func(v map[string]any) { v["files"] = append(v["files"].([]any), file(v)) }},
		{"foreign file", func(v map[string]any) { file(v)["path"] = "other.vibe" }},
		{"missing text", func(v map[string]any) { delete(file(v), "text") }},
		{"null text", func(v map[string]any) { file(v)["text"] = nil }},
		{"empty generated source", func(v map[string]any) { file(v)["text"] = "" }},
		{"missing source map", func(v map[string]any) { delete(file(v), "sourceMap") }},
		{"unknown file field", func(v map[string]any) { file(v)["node"] = map[string]any{} }},
		{"missing sources content", changeMap(func(v map[string]any) { delete(v, "sourcesContent") })},
		{"null sources content", changeMap(func(v map[string]any) { v["sourcesContent"] = nil })},
		{"changed source content", changeMap(func(v map[string]any) { v["sourcesContent"] = []string{"wrong"} })},
		{"missing map file", changeMap(func(v map[string]any) { delete(v, "file") })},
		{"null map file", changeMap(func(v map[string]any) { v["file"] = nil })},
		{"wrong map output", changeMap(func(v map[string]any) { v["file"] = "other.ts" })},
		{"missing source root", changeMap(func(v map[string]any) { delete(v, "sourceRoot") })},
		{"null source root", changeMap(func(v map[string]any) { v["sourceRoot"] = nil })},
		{"missing names", changeMap(func(v map[string]any) { delete(v, "names") })},
		{"null names", changeMap(func(v map[string]any) { v["names"] = nil })},
		{"null name", changeMap(func(v map[string]any) { v["names"] = []any{nil} })},
		{"noncanonical source identity", changeMap(func(v map[string]any) { v["sources"] = []string{"authored/./main.vibe"} })},
		{"truncated VLQ", changeMap(func(v map[string]any) { v["mappings"] = "g" })},
		{"invalid field count", changeMap(func(v map[string]any) { v["mappings"] = "AA" })},
		{"wrong source index", changeMap(func(v map[string]any) { v["mappings"] = "ACAA" })},
		{"source line outside text", changeMap(func(v map[string]any) { v["mappings"] = "AAgBA" })},
		{"source column outside text", changeMap(func(v map[string]any) { v["mappings"] = "AAAgB" })},
		{"generated column outside text", changeMap(func(v map[string]any) { v["mappings"] = "gBAAA" })},
		{"invalid name index", changeMap(func(v map[string]any) { v["mappings"] = "AAAAA" })},
		{"analysis is not a proof", func(v map[string]any) { v["analysis"].(map[string]any)["checked"] = false }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			encoded, err := json.Marshal(valid)
			if err != nil {
				t.Fatal(err)
			}
			var value map[string]any
			if err := json.Unmarshal(encoded, &value); err != nil {
				t.Fatal(err)
			}
			if tc.mutate != nil {
				tc.mutate(value)
			}
			encoded, err = json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			wire := fmt.Sprintf(`{"apiVersion":%d,"compilerRevision":%q,"result":%s}`, APIVersion, PinnedTypeScriptRevision, encoded)
			executable := filepath.Join(t.TempDir(), "bridge")
			if err := os.WriteFile(executable, []byte("#!/bin/sh\nprintf '%s' '"+strings.ReplaceAll(wire, "'", "'\\''")+"'\n"), 0o755); err != nil {
				t.Fatal(err)
			}
			got, err := (&forkCompiler{executable: executable}).LowerLanguage(context.Background(), request)
			if tc.mutate == nil {
				if err != nil || !reflect.DeepEqual(got, valid) {
					t.Fatalf("%+v %v", got, err)
				}
			} else if !errors.Is(err, ErrForkProtocol) {
				t.Fatalf("accepted malformed SDK lowering: %+v %v", got, err)
			}
		})
	}
}
