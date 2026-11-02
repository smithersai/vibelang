package vipgen

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Check the named corpus selects each operand and initialization position;
// mutation adds arbitrary lexical-arrow depth and generic surrounding code.
func TestDoThisCorpusCoversPlacements(t *testing.T) {
	patterns := []string{
		"const value = [this,",
		"take(this,",
		"const value = this[",
		"this.x =",
		"this[",
	}
	for shape, name := range []string{"array", "call", "element", "property-assign", "element-assign"} {
		for _, phase := range []string{"before-super", "after-super", "method"} {
			t.Run(name+"/"+phase, func(t *testing.T) {
				path := filepath.Join("..", "testdata", "fuzz", "FuzzVIPDifferential", fmt.Sprintf("do-this-%s-%s", name, phase))
				data, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				lines := strings.SplitN(strings.TrimSpace(string(data)), "\n", 2)
				if len(lines) != 2 {
					t.Fatal("invalid fuzz corpus")
				}
				input, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(lines[1], "[]byte("), ")"))
				if err != nil {
					t.Fatal(err)
				}
				program := Generate([]byte(input), nil)
				if program == nil || program.Focus != "vip02.do-this-initialization-plain" {
					t.Fatal("corpus no longer selects this initialization")
				}
				vibe, native := PrintVibe(program), PrintEffect(program)
				for _, source := range []string{vibe, native} {
					if !strings.Contains(source, patterns[shape]) {
						t.Fatalf("missing operand %q in %s", patterns[shape], source)
					}
					if strings.Contains(source, "run(): void") != (phase == "method") {
						t.Fatalf("incorrect method placement: %s", source)
					}
				}
				if !strings.Contains(vibe, "do { events.push(\"do\");") || strings.Contains(native, "do {") {
					t.Fatalf("missing do/IIFE twins:\n%s\n%s", vibe, native)
				}
				if phase == "before-super" {
					if strings.Index(vibe, "do {") > strings.Index(vibe, "super();") || !strings.Contains(vibe, "((): void => { "+patterns[shape]) {
						t.Fatalf("early read lost lexical arrow or later super: %s", vibe)
					}
				} else if !strings.Contains(vibe, "events.push(\"enter\"); super();") {
					t.Fatalf("missing earlier super: %s", vibe)
				}
			})
		}
	}
}
