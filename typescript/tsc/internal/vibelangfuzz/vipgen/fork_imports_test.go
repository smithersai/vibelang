package vipgen

import (
	"regexp"
	"strings"
	"testing"
)

func TestForkProbeModuleBindings(t *testing.T) {
	imported := regexp.MustCompile("(?m)^import \\{[^}]*\\bDeferred\\b[^}]*\\} from \"effect\"")
	for _, key := range []string{"vip17.fork", "vip17.fork-in", "vip17.fork-scoped", "vip17.fork-detached", "vip17.fork-outlives-function", "vip17.join"} {
		t.Run(key, func(t *testing.T) {
			p := Probe(key)
			for name, source := range map[string]string{"vibe": PrintVibe(p), "effect": PrintEffect(p)} {
				if !strings.Contains(source, "Deferred.") {
					t.Fatalf("%s probe no longer exercises its handshake", name)
				}
				if !imported.MatchString(source) {
					t.Fatalf("%s uses Deferred without importing it:\n%s", name, source)
				}
			}
		})
	}
}
