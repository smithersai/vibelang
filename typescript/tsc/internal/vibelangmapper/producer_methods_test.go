package vibelangmapper

import (
	"strings"
	"testing"
)

// VIP-21 selects producer semantics by the method's effect marker. The editor
// projection must agree with native emission while retaining member syntax and
// mappings; unmarked generators must keep their JavaScript protocol.
func TestProducerMethodProjection(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		producer     bool
	}{
		{"class", "class C { effect *values() { yield 1 } }", true},
		{"static-generic", "class C { public static effect *values<T>(n: T) { yield n } }", true},
		{"private", "class C { effect *#values() { yield 1 } }", true},
		{"object", "const c = { effect *values() { yield 1 } }", true},
		{"computed", "const key = 'values'; const c = { effect *[key]() { yield 1 } }", true},
		{"native-class", "class C { *values() { yield 1 } }", false},
		{"native-object", "const c = { *values() { yield 1 } }", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			projection := Project(tc.source, testContext)
			if len(projection.Diagnostics) != 0 {
				t.Fatalf("projection diagnostics: %v", projection.Diagnostics)
			}
			if strings.Contains(projection.Text, "$produce(") != tc.producer {
				t.Fatalf("producer=%t: %s", tc.producer, projection.Text)
			}
			assertParses(t, projection.Text)
			assertValidMap(t, projection, tc.source)
		})
	}
}
