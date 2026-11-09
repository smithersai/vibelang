package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

func TestGrammarAdmissionSchemaInterruptionQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarSchemaFieldTypeQuote) {
		t.Fatal("Appendix A Field changed; review schema modifier classification")
	}
	if !strings.Contains(SpecText("../vips/0022-interruption-blocks.md"), grammarGeneratorInterruptionQuote) {
		t.Fatal("VIP-22 interruption placement changed; review statement classification")
	}
}

var grammarSchemaInterruptionSources = []string{
	"schema uninterruptible { effect id: join }",
	"schema interruptible { effect id: join }",
	"schema restore { effect id: join }",
	"schema uninterruptible { effect id: string }",
	"schema interruptible { effect id?: string }",
	"schema restore { effect id?: Missing }",
	"export schema uninterruptible { effect id: join }",
	"{ schema restore { effect id: join } }",
}

func TestGrammarAdmissionSchemaInterruptionKeys(t *testing.T) {
	TestGrammarAdmissionSchemaInterruptionQuoted(t)
	for _, source := range grammarSchemaInterruptionSources {
		if got := grammarAdmissionForm(source); got != "" {
			t.Errorf("schema field keyed %q; its name starts no interruption statement: %s", got, source)
		}
	}
	for _, word := range []string{"uninterruptible", "interruptible", "restore"} {
		for _, source := range []string{
			"schema " + word + " { id: string }",
			"class " + word + " {}",
			"const text = \"" + word + " {\";",
			"// " + word + " {\nconst n = 1;",
			"const text = \x60" + word + " {\x60;",
		} {
			if got := grammarAdmissionForm(source); got != "" {
				t.Errorf("ordinary name or text gained pending key %q: %s", got, source)
			}
			if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
				t.Errorf("ordinary name or text lost its grammar derivation: %s: %s", source, detail)
			}
			independent := source + "\nconst b = x is 1 + 1;"
			if got := grammarAdmissionForm(independent); got != "admission:is-operand-precedence" {
				t.Errorf("name or text hid an independent gap under %q: %s", got, independent)
			}
		}
	}
	for source, want := range map[string]string{
		"function f() { uninterruptible { return 1; } }": "admission:interruption-outside-effect",
		"function* f() { interruptible {} }":             "admission:interruption-in-generator",
		"effect function f() { uninterruptible {} }":     "",
		"effect function f() { restore {} }":             "",
	} {
		if got := grammarAdmissionForm(source); got != want {
			t.Errorf("statement ownership keyed %q, want %q: %s", got, want, source)
		}
	}
}

func TestGrammarAdmissionSchemaInterruptionRegression(t *testing.T) {
	TestGrammarAdmissionSchemaInterruptionQuoted(t)
	w := NewWorkspace(t)
	for _, source := range grammarSchemaInterruptionSources {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			// A field written with effect has no derivation, whatever the
			// schema is named, and the compiler rejects it with EK0108.
			rejected := false
			for _, d := range result.Diagnostics {
				rejected = rejected || grammarAdmissionSyntaxDiagnostic(d)
			}
			if !rejected {
				t.Fatalf("a schema field with an effect modifier has no syntax rejection: %v", result.Diagnostics)
			}
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatal("a rejected schema field is an admission gap")
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	t.Run("keyed-witness", func(t *testing.T) {
		key, source := grammarAdmissionInput([]byte("key:schema-interruption-name\nschema uninterruptible { effect id : join }"))
		if source != "schema uninterruptible { effect id : join }" {
			t.Fatalf("keyed schema-name witness drifted: %q: %s", key, source)
		}
		checkGrammarAdmission(t, w, key, source)
	})
	t.Run("raw-witness", func(t *testing.T) {
		key, source := grammarAdmissionInput([]byte("}1709X78!0\xc01%"))
		if source != "schema uninterruptible { effect id : join }" {
			t.Fatalf("raw schema-name witness drifted: %q: %s", key, source)
		}
		checkGrammarAdmission(t, w, key, source)
	})
}
