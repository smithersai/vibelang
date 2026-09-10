package compiler

import (
	"encoding/json"
	"os"
	"testing"
)

func TestPinnedForkCallableCompletionAssignments(t *testing.T) {
	data, err := os.ReadFile("callable-completion-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Head  string
		Cases []struct{ Name, Body, Code string }
	}
	if err := json.Unmarshal(data, &corpus); err != nil {
		t.Fatal(err)
	}
	if len(corpus.Cases) < 28 {
		t.Fatal("callable-completion matrix is incomplete")
	}
	for _, vector := range corpus.Cases {
		t.Run(vector.Name, func(t *testing.T) {
			result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: corpus.Head + vector.Body}})
			if vector.Code == "" {
				if len(result.Diagnostics) != 0 {
					t.Fatalf("completion-preserving value refused: %v", ambientChargeMessages(result))
				}
				return
			}
			for _, diagnostic := range result.Diagnostics {
				if diagnostic.Code == vector.Code {
					return
				}
			}
			t.Fatalf("completion erasure accepted (want %s): %v", vector.Code, ambientChargeMessages(result))
		})
	}
}
