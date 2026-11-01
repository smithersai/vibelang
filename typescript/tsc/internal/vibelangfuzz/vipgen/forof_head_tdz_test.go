package vipgen

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestForOfHeadTDZCorpus(t *testing.T) {
	for kind, k := range []string{"let", "const", "var", "assignment"} {
		for shape, name := range []string{"array", "simple", "object", "nested", "multiple", "array-default", "object-default"} {
			for _, count := range []int{0, 2} {
				t.Run(fmt.Sprintf("%s-%s-%d", k, name, count), func(t *testing.T) {
					file := filepath.Join("..", "testdata", "fuzz", "FuzzVIPDifferential", fmt.Sprintf("for-of-head-tdz-%s-%s-%d", k, name, count))
					data, err := os.ReadFile(file)
					if err != nil {
						t.Fatal(err)
					}
					lines := strings.Split(strings.TrimSpace(string(data)), "\n")
					if len(lines) != 2 {
						t.Fatal("invalid corpus")
					}
					input, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(lines[1], "[]byte("), ")"))
					if err != nil {
						t.Fatal(err)
					}
					p := Generate([]byte(input), nil)
					if p == nil || p.Focus != "vip31.for-of-head-tdz-plain" {
						t.Fatal("wrong corpus key")
					}
					v, e := PrintVibe(p), PrintEffect(p)
					head := []string{"[x]", "x", "{x}", "{pair:[x]}", "[x,y]", "[x=10]", "{x=10}"}[shape]
					decl := k + " "
					if kind == 3 {
						decl = ""
					}
					callback := "():number=>x"
					if kind == 0 && shape == 1 {
						callback = "():number=>{x=5;return x}"
					}
					for _, snippet := range []string{
						"for (" + decl + head + " of items(" + callback + "))",
						fmt.Sprintf("index++<%d", count),
						"value:" + []string{"[index]", "index", "{x:index}", "{pair:[index]}", "[index,index+10]", "[index%2===1?undefined:index]", "{x:index%2===1?undefined:index}"}[shape],
						"observe(\"rhs\",f)", "observe(\"iterator\",f)",
						"observe(\"next\"+index,f)", "observe(\"body\",read)",
						"observe(\"close\",f)", "observe(\"after\",read)",
						"observe(\"mutated\",read)", "cells.push(():number=>x)",
					} {
						if !strings.Contains(v, snippet) {
							t.Fatalf("missing %q:\n%s", snippet, v)
						}
					}
					if !p.Plain {
						t.Fatal("loop probe must stay plain")
					}
					for _, source := range []string{v, e} {
						if !strings.Contains(source, "return Effect.suspend(") || !strings.Contains(source, "ev(\"head-tdz:\"+tdzProbe") {
							t.Fatal("both twins must run and report the probe")
						}
					}
					if !strings.Contains(e, "transpileModule(`") || !strings.Contains(e, "createRequire(") {
						t.Fatal("reference must use stock TypeScript")
					}
					// TestVIPTemplatesCited tokenizes the reference print, so
					// the stock twin must hold the loop head as written.
					if !strings.Contains(e, "\n"+"for ("+decl+head+" of items("+callback+"))") {
						t.Fatalf("reference must hold the loop head verbatim:\n%s", e)
					}
					if !strings.Contains(e, "createRequire(") {
						t.Fatal("reference must use stock TypeScript")
					}
				})
			}
		}
	}
}
