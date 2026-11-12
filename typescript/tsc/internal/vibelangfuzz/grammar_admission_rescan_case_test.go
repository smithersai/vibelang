package vibelangfuzz

import (
	"os"
	"path/filepath"
	"testing"
)

// The compiler case effect-type-bang-rescan combines every punctuator chapter
// 001 rescans after an effect type's completing bang (`A!!= v`, `A!!== v`,
// `A!!=== v`, `(): A!!=> e`) with `!=` and `!==` kept as equality operators
// after a completed `!!`. The lab reads it only with the post-bang
// punctuators split and rejoined, so the whole program must derive and the
// oracle must report no gap for it.
func TestGrammarAdmissionRescannedCase(t *testing.T) {
	const name = "effect-type-bang-rescan/main.vibe"
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "vibelang", "cases", filepath.FromSlash(name)))
	if err != nil {
		t.Fatal(err)
	}
	source := string(data)
	if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
		t.Fatalf("%s: %s\nstop: %s", name, detail, grammarAdmissionStop(source))
	}
	w := NewWorkspace(t)
	checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
}
