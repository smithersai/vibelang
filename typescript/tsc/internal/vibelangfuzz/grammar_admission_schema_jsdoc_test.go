package vibelangfuzz

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

const grammarSchemaErrorTypeQuote = "Fields are written as TypeScript types and mapped to Schemas."

const grammarOptionalTupleQuote = "An enclosing TypeScript tuple can mark the completed Effect type as an optional tuple element:"

const grammarSchemaFieldTypeQuote = `Field = "readonly"? PropertyName "?"? ":" Type Separator`

func TestGrammarAdmissionSchemaJSDocQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarOptionalTupleQuote) {
		t.Fatal("Appendix A optional tuple inheritance changed; review native tuple controls")
	}
	if !strings.Contains(SpecText("../vips/0029-schema-errors.md"), grammarSchemaErrorTypeQuote) {
		t.Fatal("VIP-29 schema-error field mapping changed; review JSDoc type recovery")
	}
	if !strings.Contains(SpecText(grammarAppendix), grammarSchemaFieldTypeQuote) {
		t.Fatal("Appendix A's Field type production changed; review nullable-type recovery")
	}
}

// The native parser recovers JSDoc type prefixes even in source types.
// Schema mapping discards that written type before native grammar checks.
// Recognize prefix and postfix types inside a schema body or type alias;
// optional property markers and Effect type bangs remain separate.
func grammarSchemaJSDocFieldType(ts []grammarToken) bool {
	prefixes := map[string]bool{"?": true, "??": true, "!": true, "*": true}
	beforeType := map[string]bool{":": true, "[": true, "(": true, ",": true, "<": true, "|": true, "&": true, "=>": true, "readonly": true}
	for i, tok := range ts {
		if tok.kind != 'w' || tok.text != "schema" || i+2 >= len(ts) ||
			ts[i+1].kind != 'w' || ts[i+1].nl {
			continue
		}
		name := i + 1
		schemaError := ts[name].text == "error" && name+1 < len(ts) && ts[name+1].kind == 'w' && !ts[name+1].nl
		if schemaError {
			name++
		}
		start := name + 1
		if start >= len(ts) {
			continue
		}
		alias := ts[start].text == "="
		if schemaError && alias {
			continue
		}
		if alias {
			start++
		}
		if start >= len(ts) || !alias && ts[start].text != "{" {
			continue
		}
		depth := 0
		var typeBrackets []string
		callable := false
	aliasType:
		for k := start; k < len(ts); k++ {
			// Schema-error methods are native code, not mapped field types.
			if schemaError && depth == 1 && ts[k].text == "(" && k > start &&
				(ts[k-1].kind == 'w' || ts[k-1].kind == 's' || ts[k-1].text == "]" || ts[k-1].text == ">") {
				callable = true
			}
			if callable && depth == 1 && ts[k].text == ";" {
				callable = false
			}
			if callable && depth == 1 && ts[k].text == "{" {
				braces := 1
				for end := k + 1; end < len(ts); end++ {
					if ts[end].text == "{" {
						braces++
					}
					if ts[end].text == "}" {
						braces--
					}
					if braces == 0 {
						k = end
						callable = false
						continue aliasType
					}
				}
			}
			// A computed PropertyName is an expression even inside a source
			// type. Skip its brackets when the following colon identifies it;
			// a tuple type instead leaves the prefix positions visible.
			if ts[k].text == "[" {
				brackets := 1
				for end := k + 1; end < len(ts); end++ {
					if ts[end].text == "[" {
						brackets++
					}
					if ts[end].text == "]" {
						brackets--
					}
					if brackets != 0 {
						continue
					}
					after := end + 1
					if after < len(ts) && ts[after].text == "?" {
						after++
					}
					if after < len(ts) && (ts[after].text == ":" || ts[after].text == "(" || ts[after].text == "<") {
						k = end
						continue aliasType
					}
					break
				}
			}
			if alias && k > start && depth == 0 && ts[k].nl {
				switch ts[k].text {
				case "const", "let", "var", "function", "class", "interface", "type", "import", "export", "schema", "service", "error", "data", "effect", "async":
					break aliasType
				}
			}
			if !callable && prefixes[ts[k].text] && (alias && k == start || k > start && beforeType[ts[k-1].text]) {
				return true
			}
			// Native source types recover postfix ? as JSDoc nullable syntax.
			// A tuple's own optional element marker is ordinary TypeScript.
			if !callable && ts[k].text == "?" && k > start && !ts[k].nl {
				previous := ts[k-1]
				typeEnd := previous.kind == 'w' || previous.kind == 's' || previous.kind == 'n' ||
					previous.text == ")" || previous.text == "]" || previous.text == ">" || previous.text == "}"
				after := ""
				if k+1 < len(ts) {
					after = ts[k+1].text
				}
				tupleOptional := len(typeBrackets) > 0 && typeBrackets[len(typeBrackets)-1] == "[" && (after == "," || after == "]")
				if typeEnd && !tupleOptional {
					switch after {
					case "", ";", ",", "}", ")", "]", ">", "|", "&", "[":
						return true
					}
				}
			}
			switch ts[k].text {
			case "{", "[", "(", "<":
				typeBrackets = append(typeBrackets, ts[k].text)
				depth++
			case "}", "]", ")", ">":
				if len(typeBrackets) > 0 {
					typeBrackets = typeBrackets[:len(typeBrackets)-1]
				}
				depth--
			}
			if depth < 0 || !alias && depth == 0 || alias && depth == 0 && ts[k].text == ";" {
				break
			}
		}
	}
	return false
}

func TestGrammarAdmissionSchemaJSDocKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"schema C { id: string? }":                                 true,
		"schema C { id?: string? }":                                true,
		"schema C { readonly id: string? }":                        true,
		"schema C { id: (string?) }":                               true,
		"schema C { id: Array<string?> }":                          true,
		"schema C = string?;":                                      true,
		"schema error E { id: string? }":                           true,
		"schema C { id: [string?, number?] }":                      false,
		"schema C { id: [id?: string] }":                           false,
		"schema C { id: T extends U ? V : W }":                     false,
		"schema C { id: [Array<string?>] }":                        true,
		"schema C { [key ? a : b]: string }":                       false,
		"schema error E { m() { return value ? a : b; } }":         false,
		"schema error E { id: ?? string }":                         true,
		"schema error E { readonly id?: ? string }":                true,
		"schema error E { id: * }":                                 true,
		"schema error E { id: ! string }":                          true,
		"schema error E { [!key]: ?? string }":                     true,
		"schema error E { m() { return f(!value); } }":             false,
		"schema error E { m(): number { return { a: !value }; } }": false,
		"schema error E { [!key](): number { return 1; } }":        false,
		"error E { id: ?? string }":                                false,
		"schema\nerror E { id: ?? string }":                        false,
		"schema error\nE { id: ?? string }":                        false,
		"schema C { id: ?? string }":                               true,
		"schema C { id: * }":                                       true,
		"schema C { id: ! string }":                                true,
		"schema C { id: [?? string] }":                             true,
		"schema C = ?? string;":                                    true,
		"schema C { id: ? string }":                                true,
		"schema C { readonly id?: ?? number }":                     true,
		"schema C = { id: ?? string }":                             true,
		"schema C { id:\n?? Missing[] }":                           true,
		"schema C { [!key]: string }":                              false,
		"schema C { readonly [!key]?: string }":                    false,
		"schema C = { [!key]: string }":                            false,
		"schema C { [!key]: ?? string }":                           true,
		"schema C { id: string }":                                  false,
		"schema C { id?: string }":                                 false,
		"schema C { id: \"??\" }":                                  false,
		"const v = x ?? y;":                                        false,
		"type C = { id: ?? string }":                               false,
		"const schema = { id: x ?? y };":                           false,
		"schema C = string\nconst f = (x) => !x;":                  false,
		"schema C = x ?? y;":                                       false,
	} {
		if got := grammarSchemaJSDocFieldType(grammarLexSource(source)); got != want {
			t.Errorf("schema JSDoc recovery=%v, want %v: %s", got, want, source)
		}
		if key := grammarAdmissionForm(source); (key == "admission:schema-jsdoc-field-type") != want {
			t.Errorf("pending key=%q, want JSDoc family=%v: %s", key, want, source)
		}
	}
}

// A JSDoc type in a schema body, a schema alias or a schema error's field now
// reports TypeScript's TS17020, TS17019 or TS8020 beside EK2109, so no row is
// an admission gap; the rows pin that EK2109 still names the type.
func TestGrammarAdmissionSchemaJSDocRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range []struct {
		source   string
		mismatch bool
	}{
		{"schema C { id: string? }", false},
		{"schema C { id?: string? }", false},
		{"schema C { readonly id: string? }", false},
		{"schema C = string?;", false},
		{"schema error E { id: string? }", false},
		{"schema C { id: [string?, number?] }", false},
		{"schema error E { id: ?? string }", false},
		{"schema error E { readonly id?: ? string }", false},
		{"schema error E { id: * }", false},
		{"schema error E { id: ! string }", false},
		{"schema error E { m() { return f(!value); } }", false},
		{"schema error E { m(): number { return { a: !value }; } }", false},
		{"schema error E { [!key](): number { return 1; } }", false},
		{"schema C { id: ?? string }", false},
		{"schema C { id: * }", false},
		{"schema C { id: ! string }", false},
		{"schema C { id: [?? string] }", false},
		{"schema C = ?? string;", false},
		{"schema C { id: ? string }", false},
		{"schema C { readonly id?: ?? number }", false},
		{"schema C = { id: ?? string }", false},
	} {
		source := c.source
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			found := false
			var observed []string
			for _, d := range result.Diagnostics {
				observed = append(observed, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
				if IsEK(d) && d.Code() == 2109 {
					found = true
				}
			}
			if c.mismatch && !found {
				t.Errorf("schema control did not exercise EK2109; diagnostics: %v", observed)
			}
			if got := grammarAdmissionVerdict(t, w, source); got != c.mismatch {
				t.Fatalf("admission mismatch=%v, want %v; diagnostics: %v", got, c.mismatch, observed)
			}
			t.Logf("mismatch=%v; diagnostics: %v", c.mismatch, observed)
		})
	}
}

// Appendix A inherits native tuple types; its Effect-type punctuation rule
// explicitly preserves a completed tuple element followed by an optional mark.
func TestGrammarAdmissionOptionalTuples(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{
		"type T = [string?, number?];",
		"type T = [id?: string];",
		"type T = [id: string, next?: number];",
		"type T = [...string[]];",
		"type T = [head?: string, ...tail: number[]];",
		"type T = [number,];",
		"type T = [];",
	} {
		for _, grammar := range []*grammarCfg{lab.ts, lab.g} {
			if r := lab.read(grammar, grammarLexSource(source), grammarParseMode{}); r.count == 0 {
				t.Errorf("native tuple has no derivation: %s", source)
			}
		}
	}
	for _, source := range []string{
		"type T = [,];",
		"type T = [string??];",
		"type T = [id? string];",
		"type T = [...];",
	} {
		for _, grammar := range []*grammarCfg{lab.ts, lab.g} {
			if r := lab.read(grammar, grammarLexSource(source), grammarParseMode{}); r.count != 0 {
				t.Errorf("invalid tuple derives: %s", source)
			}
		}
	}
}
