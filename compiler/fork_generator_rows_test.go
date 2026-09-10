package compiler

import (
	"encoding/json"
	"os"
	"testing"
)

func TestPinnedForkAuthoredGeneratorRows(t *testing.T) {
	data, err := os.ReadFile("generator-row-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		Prelude string
		Cases   []struct {
			Name, Source, Expected string
			Code, MessageContains  string
			Refuse                 bool
		}
	}
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	backend, ctx := newPinnedTestBackend(t)
	for _, vector := range vectors.Cases {
		t.Run(vector.Name, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: vectors.Prelude + vector.Source}},
			})
			if err != nil {
				t.Fatal(err)
			}
			if vector.Refuse {
				code, message := vector.Code, vector.MessageContains
				if code == "" {
					code, message = "VIBE1106", "generator"
				}
				requireCode(t, result, code, message)
				if !result.EmitSkipped || len(result.Artifacts) != 0 {
					t.Fatal("a refused authored generator emitted artifacts")
				}
			} else {
				requireClean(t, result)
				if actual := runComptimeProgram(t, result); actual != vector.Expected {
					t.Fatalf("empty-row generator computed %q, expected %q", actual, vector.Expected)
				}
			}
		})
	}
}
