package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestGrammarAdmissionRegExpQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A TypeScript inheritance changed; review native RegExp lexical admission")
	}
}

var grammarRegExpSources = []string{
	"n = / 2 /\n2\n;",
	"n = / => 2 /\n2\n;",
	"n = / ?? 2 /\n2\n;",
	"const r = /a?/;",
	"const r = /a*/;",
	"const r = /a+/;",
	"const r = /a??/;",
	"const r = /a*?/;",
	"const r = /a+?/;",
	"const r = /a?b*/;",
	"const r = /a*b+c?d/;",
	"const r = /a*?/u;",
	"const r = /a+?/v;",
	"const r = /a?b/;",
	"const r = /a=>b/;",
	"const r = /a<=>b/;",
	"const r = /a!%&,:;@#~-b/;",
	"const r = /a=>b/u;",
	"const r = /a=>b/v;",
	"const r = /a/;",
	"const r = /abc123/gi;",
	"const r = /a b/m;",
	"const r = /word/u;",
	"const r = /abc/gy;",
	"const r = [/a/, /b/];",
	"function f() { return /a/; }",
	"const b = /a/.test(\"a\");",
	"const r = ok ? /a/ : /b/;",
	"n = / |> 2 /\n2\n;",
	"const r = /a|b/;",
	"const r = /|a/;",
	"const r = /a|/;",
	"const r = /(a|b)+/;",
	"const r = /(?:ab){1,3}?/;",
	"const r = /a.b/;",
	"const r = /^a$/m;",
	"const r = /[ab]/;",
	"const r = /[a-z]+/u;",
	"const r = /[^]/;",
	"const r = /\\d+/u;",
	"const r = /a\\/b/;",
	"const r = /é/u;",
	"const r = /(?<letter>a)\\k<letter>/u;",
	"const r = /(?=a)a/;",
	"const r = /(?<=a)b/;",
	"const r = /\\p{ASCII}+/u;",
	"const r = /[\\p{ASCII}&&\\p{Letter}]/v;",
}

func TestGrammarAdmissionRegExpKeys(t *testing.T) {
	grammarRequireRegExpNode(t)
	for _, source := range grammarRegExpSources {
		if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
			t.Errorf("valid native RegExp still has no derivation: %s: %s", source, detail)
		}
		if got := grammarAdmissionForm(source); got != "" {
			t.Errorf("derived RegExp retained a pending key %q: %s", got, source)
		}
	}
	for _, source := range []string{
		"const n = 8 / 2 / 2;", "const text = \"/a/\";",
		"// /a/\nconst n = 1;", "const r = /a/gg;", "const r = /a/z;",
		"const r = /a/uv;", "const r = /?a/;", "const r = /*a/;",
		"const r = /+a/;", "const r = /a**/;", "const r = /a*+/;",
		"const r = /a???/;", "const r = /a\nb/;", "const r = /unterminated;",
		"type T = /a/;",
	} {
		if _, ok := grammarValidatedRegExpTokens(source); ok {
			t.Errorf("non-literal or invalid RegExp entered lexical validation: %s", source)
		}
	}
	const independent = "const r = /a/; const b = x is 1 + 1;"
	if mismatch, _ := grammarAdmissionMismatch(independent); !mismatch {
		t.Fatal("RegExp tokens hid an independent gap")
	}
	if got := grammarAdmissionForm(independent); got != "admission:is-operand-precedence" {
		t.Errorf("independent key lost: %q", got)
	}
}

func TestGrammarAdmissionRegExpRegression(t *testing.T) {
	TestGrammarAdmissionRegExpQuoted(t)
	grammarRequireRegExpNode(t)
	w := NewWorkspace(t)
	for _, source := range grammarRegExpSources {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("native RegExp derivation was lost: %s", source)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	t.Run("alternation-witness", func(t *testing.T) {
		key, source := grammarAdmissionInput([]byte("key:native-regexp-literal\n02B)"))
		if source != "n = / |> 2 /\n2\n;" {
			t.Fatalf("alternation replay drifted: %q: %s", key, source)
		}
		checkGrammarAdmission(t, w, key, source)
	})
	t.Run("lazy-quantifier-witness", func(t *testing.T) {
		key, source := grammarAdmissionInput([]byte("key:native-regexp-literal\n02B1"))
		if source != "n = / ?? 2 /\n2\n;" {
			t.Fatalf("keyed quantifier mutation drifted: %q: %s", key, source)
		}
		checkGrammarAdmission(t, w, key, source)
	})

	t.Run("literal-punctuation-witness", func(t *testing.T) {
		key, source := grammarAdmissionInput([]byte("key:native-regexp-literal\n02B00"))
		if source != "n = / => 2 /\n2\n;" {
			t.Fatalf("keyed regexp mutation drifted: %q: %s", key, source)
		}
		checkGrammarAdmission(t, w, key, source)
	})

	t.Run("raw-witness", func(t *testing.T) {
		key, source := grammarAdmissionInput([]byte("key:native-division\n08008000Y0000"))
		if source != grammarRegExpSources[0] {
			t.Fatalf("keyed division mutation drifted: %q: %s", key, source)
		}
		checkGrammarAdmission(t, w, key, source)
	})
}
