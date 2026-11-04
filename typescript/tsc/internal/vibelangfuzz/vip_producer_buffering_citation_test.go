package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

func TestVIPProducerBufferingQuoted(t *testing.T) {
	text, err := vipText(21)
	if err != nil {
		t.Fatal(err)
	}
	const sequential = "For one sequential emitter, the producer may run up to two elements ahead of the consumer: one in the buffer and one waiting to be offered."
	const concurrent = "With concurrent yields, each active item fiber can evaluate a value before waiting in "
	if !strings.Contains(text, sequential) || !strings.Contains(text, concurrent) {
		t.Fatal("missing sequential/concurrent producer buffering distinction")
	}
	c := vipgen.Lookup("vip21.producer")
	found := false
	for _, cite := range c.Citations {
		if strings.Contains(cite.Template, "bufferSize: 1") {
			found = true
			if cite.Quote != sequential {
				t.Fatalf("producer lead citation must retain its sequential-emitter qualification: %q", cite.Quote)
			}
		}
	}
	if !found {
		t.Fatal("missing producer buffer citation")
	}
}
