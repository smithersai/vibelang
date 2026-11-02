package vibelangfuzz

import (
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
	if count != 10 {
		t.Fatalf("expected ten keyed delegation neighbourhoods, got %d", count)
	}
}
