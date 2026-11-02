package vipgen

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestForOfHeadTDZDoCorpus(t *testing.T) {
	for kind := range 4 {
		for shape := range 7 {
			for _, count := range []int{0, 2} {
				name := fmt.Sprintf("for-of-head-tdz-do-%d-%d-%d", kind, shape, count)
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
					if p == nil || p.Focus != "vip31.for-of-head-tdz-plain" || !p.Plain {
						t.Fatal("lost keyed plain head TDZ probe")
					}
					source, reference := PrintVibe(p), PrintEffect(p)
					if !strings.Contains(source, " of do { items(") || !strings.Contains(reference, " of (() => items(") {
						t.Fatalf("lost do/native IIFE pair:\n%s\n%s", source, reference)
					}
					for _, needle := range []string{"observe(\"rhs\"", "observe(\"iterator\"", "observe(\"body\"", "observe(\"after\"", "observe(\"mutated\"", "cells.map"} {
						if !strings.Contains(source, needle) {
							t.Fatalf("lost %s: %s", needle, source)
						}
					}
				})
			}
		}
	}
}
