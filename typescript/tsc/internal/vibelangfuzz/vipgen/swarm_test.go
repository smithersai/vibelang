package vipgen

import (
	"fmt"
	"slices"
	"testing"
)

// Synthetic constructs isolate input decoding from language generation. Every
// pair must be independently selectable unless one explicitly requires the other.
func TestSwarmSelection(t *testing.T) {
	saved := registry
	t.Cleanup(func() { registry = saved })
	registry = nil
	var selected []string
	for i := range 350 {
		c := &Construct{Key: fmt.Sprintf("vip99.swarm-%03d", i), Plain: true}
		c.Focus = func(g *Gen, _ *Scope) []Stmt {
			selected = nil
			for _, on := range g.on {
				selected = append(selected, on.Key)
			}
			return nil
		}
		Register(c)
	}
	// This is the old two-byte mask's aliasing witness.
	legacy := append(Seed(registry[0].Key), 8, 0)
	Generate(legacy, nil)
	t.Logf("legacy bit 3 selects constructs 3 and 19: %t, %t", slices.Contains(selected, registry[3].Key), slices.Contains(selected, registry[19].Key))
	for focus := range registry {
		data := append([]byte("swarm:"), byte(focus), byte(focus>>8))
		p := Generate(data, nil)
		if p == nil || p.Focus != registry[focus].Key {
			t.Fatalf("two-byte focus %d is unreachable: %+v", focus, p)
		}
	}
	for i, c := range registry {
		data := append([]byte("swarm:key:"+registry[0].Key+"\x00"), make([]byte, MaskBytes(len(registry)))...)
		data[len(data)-MaskBytes(len(registry))+i/8] = 1 << uint(i%8)
		Generate(data, nil)
		want := []string{registry[0].Key}
		if i != 0 {
			want = append(want, c.Key)
		}
		if !slices.Equal(selected, want) {
			t.Fatalf("bit %d selected %v; want %v", i, selected, want)
		}
	}
}

func TestSwarmLeavesPendingOut(t *testing.T) {
	leave := map[string]bool{}
	for _, c := range Constructs() {
		leave[c.Key] = true
	}
	if p := Generate([]byte("swarm:\x00\x00"), leave); p != nil {
		t.Fatal("generated a pending construct")
	}
	if p := Generate([]byte("swarm:key:vip99.missing\x00"), nil); p != nil {
		t.Fatal("unknown named swarm focus generated a program")
	}
}

func TestLegacySingleConstructChoices(t *testing.T) {
	saved := registry
	t.Cleanup(func() { registry = saved })
	registry = []*Construct{{Key: "vip99.only", Plain: true}}
	registry[0].Focus = func(g *Gen, _ *Scope) []Stmt {
		if got := g.c.byte(); got != 7 {
			t.Fatalf("legacy focus consumed a choice with only one construct: %d", got)
		}
		return nil
	}
	Generate([]byte{0, 0, 7}, nil)
}

func TestSwarmRefocus(t *testing.T) {
	key := "vip01.object-member-key"
	tail := []byte{8, 0, 0, 1, 7}
	for _, seed := range [][]byte{IndexSeed(300), SwarmSeed("vip01.effect-function")} {
		input := append(slices.Clone(seed), tail...)
		got := Refocus(input, key)
		want := append(SwarmSeed(key), tail...)
		if !slices.Equal(got, want) {
			t.Fatalf("refocusing changed wide mask bytes: %v; want %v", got, want)
		}
		name, rest, ok := NamedInput(got)
		if !ok || name != key || !slices.Equal(rest, tail) {
			t.Fatal("versioned named input did not round trip")
		}
	}
}
