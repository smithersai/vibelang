package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

// Run the registered VIP differential probes through the shared comparison
// without pending masks. The normal fuzz target also owns their keyed corpus.
func TestTailNativeDelegationVIPCases(t *testing.T) {
	env := newVIPEnv(t)
	count := 0
	for _, c := range vipgen.Constructs() {
		if !strings.HasPrefix(c.Key, "vip05.tail-native-delegation-") {
			continue
		}
		count++
		t.Run(c.Key, func(t *testing.T) {
			p := vipgen.Probe(c.Key)
			run := env.run(t, p)
			if failures := run.failures(); len(failures) != 0 {
				t.Fatalf("native tail delegation differs: %v", failures)
			}
		})
	}
	if count != 13 {
		t.Fatalf("expected thirteen keyed delegation neighbourhoods, got %d", count)
	}
}

// Exercise the registered generator and existing VIP comparison. No second
// runtime oracle or pending exemption is introduced.
func TestTailNativeMessageVariants(t *testing.T) {
	env := newVIPEnv(t)
	count := 0
	modes := []string{"number", "undefined", "promise", "array", "return-generator", "yield-generator", "effect", "iterator-throw", "next-throw", "bad-result", "typed-number", "typed-undefined", "typed-promise"}
	for _, mode := range modes {
		for form := byte(0); form < 6; form++ {
			for tail := byte(0); tail < 5; tail++ {
				if tail > 0 && tail < 4 && mode != "number" && mode != "undefined" && mode != "promise" {
					continue
				}
				count++
				t.Run(fmt.Sprintf("%s/form%d/tail%d", mode, form, tail), func(t *testing.T) {
					input := append(vipgen.Seed("vip05.tail-native-delegation-"+mode), 0, 0, 0, tail, form)
					program := vipgen.Generate(input, nil)
					if program == nil {
						t.Fatal("named delegation seed was not generated")
					}
					source := vipgen.PrintVibe(program)
					if form == 4 && !strings.Contains(source, "= effect () =>") {
						t.Fatalf("seed lost its zero-argument arrow:\n%s", source)
					}
					if form == 5 && !strings.Contains(source, "= effect function inner()") {
						t.Fatalf("seed lost its zero-argument named expression:\n%s", source)
					}
					run := env.run(t, program)
					if failures := run.failures(); len(failures) != 0 {
						t.Fatalf("canonical native tail delegation differs: %v", failures)
					}
				})
			}
		}
	}
	if count != 210 {
		t.Fatalf("expected 210 distinct delegation neighborhoods, got %d", count)
	}
}
