package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

func TestGrammarAdmissionMetaPropertyQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A TypeScript inheritance changed; review MetaProperty")
	}
}

func grammarInvalidImportMeta(ts []grammarToken) bool {
	for i, tok := range ts {
		if tok.kind != 'w' || tok.text != "import" || i+2 >= len(ts) || ts[i+1].text != "." || ts[i+2].kind != 'w' ||
			i > 0 && (ts[i-1].text == "." || ts[i-1].text == "?.") {
			continue
		}
		name := ts[i+2].text
		if name == "meta" {
			continue
		}
		if (name == "source" || name == "defer") && i+3 < len(ts) && (ts[i+3].text == "(" || ts[i+3].text == "<") {
			continue
		}
		return true
	}
	return false
}

func TestGrammarAdmissionMetaPropertyKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"import.x;": true, "import.x=1;": true, "import.x.url;": true, "import\n.x;": true,
		"import.source;": true, "import.defer;": true,
		"import.meta;": false, "import.meta.url;": false, "import.meta.x;": false,
		"import.source(x);": false, "import.defer(x);": false,
		"obj.import.x;": false, "obj?.import.x;": false, "new.target;": false,
	} {
		if got := grammarInvalidImportMeta(grammarLexSource(source)); got != want {
			t.Errorf("bad meta=%v,want %v: %s", got, want, source)
		}
		if key := grammarAdmissionForm(source); (key == "admission:import-meta-property") != want {
			t.Errorf("key=%q,want family=%v: %s", key, want, source)
		}
	}
}

func TestGrammarAdmissionMetaPropertyNative(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{"const u=import.meta.url;", "import.meta;", "import.meta.x;", "function f(){return new.target;}"} {
		for _, g := range []*grammarCfg{lab.ts, lab.g} {
			if r := lab.read(g, grammarLexSource(source), grammarParseMode{}); r.count == 0 {
				t.Errorf("native MetaProperty has no derivation: %s", source)
			}
		}
	}
	for _, source := range []string{"import.x;", "new.foo;"} {
		if r := lab.read(lab.ts, grammarLexSource(source), grammarParseMode{}); r.count != 0 {
			t.Errorf("invalid MetaProperty derives: %s", source)
		}
	}
}

func TestGrammarAdmissionMetaPropertyRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range []struct {
		source   string
		mismatch bool
	}{
		{"import.x;", true}, {"import.x=1;", true}, {"import.source;", true}, {"import.defer;", true},
		{"import.x.url;", false}, {"(import.x).url;", false}, {"import.meta.url;", false},
		{"function f(){return new.target;}", false}, {"new.foo;", false},
	} {
		t.Run(c.source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(c.source))
			if err != nil {
				t.Fatal(err)
			}
			if c.mismatch {
				found := false
				for _, d := range result.Diagnostics {
					if IsEK(d) && d.Code() == 4402 {
						found = true
					}
				}
				if !found {
					t.Fatal("platform check did not exercise EK4402")
				}
			}
			if got := grammarAdmissionVerdict(t, w, c.source); got != c.mismatch {
				t.Fatalf("mismatch=%v,want %v; diagnostics=%v", got, c.mismatch, result.Diagnostics)
			}
		})
	}
}
