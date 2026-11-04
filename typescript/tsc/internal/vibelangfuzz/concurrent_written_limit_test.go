package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

func TestConcurrentWrittenLimitQuoted(t *testing.T) {
	text, err := vipText(19)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, c := range vipgen.Constructs() {
		if !strings.HasPrefix(c.Key, "vip19.written-limit-") {
			continue
		}
		count++
		for _, cite := range c.Citations {
			if !strings.Contains(text, cite.Quote) {
				t.Fatalf("%s: stale VIP-19 quote %q", c.Key, cite.Quote)
			}
		}
	}
	if count != 12 {
		t.Fatalf("expected twelve written-limit neighbourhoods, got %d", count)
	}
}

// Exercise the registered VIP generator and existing differential oracle,
// retaining omitted, numeric and sentinel controls alongside unchecked limits.
func TestConcurrentWrittenLimitVariants(t *testing.T) {
	env := newVIPEnv(t)
	count := 0
	for _, mode := range []string{"undefined", "null", "void", "held-undefined", "held-null", "factory-undefined", "factory-null", "grouped-undefined", "shadow-undefined", "one", "unbounded", "omitted"} {
		for items := byte(0); items < 3; items++ {
			for continued := byte(0); continued < 2; continued++ {
				count++
				t.Run(fmt.Sprintf("%s/items%d/continue%d", mode, items+2, continued), func(t *testing.T) {
					input := append(vipgen.Seed("vip19.written-limit-"+mode), 0, 0, 0, items, continued)
					p := vipgen.Generate(input, nil)
					if p == nil {
						t.Fatal("named written-limit seed was not generated")
					}
					source := vipgen.PrintVibe(p)
					rows := "[1,2]"
					if items == 1 {
						rows = "[1,2,3]"
					} else if items == 2 {
						rows = "[1,2,3,4]"
					}
					if !strings.Contains(source, rows) {
						t.Fatalf("seed lost item-count neighbourhood %s:\n%s", rows, source)
					}
					if continued != 0 && !strings.Contains(source, "if (item === 2) continue") {
						t.Fatalf("seed lost its item continue:\n%s", source)
					}
					run := env.run(t, p)
					if failures := run.failures(); len(failures) != 0 {
						t.Fatalf("written limit differs from native Effect.forEach: %v", failures)
					}
				})
			}
		}
	}
	if count != 72 {
		t.Fatalf("expected 72 written-limit neighbourhoods, got %d", count)
	}
}
