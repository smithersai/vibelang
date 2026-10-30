package vibelang

import "testing"

func TestBugBashEmptyService(t *testing.T) {
	for _, source := range []string{
		"service Empty {}\nconst L = Layer.succeed(Empty, {})",
		"service Empty { static readonly key = \"empty\" }\nconst L = Layer.succeed(Empty, {})",
	} {
		p, file, _, _ := editorProgram(t, source)
		for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
			t.Errorf("unexpected diagnostic: %s", d.String())
		}
	}
	_, file, _, _ := editorProgram(t, "abstract class Empty {}")
	if got := classKindOf(file.Statements.Nodes[0]); got != ordinaryClass {
		t.Errorf("ordinary empty class classified as %v", got)
	}
}
