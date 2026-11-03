package ls

import (
	"slices"
	"testing"
)

func TestCodeFixCodes(t *testing.T) {
	const source = "inventory-test"
	RegisterCodeFixProvider(&CodeFixProvider{Source: source, ErrorCodes: []int32{9, 3, 9}})
	RegisterCodeFixProvider(&CodeFixProvider{Source: source, ErrorCodes: []int32{1, 3}})
	got := CodeFixCodes(source)
	if !slices.Equal(got, []int32{1, 3, 9}) {
		t.Fatalf("inventory = %v", got)
	}
	got[0] = 999
	if !slices.Equal(CodeFixCodes(source), []int32{1, 3, 9}) {
		t.Fatal("caller changed the registered inventory")
	}
	if len(CodeFixCodes("unregistered-inventory-source")) != 0 {
		t.Fatal("inventory crossed diagnostic sources")
	}
}
