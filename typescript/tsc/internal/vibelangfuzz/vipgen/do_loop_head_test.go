package vipgen

import (
	"bytes"
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
						if len(lines) != 2 {
							t.Fatal("invalid corpus: expected a header and a payload")
						}
						input, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(lines[1], "[]byte("), ")"))
						if err != nil {
							t.Fatal(err)
						}
						_, choices, named := NamedInput([]byte(input))
						wantChoices := []byte{0, 0, byte(kind), byte(declaration), byte(shape), byte(count), 1, 1}
						if !named || !bytes.Equal(choices, wantChoices) {
							t.Fatalf("corpus selectors got %v, want %v", choices, wantChoices)
						}
						p := Generate([]byte(input), nil)
						if p == nil || p.Focus != "vip02.do-loop-head-plain" || !p.Plain {
							t.Fatal("lost keyed plain probe")
						}
						source, reference := PrintVibe(p), PrintEffect(p)
						pattern := []string{"[x]", "x", "{ value: x }", "[[x]]", "[x, y]", "{ value: x = 4, other: y = 5 }"}[shape]
						head := "for (" + []string{"let ", "const ", "", ""}[declaration] + pattern + []string{" of ", " in "}[kind] + "do {"
						items := "([] as "
						if kind == 1 {
							items = map[int]string{0: "({})", 2: "({ a: 1, b: 2 })"}[count]
						} else if count == 2 {
							items = []string{"[[1], [2]]", "[1, 2]", "[{ value: 1 }, { value: 2 }]", "[[[1]], [[2]]]", "[[1, 3], [2, 4]]", "[{}, { value: 2, other: 3 }]"}[shape]
						}
						if !strings.Contains(source, "\n  "+items) {
							t.Fatalf("wrong loop input, want %q:\n%s", items, source)
						}
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
