package compiler

import (
	"encoding/json"
	"os"
	"testing"
)

func TestPinnedForkGeneratedNameHygiene(t *testing.T) {
	data, err := os.ReadFile("generated-name-hygiene-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		Prelude string
		Cases   []struct{ Name, Source, Expected string }
	}
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	backend, ctx := newPinnedTestBackend(t)
	for _, vector := range vectors.Cases {
		t.Run(vector.Name, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"names.vibe"}, Lowering: LoweringInternal,
				Files: []SourceFile{{Path: "names.vibe", Kind: FileKindVibeLang, Text: vectors.Prelude + vector.Source}},
			})
			if err != nil {
				t.Fatal(err)
			}
			requireClean(t, result)
			result.Artifacts = append(result.Artifacts, Artifact{Path: "observe-names.js", Content: []byte(
				"import { main as observe } from './names.js'; const answer = await observe(); export function main() { return answer; }")})
			if got := runComptimeProgramNamed(t, result, "observe-names.vibe"); got != vector.Expected {
				t.Fatalf("computed %q, expected %q", got, vector.Expected)
			}
		})
	}
}
