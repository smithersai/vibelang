package compiler

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestPinnedForkResultFrameElision(t *testing.T) {
	data, err := os.ReadFile("result-frame-elision-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		Prelude string
		Cases   []struct {
			Name, Source, Expected, Refuse, GoRefuse string
			GoDelimiter                              bool
			Foreign                                  bool
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
				Options: Options{"lib": []string{"es2022", "dom", "esnext.disposable"}},
				Files:   []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: vectors.Prelude + vector.Source}},
			})
			if err != nil {
				t.Fatal(err)
			}
			if vector.Refuse != "" {
				code := vector.Refuse
				if vector.GoRefuse != "" {
					code = vector.GoRefuse
				}
				requireCode(t, result, code, "")
				if !result.EmitSkipped || len(result.Artifacts) != 0 {
					t.Fatal("invalid success emitted artifacts")
				}
				return
			}
			requireClean(t, result)
			code := artifactTextsByPath(t, result.Artifacts)["main.js"]
			hasDelimiter := strings.Contains(code, "__vibelangRunResult(") || strings.Contains(code, "__vibelangRunResultAsync(")
			if hasDelimiter != vector.GoDelimiter {
				t.Fatalf("delimiter = %v, want %v:\n%s", hasDelimiter, vector.GoDelimiter, code)
			}
			observation := "import { main as observe } from './main.js'; const answer = await observe(); export function main() { return answer; }"
			if vector.Foreign {
				// This unchecked host deliberately violates the parameter contract.
				observation = `import * as program from './main.js'; let answer;
try { answer = String((await program.main()).unwrapOr(0)); }
catch (error) { answer = error instanceof Error ? error.message : 'not-error'; }
if (program.trace) answer += ',' + program.trace();
export function main() { return answer; }`
			}
			result.Artifacts = append(result.Artifacts, Artifact{Path: "frame-observation.js", Content: []byte(observation)})
			if actual := runComptimeProgramNamed(t, result, "frame-observation.vibe"); actual != vector.Expected {
				t.Fatalf("computed %q, expected %q", actual, vector.Expected)
			}
		})
	}
}
