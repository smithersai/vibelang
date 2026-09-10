package compiler

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestPinnedForkDateDeterminismAcrossHostZones(t *testing.T) {
	data, err := os.ReadFile("date-determinism-vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Cases []struct {
			Name   string
			Body   string
			Output []string
		}
	}
	if err := json.Unmarshal(data, &corpus); err != nil {
		t.Fatal(err)
	}
	if len(corpus.Cases) < 20 {
		t.Fatal("Date determinism matrix is incomplete")
	}
	for _, vector := range corpus.Cases {
		t.Run(vector.Name, func(t *testing.T) {
			result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang,
				Text: "export function main(): string[] { " + vector.Body + " }"}})
			if vector.Output == nil {
				if len(result.Diagnostics) != 1 || result.Diagnostics[0].Code != "VIBE1602" {
					t.Fatalf("want exactly the Clock diagnostic, got %v", ambientChargeMessages(result))
				}
				return
			}
			if len(result.Diagnostics) != 0 {
				t.Fatalf("absolute operation refused: %v", ambientChargeMessages(result))
			}
			for _, zone := range []string{"UTC", "America/Los_Angeles", "Asia/Kathmandu"} {
				t.Setenv("TZ", zone)
				if got := runEmittedMain(t, result); got != strings.Join(vector.Output, "\n") {
					t.Fatalf("%s: got %q, want %v", zone, got, vector.Output)
				}
			}
		})
	}
}
