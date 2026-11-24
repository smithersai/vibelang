package vibelangmapper

import "testing"

// TestEditKindNames requires every kind to have its own name (#518): a
// positional table panicked past its end and misnamed kinds added later.
func TestEditKindNames(t *testing.T) {
	seen := map[string]editKind{}
	for k := editSyntax; k < editKindCount; k++ {
		name, ok := editKindNames[k]
		if !ok {
			t.Errorf("kind %d has no name", k)
			continue
		}
		if other, dup := seen[name]; dup {
			t.Errorf("kinds %d and %d share the name %q", other, k, name)
		}
		seen[name] = k
		if k.String() != name {
			t.Errorf("kind %d String() = %q, want %q", k, k.String(), name)
		}
	}
	if len(editKindNames) != int(editKindCount) {
		t.Errorf("editKindNames has %d entries, want %d", len(editKindNames), editKindCount)
	}
	for k, want := range map[editKind]string{editSettledCall: "settled call", editRun: "run", editRegion: "region", editPatternFlow: "pattern flow"} {
		if got := k.String(); got != want {
			t.Errorf("kind %d String() = %q, want %q", k, got, want)
		}
	}
	if got := editKindCount.String(); got != "editKind(31)" {
		t.Errorf("an unknown kind prints %q", got)
	}
}
