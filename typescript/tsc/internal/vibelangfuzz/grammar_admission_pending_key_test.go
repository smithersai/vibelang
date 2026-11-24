package vibelangfuzz

import "testing"

func TestGrammarAdmissionMutationDoesNotInheritPendingFamily(t *testing.T) {
	source := "effect function f() { const fiber = fork { return 1; }; const b = throw 1 + 1; }"
	const family = "admission:fork-block"
	if got := grammarAdmissionForm(source); got != family {
		t.Fatalf("control does not exercise the %s classifier: %s", family, got)
	}
	key := grammarAdmissionMutationKey(source)
	if got := grammarAdmissionOracleKey(key, source, false); got != key {
		t.Fatalf("mutation key %s was changed to %s", key, got)
	}
}
