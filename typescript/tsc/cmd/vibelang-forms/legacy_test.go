package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Unlike the mapper snapshot, this golden checks today's real classifier on
// complete projects, including failing cases and extracted documentation.
func TestLegacyOracle(t *testing.T) {
	repo, err := findRepo()
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(filepath.Join(repo, "typescript/tsc/internal/vibelang/testdata/legacy_sites.txt"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := legacyOracle(repo, filepath.Join(repo, "docs/tools/node_modules"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		old, next := strings.Split(string(want), "\n"), strings.Split(string(got), "\n")
		for i := range min(len(old), len(next)) {
			if old[i] != next[i] {
				t.Fatalf("legacy oracle differs at line %d:\n- %s\n+ %s\nRegenerate with: %s", i+1, old[i], next[i], legacyCommand)
			}
		}
		t.Fatalf("legacy oracle has %d lines; want %d. Regenerate with: %s", len(next), len(old), legacyCommand)
	}
}
