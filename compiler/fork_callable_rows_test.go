package compiler

import (
	"encoding/json"
	"os"
	"testing"
)

func TestPinnedForkCallableRequirementAssignments(t *testing.T) {
	data, err := os.ReadFile("callable-row-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Head  string
		Cases []struct {
			Name, Body string
			Accepted   bool
		}
	}
	if err := json.Unmarshal(data, &corpus); err != nil {
		t.Fatal(err)
	}
	if len(corpus.Cases) < 40 {
		t.Fatal("callable-row matrix is incomplete")
	}
	for _, vector := range corpus.Cases {
		t.Run(vector.Name, func(t *testing.T) {
			result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: corpus.Head + vector.Body}})
			if vector.Accepted {
				if len(result.Diagnostics) != 0 {
					t.Fatalf("row-preserving value refused: %v", ambientChargeMessages(result))
				}
			} else {
				found := false
				for _, diagnostic := range result.Diagnostics {
					if diagnostic.Code == "VIBE1808" {
						found = true
					}
				}
				if !found {
					t.Fatalf("requirement erasure accepted: %v", ambientChargeMessages(result))
				}
			}
		})
	}
}
