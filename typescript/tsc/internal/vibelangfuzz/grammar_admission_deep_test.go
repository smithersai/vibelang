package vibelangfuzz

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// grammarAdmissionDeepSources returns every seed and keyed corpus program. A
// stacked mutation starts from a form the suite already reached.
func grammarAdmissionDeepSources() []string {
	var sources []string
	for _, seed := range grammarAdmissionSeeds {
		sources = append(sources, seed.source)
	}
	files, _ := filepath.Glob("testdata/fuzz/FuzzGrammarAdmission/*")
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			continue
		}
		_, line, ok := strings.Cut(string(data), "\n")
		if !ok {
			continue
		}
		line, _, _ = strings.Cut(line, "\n")
		text, err := strconv.Unquote(strings.TrimSuffix(strings.TrimPrefix(line, "[]byte("), ")"))
		if err != nil || text == "" {
			continue
		}
		_, source := grammarAdmissionInput([]byte(text))
		sources = append(sources, source)
	}
	return sources
}

func FuzzGrammarAdmissionDeep(f *testing.F) {
	// Spec rule: docs/design/src/001-functions.md#cf6d8b7ccc47907d
	// Chapter 001: inline module seeds violate the current grammar (FuzzGrammarAdmission).

	startShortBudget(f)
	w := NewWorkspace(f)
	sources := grammarAdmissionDeepSources()
	f.Add([]byte{0, 0, 3, 1, 0, 3, 1, 0, 3, 1, 0})
	f.Add([]byte{1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1})
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) < 5 || len(data) > 64 {
			t.Skip("bounded grammar subset")
		}
		source := sources[(int(data[0])|int(data[1])<<8)%len(sources)]
		half := 2 + (len(data)-2)/2
		_, source = grammarAdmissionMutate(source, data[1:half])
		key, source := grammarAdmissionMutate(source, data[half-1:])
		if len(source) > 1024 {
			t.Skip("bounded grammar subset")
		}
		checkGrammarAdmission(t, w, key, source)
	})
}

// Native TypeScript: Appendix A inherits these, and the compiler accepts them.
func TestGrammarAdmissionDeepNative(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range []string{
		"class C { static { } }",
		"error is\n1 + 1",
		"error as\neffect { }",
		"x =\nerror ! !\nerror is\n1 + 1",
		"module as { error\nexport const n = 1 ; }",
		"schema C { id : readonly\nstring }",
		"class C { async g ? ( ) }",
		"class C { async * g ? ( ) }",
		"class C { * g ? ( ) }",
		"class C { static { x ; } }",
		"const v = class { static { } } ;",
		"C < T >",
		"const v = C < T >",
		"join < value\n>",
		"M <\nrestore >",
		"const v = C < T >\nx ;",
		"schema\nC < T >\nmatch =>\n{ a : ; T }",
		"x as number < y",
		"x as number < uninterruptible",
		"x as T\n< y",
		"x = { p = 1 } = data",
		"( { p = 1 } = data )",
		"( { a, p = 1, b } = data )",
		"const b = throw 1\n+ 1 ;",
		"b = throw x\n+ error",
		"class C { x = throw 1\n* g ( ) { } }",
		"const b = throw 1\n- 1 ;",
	} {
		t.Run(source, func(t *testing.T) {
			if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
				t.Fatal(detail)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}

// Syntax rejections stay rejections: each diagnostic must count, and each
// neighbor of a lab addition must still fail.
func TestGrammarAdmissionDeepRejected(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range []string{
		"schema S = ?? { static id : Missing } ;",
		"schema S = ! { readonly readonly id : Missing } ;",
		"schema S = ?? { id : Missing = 1 } ;",
		"class C < > { }",
		"function f < > ( ) { }",
		"error C < >",
		"schema => class < > { }",
		"type T = [ service : number ? ]",
		"const b = throw 1\n* 1 ;",
		"const b = throw 1 + 1 ;",
		"function f ( xs ) { for ( const x = 1 of xs ) { } }",
		"const x = { p = 1 } ;",
		"const v = C < T > + 1 ;",
		"x as Foo < y",
		"schema S { key : string = \"k\" }",
	} {
		t.Run(source, func(t *testing.T) {
			if mismatch, _ := grammarAdmissionMismatch(source); !mismatch {
				return
			}
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			if result.Program != nil && HasError(result.Program.GetSyntacticDiagnostics(context.Background(), nil)) {
				return
			}
			for _, d := range result.Diagnostics {
				if grammarAdmissionSyntaxDiagnostic(d) {
					return
				}
			}
			t.Fatalf("no syntax rejection: %v", result.Diagnostics)
		})
	}
}

// Each witness minimized a stacked mutation. A key narrower than its family
// reports the same gap as a new mutation.
func TestGrammarAdmissionDeepKeys(t *testing.T) {
	w := NewWorkspace(t)
	for source, want := range map[string]string{
		"class C { effect g ? ( ) }":                               "admission:effect-optional-class-member",
		"schema T = ( number ! E ! )":                              "admission:effect-type-trailing-bang",
		"{ schema T =\n(\nnumber ! E ! ) }":                        "admission:effect-type-trailing-bang",
		"x is is and > 1 + 1":                                      "admission:is-operand-precedence",
		"x is > 1 or > 1 + 1":                                      "admission:is-operand-precedence",
		"1\nimport\n< require\nservice\nservice\n: when\nreadonly": "admission:import-relational-recovery",
		"const b =\nthrow 1 as 1\n?? 1":                            "admission:throw-assertion-lookahead",
		"b = throw 1 as as > 1":                                    "admission:throw-assertion-lookahead",
		"const b = throw 1 as 1 ?? 1":                              "admission:throw-assertion-lookahead",
		"const b = throw 1 satisfies T ?? 1":                       "admission:throw-assertion-lookahead",
		"const b = x is const and + 1 ;":                           "admission:is-operand-precedence",
		"const b = x is y as 1 & 2 + 3 ;":                          "admission:is-operand-precedence",
		"const b = x is or + 1":                                    "admission:is-operand-precedence",
		"const b = x is > or + 1":                                  "admission:is-operand-precedence",
		"const b =\nerror is is or or + 1":                         "admission:is-operand-precedence",
		"const b =\nschema is and + match ;":                       "admission:is-operand-precedence",
		"x is >\n1 as & 2 + 3":                                     "admission:is-operand-precedence",
		"b = throw\nschema is 1 + 1":                               "admission:is-operand-precedence",
		"!\nschema is type + 1":                                    "admission:is-operand-precedence",
		"import import . meta !":                                   "admission:import-meta-specifier",
		"import import . meta as meta":                             "admission:import-meta-specifier",
		"import import . meta <\nmeta\n. url > ;":                  "admission:import-meta-specifier",
		"! import < value":                                         "admission:import-relational-recovery",
	} {
		t.Run(source, func(t *testing.T) {
			if got := grammarAdmissionForm(source); got != want {
				t.Fatalf("key = %q, want %q", got, want)
			}
			if _, pending := Pending("FuzzGrammarAdmission", want); !pending {
				t.Fatalf("%s is not pending", want)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
	for source, not := range map[string]string{
		"const b = x!\nschema C":  "admission:is-operand-precedence",
		"class C { g ? ( ) { } }": "admission:effect-optional-class-member",
		"x is y and z":            "admission:is-operand-precedence",
	} {
		if got := grammarAdmissionForm(source); got == not {
			t.Errorf("%q gained key %s", source, not)
		}
	}
}
