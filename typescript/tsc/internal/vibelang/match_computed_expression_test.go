package vibelang

import (
	"fmt"
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestComputedPatternKeyExpressions(t *testing.T) {
	for _, test := range []struct{ name, prefix, domain, key, parameters string }{
		{"do", "", `{field:number}`, `do { "field" as const }`, ""},
		{"call", `function key():"field"{return "field"};`, `{field:number}`, "key()", ""},
		{"parenthesized", `const key="field" as const;`, `{field:number}`, "(key)", ""},
		{"binary", "", `Record<string,number>`, `"fi"+"eld"`, ""},
		{"conditional", "", `Record<string,number>`, `flag?"field":"other"`, ",flag:boolean"},
		{"dynamic-index", `const keys=["field","other"] as const;`, `Record<string,number>`, "keys[index]", ",index:0|1"},
		{"template", "", `{field:number}`, "`field`", ""},
		{"sequence", `function tick():number{return 0};`, `{field:number}`, `(tick(),"field" as const)`, ""},
		{"coalesce", `declare const Box:{field?:"field"};`, `{field:number}`, `Box.field??"field"`, ""},
		{"method", `const Box={key():"field"{return "field"}};`, `{field:number}`, "Box.key()", ""},
		{"unique-symbol", `declare const token:unique symbol;function key():typeof token{return token};`, `{[token]:number}`, "key()", ""},
		{"overload", `function key(x:true):"field";function key(x:false):"other";function key(x:boolean):"field"|"other"{return x?"field":"other"};`, `{field:number}`, "key(true)", ""},
		{"generic", `function key<T extends "field"|"other">(x:T):T{return x};`, `{field:number}`, `key("field")`, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := test.prefix + fmt.Sprintf("export function f(subject:%s%s):number{return match(subject){when {[%s]:let value}:value;default:0;}}", test.domain, test.parameters, test.key)
			program, file, _, _ := editorProgram(t, source)
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("%s\n%s", d.String(), source)
				}
			}
		})
	}
}

func TestComputedPatternKeyInlineContexts(t *testing.T) {
	for _, expression := range []string{
		`match(subject){when {[key()]:let value}:value;default:0;}`,
		`1+match(subject){when {[key()]:let value}:value;default:0;}`,
		`[match(subject){when {[key()]:let value}:value;default:0;}][0]!`,
	} {
		source := `function key():"field"{return "field"};export function f(subject:{field:number}):number{return ` + expression + "}"
		if ds := errorsOf(t, source); len(ds) != 0 {
			t.Errorf("computed key lost its type in an expression: %v\n%s", ds, source)
		}
	}
}

func TestComputedPatternKeyIsHomes(t *testing.T) {
	for _, body := range []string{
		"return subject is {[key()]:let value}",
		"if(subject is {[key()]:let value})return value;return 0",
		"while(subject is {[key()]:let value})return value;return 0",
		"return 1+(match(subject){when {[key()]:let value}:value;default:0;})",
	} {
		source := `function key():"field"{return "field"};export function f(subject:{field:number}){` + body + "}"
		if ds := errorsOf(t, source); len(ds) != 0 {
			t.Errorf("computed key lost its type after hoisting: %v\n%s", ds, source)
		}
	}
	source := `function key():"field"{return "field"};export effect function f(subject:{field:number}):number!!{return match(subject){when {[key()]:let value}:value;default:0;}}`
	if ds := errorsOf(t, source); len(ds) != 0 {
		t.Errorf("computed key in effect code: %v", ds)
	}
}

func TestComputedPatternKeyDoIsHomes(t *testing.T) {
	for _, body := range []string{
		`return subject is {[do { "field" as const }]:let value}`,
		`if(subject is {[do { "field" as const }]:let value})return value;return 0`,
		`while(subject is {[do { "field" as const }]:let value})return value;return 0`,
	} {
		source := `export function f(subject:{field:number}){` + body + "}"
		if ds := errorsOf(t, source); len(ds) != 0 {
			t.Errorf("do key lost its assigned tuple: %v\n%s", ds, source)
		}
	}
}

