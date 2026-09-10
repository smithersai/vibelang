package compiler

import (
	"encoding/json"
	"strings"
	"testing"
)

// The registered-extension resolver owns the authored edge. Lowered checking,
// declarations and runnable output must retain that exact module identity.
func TestPinnedForkImplicitVibeLangModules(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ name, path, specifier string }{
		{"extensionless", "lib/value.vibe", "./lib/value"},
		{"output alias", "lib/value.vibe", "./lib/value.js"},
		{"directory index", "lib/value/index.vibe", "./lib/value"},
		{"normalized path", "lib/value.vibe", "./lib/../lib/value"},
		{"Unicode path", "lib/😀.vibe", "./lib/😀"},
		{"quote in path", "lib/quo\"te.vibe", "./lib/quo\"te"},
		{"explicit source", "lib/value.vibe", "./lib/value.vibe"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			literal, err := json.Marshal(tc.specifier)
			if err != nil {
				t.Fatal(err)
			}
			main := `// 😀` + "\n" + `import { value } from "./barrel"; export const answer = value + 1; export const label = ` + string(literal) + `;`
			files := []SourceFile{
				{Path: "main.vibe", Kind: FileKindVibeLang, Text: main},
				{Path: "barrel.vibe", Kind: FileKindVibeLang, Text: `export { value } from ` + string(literal) + `;`},
				{Path: tc.path, Kind: FileKindVibeLang, Text: `export const value = 41;`},
			}
			result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe", "barrel.vibe", tc.path}, Files: files, Lowering: LoweringInternal, Options: Options{"declaration": true, "declarationMap": true}})
			if err != nil || result.EmitSkipped || len(result.Diagnostics) != 0 {
				t.Fatalf("result=%+v err=%v", result, err)
			}
			texts := artifactTextsByPath(t, result.Artifacts)
			edges, err := backend.(SourceInspector).Inspect(ctx, InspectionRequest{Files: []InspectionSource{{Path: "barrel.js", Text: texts["barrel.js"], ScriptKind: "javascript"}}})
			if err != nil || len(edges.Files) != 1 || len(edges.Files[0].ModuleSyntax) != 1 || edges.Files[0].ModuleSyntax[0].Specifier == nil ||
				*edges.Files[0].ModuleSyntax[0].Specifier != "./"+strings.TrimSuffix(tc.path, ".vibe")+".js" {
				t.Fatalf("output lost the resolved target: %s; inspection=%+v err=%v", texts["barrel.js"], edges, err)
			}
			parsed, points := decodeEmittedMap(t, texts["main.js.map"])
			if len(parsed.SourcesContent) != 1 || *parsed.SourcesContent[0] != main {
				t.Fatalf("source map lost authored text: %+v", parsed)
			}
			generatedLine, generatedColumn := positionOf(t, texts["main.js"], "value + 1")
			authoredLine, authoredColumn := positionOf(t, main, "value + 1")
			if !hasMapping(points, generatedLine, generatedColumn, authoredLine, authoredColumn) {
				t.Fatal("module rewrite shifted the authored expression mapping")
			}
			observed := executeEmitted(t, result.Artifacts, `import { answer, label } from "./main.js"; console.log(JSON.stringify({answer, label}));`)
			expectObserved(t, observed, "answer", 42)
			expectObserved(t, observed, "label", tc.specifier)
		})
	}
	t.Run("import types retained in lifted function signatures", func(t *testing.T) {
		result, err := backend.Compile(ctx, CompileRequest{
			RootNames: []string{"main.vibe", "types/box.vibe"}, Lowering: LoweringInternal, Options: Options{"declaration": true},
			Files: []SourceFile{
				{Path: "main.vibe", Kind: FileKindVibeLang, Text: `export function work(box: import("./types/box").Box): Result<import("./types/box").Box, never> { return box; }`},
				{Path: "types/box.vibe", Kind: FileKindVibeLang, Text: `export interface Box { value: number }`},
			},
		})
		if err != nil || result.EmitSkipped || len(result.Diagnostics) != 0 {
			t.Fatalf("result=%+v err=%v", result, err)
		}
		observed := executeEmitted(t, result.Artifacts, `import { work } from "./main.js"; console.log(JSON.stringify({ answer: work({value:42}).value.value }));`)
		expectObserved(t, observed, "answer", 42)
	})
}
