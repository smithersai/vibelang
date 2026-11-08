package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestAbstractErrorInheritanceRepairsQuoted(t *testing.T) {
	const quote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatal("preserving repair rule moved")
	}
	const inheritance = "| an `extends` clause, `error UserNotFound extends NotFound { … }`, in either error form | `EK2117` |"
	if !strings.Contains(SpecText("003-failures.md"), inheritance) {
		t.Fatal("inheritance rejection moved")
	}
}