func TestComputedPatternKeyRestType(t *testing.T) {
	source := `function key():"field"{return "field"};export function f(subject:{field:number;other:string}){return match(subject){when {[key()]:let value,...let rest}:do{const keep:string=rest.other;const omitted=rest.field;value};default:0;}}`
	program, file, _, _ := editorProgram(t, source)
	count := 0
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if d.Code() == 2339 {
			count++
		} else {
			t.Error(d.String())
		}
	}
	if count != 1 {
		t.Errorf("got %d excluded-field errors, want 1\n%s", count, source)
	}
}

func TestComputedPatternKeyInvalidTypes(t *testing.T) {
	for _, test := range []struct {
		keyType string
		codes   []int32
	}{
		{"boolean", []int32{2322, 2538}},
		{"object", []int32{2322, 2538}},
		{"undefined", []int32{2538, 18048}},
	} {
		t.Run(test.keyType, func(t *testing.T) {
			source := "declare function key():" + test.keyType + ";export function f(subject:Record<PropertyKey,number>){return match(subject){when {[key()]:let value}:value;default:0;}}"
			program, file, _, _ := editorProgram(t, source)
			var codes []int32
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, d.Code())
				}
			}
			slices.Sort(codes)
			if !slices.Equal(codes, test.codes) {
				t.Errorf("got %v, want native key diagnostics %v", codes, test.codes)
			}
		})
	}
}

func TestComputedPatternKeyDiagnosticRetired(t *testing.T) {
	if registry[4704] != nil {
		t.Fatal("computed property expressions must not retain the unsupported-pattern diagnostic")
	}
}

func TestComputedPatternKeyCoverage(t *testing.T) {
	for _, generic := range []bool{false, true} {
		for _, complete := range []bool{false, true} {
			source := `function key():"_tag"{return "_tag"};type S={_tag:"A"|"B"};`
			parameters, subject := "", "S"
			if generic {
				parameters = "<T extends S>"
				subject = "T"
			}
			arms := `when {[key()]:"A"}:1;`
			if complete {
				arms += `when {[key()]:"B"}:2;`
			}
			source += fmt.Sprintf("export function f%s(s:%s){return match(s){%s}}", parameters, subject, arms)
			program, file, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() == 4701 {
					count++
				} else {
					t.Error(d.String())
				}
			}
			want := 1
			if complete {
				want = 0
			}
			if count != want {
				t.Errorf("generic=%v complete=%v: got %d EK4701, want %d", generic, complete, count, want)
			}
		}
	}
}

func TestComputedPatternKeyComplexContexts(t *testing.T) {
	for _, source := range []string{
		`export function f(s:{field:number}):number{return match(s){when {[do { "field" as const }]:let value}:value;default:0;}}`,
		`async function key():Promise<"field">{return "field"};export async function f(s:{field:number}):Promise<number>{return match(s){when {[await key()]:let value}:value;default:0;}}`,
		`effect function key():"field"!!{return "field"};export effect function f(s:{field:number}):number!!{return match(s){when {[try key()]:let value}:value;default:0;}}`,
	} {
		if ds := errorsOf(t, source); len(ds) != 0 {
			t.Errorf("computed key changed its enclosing context: %v\n%s", ds, source)
		}
	}
}

func TestComputedPatternKeyPayloadNarrowing(t *testing.T) {
	for _, inline := range []bool{false, true} {
		source := `function key():"_tag"{return "_tag"};type S={_tag:"A";a:number}|{_tag:"B";b:string};`
		body := `match(s){when {[key()]:"A"}:s.a;when {[key()]:"B"}:s.b;}`
		if inline {
			body = `"label"+(` + body + ")"
		}
		source += "export function f(s:S){return " + body + "}"
		if ds := errorsOf(t, source); len(ds) != 0 {
			t.Errorf("lost computed-key payload narrowing: %v\n%s", ds, source)
		}
	}
}

func TestComputedPatternKeySourceHygiene(t *testing.T) {
	source := `const $matchKey1Source=21,$matchKey2Source=22,$matchKey3Source=23,$matchKey4Source=24,$matchKey5Source=25,$matchKey6Source=26,$matchKey7Source=27,$matchKey8Source=28;function key():"value"{return "value"};export function select(s:{value:number}):number{if(s is {[do {key()}]:let value})return value+$matchKey2Source;return $matchKey1Source}`
	if ds := errorsOf(t, source); len(ds) != 0 {
		t.Errorf("computed key captured a source identifier: %v\n%s", ds, source)
	}
}
