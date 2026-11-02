package vipgen

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestDoLoopHeadCorpus(t *testing.T) {
	for kind := range 2 {
		for declaration := range 4 {
			for shape := range 6 {
				if kind == 1 && shape != 1 {
					continue
				}
				for _, count := range []int{0, 2} {
					name := fmt.Sprintf("do-loop-head-%d-%d-%d-%d", kind, declaration, shape, count)
					t.Run(name, func(t *testing.T) {
						data, err := os.ReadFile(filepath.Join("..", "testdata/fuzz/FuzzVIPDifferential", name))
						if err != nil {
							t.Fatal(err)
						}
						lines := strings.SplitN(strings.TrimSpace(string(data)), "\n", 2)
						input, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(lines[1], "[]byte("), ")"))
						if err != nil {
							t.Fatal(err)
						}
						p := Generate([]byte(input), nil)
						if p == nil || p.Focus != "vip02.do-loop-head-plain" || !p.Plain {
							t.Fatal("lost keyed plain probe")
						}
						source, reference := PrintVibe(p), PrintEffect(p)
						head := "for (" + []string{"let ", "const ", "", "var "}[declaration]
						if !strings.Contains(source, head) {
							t.Fatalf("lost declaration: %s", source)
						}
						for _, needle := range []string{"read === same", "observe(\"before\"", "observe(\"during\"", "observe(\"after\"", "observe(\"mutated\"", "cells.map", "local = () => x"} {
							if !strings.Contains(source, needle) {
								t.Fatalf("lost %s: %s", needle, source)
							}
						}
						if !strings.Contains(reference, "transpileModule") || strings.Contains(reference, " do {") || !strings.Contains(reference, "\n  return ") {
							t.Fatalf("reference lost native IIFE: %s", reference)
						}
					})
				}
			}
		}
	}
}
