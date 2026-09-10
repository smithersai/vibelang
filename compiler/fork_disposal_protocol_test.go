package compiler

import (
	"encoding/json"
	"os"
	"testing"
)

func TestPinnedForkDisposalProtocol(t *testing.T) {
	data, err := os.ReadFile("disposal-protocol-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		Prelude      string
		Foreign      string
		ForeignCases []struct{ Name, Source string }
		Cases        []struct {
			Name, Source   string
			Code, Expected *string
		}
	}
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	backend, ctx := newPinnedTestBackend(t)
	for _, vector := range vectors.Cases {
		t.Run(vector.Name, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"resource.vibe"}, Lowering: LoweringInternal,
				Options: Options{"lib": []string{"es2022", "dom", "esnext.disposable"}},
				Files:   []SourceFile{{Path: "resource.vibe", Kind: FileKindVibeLang, Text: vectors.Prelude + vector.Source}},
			})
			if err != nil {
				t.Fatal(err)
			}
			if vector.Code != nil {
				for _, diagnostic := range result.Diagnostics {
					if diagnostic.Code == *vector.Code {
						return
					}
				}
				t.Fatalf("missing disposal diagnostic %s: %v", *vector.Code, ambientChargeMessages(result))
			}
			requireClean(t, result)
			result.Artifacts = append(result.Artifacts, Artifact{Path: "observe-resource.js", Content: []byte(
				"import { main as observe } from './resource.js'; const answer = await observe(); export function main() { return answer; }")})
			if got := runComptimeProgramNamed(t, result, "observe-resource.vibe"); vector.Expected == nil || got != *vector.Expected {
				t.Fatalf("computed %q, expected %v", got, vector.Expected)
			}
		})
	}
	for _, vector := range vectors.ForeignCases {
		t.Run(vector.Name, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"resource.vibe"}, Lowering: LoweringInternal,
				Options: Options{"lib": []string{"es2022", "dom", "esnext.disposable"}},
				Files: []SourceFile{
					{Path: "resource.vibe", Kind: FileKindVibeLang, Text: vector.Source},
					{Path: "foreign.ts", Kind: FileKindTypeScript, Text: vectors.Foreign},
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			for _, diagnostic := range result.Diagnostics {
				if diagnostic.Code == "VIBE1506" {
					return
				}
			}
			t.Fatalf("missing foreign disposal diagnostic: %v", ambientChargeMessages(result))
		})
	}
}
