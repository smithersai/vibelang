package vibelangmapper

import "testing"

func TestRenderExecUnknownKindDoesNotPanic(t *testing.T) {
	t.Parallel()
	text, keep := renderExec(edit{kind: editKind(255)})
	if keep || text != "" {
		t.Fatalf("expected unknown editKind to return (\"\", false), got (%q, %v)", text, keep)
	}
}
