package compiler

import (
	"encoding/json"
	"os"
	"testing"
)

func TestPinnedForkComptimeAllocationIdentity(t *testing.T) {
	data, err := os.ReadFile("comptime-identity-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Cases []struct{ Name, Body, Observe, Expected string }
	}
	if err := json.Unmarshal(data, &corpus); err != nil {
		t.Fatal(err)
	}
	backend, ctx := newPinnedTestBackend(t)
	for _, vector := range corpus.Cases {
		t.Run(vector.Name, func(t *testing.T) {
			source := "import { comptime } from 'vibelang:comptime';\nconst value = comptime(() => { " + vector.Body + " })();\nexport function main(): string { return " + vector.Observe + "; }"
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}},
			})
			if err != nil {
				t.Fatal(err)
			}
			requireClean(t, result)
			if actual := runComptimeProgram(t, result); actual != vector.Expected {
				t.Fatalf("compile/runtime mismatch: got %q, expected %q", actual, vector.Expected)
			}
		})
	}
}

func TestPinnedForkComptimeDataGraphBounds(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, probe := range []struct{ name, body, code string }{
		{"cyclic output", "const value: any[] = []; value.push(value); return value;", "VIBE1905"},
		{"cyclic stringify", "const value: any[] = []; value.push(value); return JSON.stringify(value);", "VIBE1905"},
		{"exponentially expanding value", "let value: any = null; for (let i = 0; i < 20; i++) value = [value, value]; return value;", "VIBE1912"},
	} {
		t.Run(probe.name, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: "import { comptime } from 'vibelang:comptime'; export const value = comptime(() => { " + probe.body + " })();"}},
			})
			if err != nil {
				t.Fatal(err)
			}
			requireCode(t, result, probe.code, "")
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatal("an invalid data graph emitted artifacts")
			}
		})
	}
}
