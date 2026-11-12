package vibelangfuzz

import "testing"

// ECMAScript's HashbangComment (`#!` at the very start of a Script or Module,
// to the end of its line) is skipped by TypeScript's scanner: stock
// TypeScript 5.9.3 reports nothing for `#!00` or `#!/usr/bin/env node`
// followed by code, and TS18026 for `#!` anywhere else. Appendix A inherits
// it. The lab lexer skipped only `//` and `/* */` comments, so a Cases
// mutation that produced `#!00` read as an admission gap.
var grammarHashbangForms = []string{
	"#!00",
	"#!/usr/bin/env node\nexport const x = 1\n",
	"#! a comment with spaces and // slashes\nconst a = 1\n",
	"#!\nconst a = 1\n",
}

// A hashbang after code, a space, a line break or a comment is TS18026.
var grammarHashbangControls = []string{
	"const a = 1\n#!x\n",
	" #!x\nconst a = 1\n",
	"\n#!x\nconst a = 1\n",
	"// first\n#!x\n",
}

func TestGrammarAdmissionHashbangQuoted(t *testing.T) {
	chapterSays(t, grammarAppendix, "VibeLang's grammar is TypeScript's, plus four TC39 proposals and the productions below.")
}

func TestGrammarAdmissionHashbang(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	native := grammarBuildGrammar(&grammarAppendixData{file: "ts"})
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range grammarHashbangForms {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count == 0 {
			t.Errorf("hashbang comment has no derivation: %q", source)
		}
		if p := native.parse(grammarLexSource(source), mode, nil); p.count() == 0 {
			t.Errorf("native-only grammar lost the hashbang comment: %q", source)
		}
	}
	for _, source := range grammarHashbangControls {
		if r := lab.read(lab.g, grammarLexSource(source), mode); r.count != 0 {
			t.Errorf("a hashbang away from the start derives: %q", source)
		}
	}
}

func TestGrammarAdmissionHashbangRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarHashbangForms {
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("hashbang comment reads as an admission gap: %q", source)
		}
	}
	for _, source := range grammarHashbangControls {
		if !grammarArrowSafeSyntaxRejected(t, w, source) {
			t.Errorf("compiler admits a hashbang away from the start: %q", source)
		}
	}
}
