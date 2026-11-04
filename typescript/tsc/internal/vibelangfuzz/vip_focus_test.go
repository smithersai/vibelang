package vibelangfuzz

import (
	"bytes"
	"fmt"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

func validateVIPFocus(focus string, leaveOut map[string]bool) error {
	if focus == "" {
		return nil
	}
	if vipgen.Lookup(focus) == nil {
		return fmt.Errorf("unknown VIP focus %q", focus)
	}
	if !slices.ContainsFunc(vipgen.Enabled(leaveOut), func(c *vipgen.Construct) bool { return c.Key == focus }) {
		return fmt.Errorf("VIP focus %q or one of its dependencies is pending", focus)
	}
	return nil
}

func vipFocusedInput(data []byte, focus string) []byte {
	if focus == "" {
		return data
	}
	if _, rest, named := vipgen.NamedInput(data); named {
		data = rest
	}
	return append(vipgen.Seed(focus), data...)
}

func TestVIPFocusInput(t *testing.T) {
	focus := "vip01.object-member-key"
	tail := []byte{0xff, 0xff, 0, 3, 4, 5}
	for _, data := range [][]byte{tail, append(vipgen.Seed("vip01.effect-function"), tail...)} {
		saved := bytes.Clone(data)
		if got := vipFocusedInput(data, ""); !bytes.Equal(got, data) {
			t.Fatal("default input changed")
		}
		got := vipFocusedInput(data, focus)
		key, rest, named := vipgen.NamedInput(got)
		if !named || key != focus || !bytes.Equal(rest, tail) {
			t.Fatalf("focus or swarm tail changed: %q %v", key, rest)
		}
		if !bytes.Equal(data, saved) {
			t.Fatal("caller input mutated")
		}
		p := vipgen.Generate(got, nil)
		if p == nil || p.Focus != focus {
			t.Fatal("selected focus was not generated")
		}
	}
	mixed := false
	required := vipgen.Closure(focus)
	for seed := byte(0); seed < 64; seed++ {
		data := append([]byte{0xff, 0xff}, bytes.Repeat([]byte{seed}, 96)...)
		p := vipgen.Generate(vipFocusedInput(data, focus), nil)
		for _, key := range p.UsedKeys() {
			if !slices.Contains(required, key) {
				mixed = true
			}
		}
	}
	if !mixed {
		t.Fatal("focused campaign lost mixed constructs")
	}
}

func TestVIPFocusAvailability(t *testing.T) {
	if err := validateVIPFocus("", map[string]bool{"vip05.try": true}); err != nil {
		t.Fatal(err)
	}
	if err := validateVIPFocus("no-such-construct", nil); err == nil {
		t.Fatal("unknown focus accepted")
	}
	if err := validateVIPFocus("vip01.object-member-key", map[string]bool{"vip05.try": true}); err == nil {
		t.Fatal("pending dependency was enabled")
	}
	if err := validateVIPFocus("vip01.object-member-key", nil); err != nil {
		t.Fatal(err)
	}
}
