package compiler

import (
	"encoding/json"
	"os"
	"slices"
	"testing"
)

func TestPinnedForkOwnershipFlow(t *testing.T) {
	data, err := os.ReadFile("ownership-flow-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Head  string
		Cases []struct {
			Name, Body string
			Code       *string
			Codes      []string
		}
	}
	if err := json.Unmarshal(data, &corpus); err != nil {
		t.Fatal(err)
	}
	if len(corpus.Cases) < 45 {
		t.Fatal("ownership-flow matrix is incomplete")
	}
	for _, vector := range corpus.Cases {
		t.Run(vector.Name, func(t *testing.T) {
			result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: corpus.Head + vector.Body}})
			if vector.Codes != nil {
				var actual []string
				for _, diagnostic := range result.Diagnostics {
					actual = append(actual, diagnostic.Code)
				}
				slices.Sort(actual)
				slices.Sort(vector.Codes)
				if !slices.Equal(actual, vector.Codes) {
					t.Fatalf("wrong diagnostic cascade: got %v, want %v", actual, vector.Codes)
				}
				return
			}
			if vector.Code == nil {
				if len(result.Diagnostics) != 0 {
					t.Fatalf("consumed value refused: %v", ambientChargeMessages(result))
				}
			} else {
				found := false
				for _, diagnostic := range result.Diagnostics {
					if diagnostic.Code == *vector.Code {
						found = true
					}
				}
				if !found {
					t.Fatalf("lost ownership accepted (want %s): %v", *vector.Code, ambientChargeMessages(result))
				}
			}
		})
	}
}
