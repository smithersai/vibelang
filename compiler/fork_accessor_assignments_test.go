package compiler

import (
	_ "embed"
	"encoding/json"
	"testing"
)

//go:embed accessor-assignment-vectors.json
var accessorAssignmentVectors []byte

func TestPinnedForkAccessorAssignments(t *testing.T) {
	var corpus struct {
		Head  string
		Cases []struct {
			Name, Body, Code string
			Accepted         bool
			Count            int
		}
	}
	if err := json.Unmarshal(accessorAssignmentVectors, &corpus); err != nil {
		t.Fatal(err)
	}
	if len(corpus.Cases) < 38 {
		t.Fatal("incomplete accessor assignment matrix")
	}
	backend, ctx := newPinnedTestBackend(t)
	for _, vector := range corpus.Cases {
		t.Run(vector.Name, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files:   []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: corpus.Head + vector.Body}},
				Options: Options{"declaration": true},
			})
			if err != nil {
				t.Fatal(err)
			}
			if vector.Accepted {
				if len(result.Diagnostics) != 0 {
					t.Fatalf("row-preserving accessor refused: %v", ambientChargeMessages(result))
				}
			} else {
				code := vector.Code
				if code == "" {
					code = "VIBE1808"
				}
				found := false
				count := 0
				for _, diagnostic := range result.Diagnostics {
					if diagnostic.Code == code {
						found = true
						count++
					}
				}
				if !found {
					t.Fatalf("accessor row erasure accepted: %v", ambientChargeMessages(result))
				}
				if vector.Count != 0 && count != vector.Count {
					t.Fatalf("expected %d %s diagnostics, got %d: %v", vector.Count, code, count, ambientChargeMessages(result))
				}
			}
		})
	}
}

func TestPinnedForkPublishedAccessorAssignments(t *testing.T) {
	var corpus struct {
		Published struct {
			Source string
			Cases  []struct {
				Name, Body string
				Accepted   bool
			}
		}
	}
	if err := json.Unmarshal(accessorAssignmentVectors, &corpus); err != nil {
		t.Fatal(err)
	}
	backend, ctx := newPinnedTestBackend(t)
	producer := compilePublishedLibrary(t, backend, ctx, corpus.Published.Source, false)
	for _, vector := range corpus.Published.Cases {
		t.Run(vector.Name, func(t *testing.T) {
			consumer := compilePublishedConsumer(t, backend, ctx, producer,
				"import * as lib from './library.vibe'; import { Layer } from 'vibelang/provider';\n"+vector.Body)
			if !vector.Accepted {
				requireCode(t, consumer, "VIBE1808", "C")
				if !consumer.EmitSkipped || len(consumer.Artifacts) != 0 {
					t.Fatal("erased accessor emitted code")
				}
			} else if got := runPublishedConsumer(t, producer, consumer); got != "7" {
				t.Fatalf("preserved getter computed %q", got)
			}
		})
	}
}
