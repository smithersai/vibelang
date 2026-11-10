package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

// Schema alias mapping can cover the native strict-mode BindingIdentifier
// rejection in a signature. Property keys and type references are not bindings.
func grammarSchemaSignatureReservedBinding(ts []grammarToken) bool {
	return grammarSchemaBodies(ts, func(open int, alias bool) bool {
		if !alias {
			return false
		}
		braces, parens, squares, angles := 1, 0, 0, 0
		for at := open + 1; at < len(ts) && braces > 0; at++ {
			if ts[at].text == "(" {
				close, depth := at+1, 1
				for close < len(ts) {
					if ts[close].text == "(" {
						depth++
					}
					if ts[close].text == ")" {
						depth--
					}
					if depth == 0 {
						break
					}
					close++
				}
				arrow := close+1 < len(ts) && ts[close+1].text == "=>"
				member := parens == 0 && squares == 0 && angles == 0 &&
					ts[at-1].text != ":" && ts[at-1].text != "="
				if close < len(ts) && (member || arrow) && grammarSignatureReservedParameter(ts[at+1:close]) {
					return true
				}
			}
			switch ts[at].text {
			case "{":
				braces++
			case "}":
				braces--
			case "(":
				parens++
			case ")":
				parens--
			case "[":
				squares++
			case "]":
				squares--
			case "<":
				angles++
			case ">":
				angles--
			}
		}
		return false
	})
}

func grammarSignatureReservedParameter(ts []grammarToken) bool {
	depth := 0
	for at, tok := range ts {
		if depth == 0 && (at == 0 || ts[at-1].text == ",") {
			if _, bad := grammarStrictBindingPattern(ts, at); bad {
				return true
			}
		}
		switch tok.text {
		case "(", "[", "{", "<":
			depth++
		case ")", "]", "}", ">":
			depth--
		}
	}
	return false
}

func grammarStrictBindingWord(word string) bool {
	switch word {
	case "let", "yield", "static", "implements", "interface", "package", "private", "protected", "public":
		return true
	}
	return false
}

// Read only binding positions, skipping property keys, annotations and defaults.
// This keeps a reserved type argument or initializer reference out of this key.
func grammarStrictBindingPattern(ts []grammarToken, at int) (int, bool) {
	if at >= len(ts) {
		return at, false
	}
	if ts[at].text == "..." {
		return grammarStrictBindingPattern(ts, at+1)
	}
	if ts[at].kind == 'w' {
		return at + 1, grammarStrictBindingWord(ts[at].text)
	}
	object := ts[at].text == "{"
	close := "]"
	if object {
		close = "}"
	} else if ts[at].text != "[" {
		return at + 1, false
	}
	at++
	for at < len(ts) && ts[at].text != close {
		if ts[at].text == "," {
			at++
			continue
		}
		start, bad := at, false
		if object && ts[at].text != "..." {
			name := grammarSchemaPropertyEnd(ts, at)
			if name == at {
				return at + 1, false
			}
			if name < len(ts) && ts[name].text == ":" {
				at, bad = grammarStrictBindingPattern(ts, name+1)
			} else {
				bad = ts[at].kind == 'w' && grammarStrictBindingWord(ts[at].text)
				at = name
			}
		} else {
			at, bad = grammarStrictBindingPattern(ts, at)
		}
		if bad {
			return at, true
		}
		if at <= start {
			return start + 1, false
		}
		if at < len(ts) && ts[at].text == "=" {
			depth := 0
			for at++; at < len(ts); at++ {
				if depth == 0 && (ts[at].text == "," || ts[at].text == close) {
					break
				}
				switch ts[at].text {
				case "(", "[", "{", "<":
					depth++
				case ")", "]", "}", ">":
					depth--
				}
			}
		}
	}
	if at < len(ts) {
		at++
	}
	return at, false
}

func TestGrammarAdmissionSchemaReservedBindingQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A TypeScript inheritance changed")
	}
}

func TestGrammarAdmissionSchemaReservedBindingKeys(t *testing.T) {
	const key = "admission:schema-signature-reserved-binding"
	for _, word := range []string{"let", "yield", "static", "implements", "interface", "package", "private", "protected", "public"} {
		for _, source := range []string{
			"schema S = { (" + word + ") }",
			"schema S = { (" + word + ": Missing): Missing }",
			"schema S = { f(" + word + "?: Missing): Missing }",
			"schema S = { (..." + word + ": Missing[]): Missing }",
			"schema S = { (x: Missing, " + word + ": Missing): Missing }",
			"schema S = { ({p: " + word + "}: Missing): Missing }",
			"schema S = { ([" + word + "]: Missing): Missing }",
		} {
			if got := grammarAdmissionForm(source); got != key {
				t.Errorf("key=%q, want %q: %q", got, key, source)
			}
		}
	}
	for source, want := range map[string]bool{
		"schema S = { readonly; (static) }":                         true,
		"schema S = { (static = 1): Missing }":                      true,
		"schema S = { ({static}: Missing): Missing }":               true,
		"schema S = { ({p: {static}}: Missing): Missing }":          true,
		"schema S = { ([...static]: Missing): Missing }":            true,
		"schema S = { f: (static: Missing) => Missing }":            true,
		"schema S = { nested: { (static: Missing): Missing } }":     true,
		"schema S = { (p: (static: Missing) => Missing): Missing }": true,
		"schema S = { (p: Map<string, static>): Missing }":          false,
		"schema S = { (p: (static)): Missing }":                     false,
		"schema S = { p: Map<string, (static)> }":                   false,
		"schema S = { p: (static) }":                                false,
		"schema S = { static(p: Missing): Missing }":                false,
		"schema S = { (readonly: Missing): Missing }":               false,
		"schema S = { (async: Missing): Missing }":                  false,
		"schema S = { ({static: p}: Missing): Missing }":            false,
		"schema S = { ({[key]: p}: Missing): Missing }":             false,
		"schema S = { ([p = static]: Missing): Missing }":           false,
		"schema S = { ({p = static}: Missing): Missing }":           false,
		"schema S { f(static: Missing): Missing }":                  false,
		"schema error E { f(static: Missing): Missing }":            false,
		"type S = { (static: Missing): Missing }":                   false,
	} {
		if got := grammarAdmissionForm(source); (got == key) != want {
			t.Errorf("key=%q, want reserved binding=%v: %q", got, want, source)
		}
	}
}

func TestGrammarAdmissionSchemaReservedBindingRegression(t *testing.T) {
	TestGrammarAdmissionSchemaReservedBindingQuoted(t)
	w := NewWorkspace(t)
	for _, source := range []string{
		"schema S = { readonly; (static) }",
		"schema S = { (static: Missing): Missing }",
		"schema S = { f(static: Missing): Missing }",
		"schema S = { (...static: Missing[]): Missing }",
		"schema S = { ({static}: Missing): Missing }",
		"schema S = { ({p: static}: Missing): Missing }",
		"schema S = { ([static]: Missing): Missing }",
		"class C { method() { schema S = { (static: Missing): Missing } } }",
	} {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				r, _ := w.Compile(context.Background(), Single(source))
				t.Fatalf("a rejected reserved parameter is an admission gap: %v", r.Diagnostics)
			}
		})
	}
}
