package vibelang

import (
	"fmt"
	"testing"
)

func TestConcurrentFreshBindingDefaults(t *testing.T) {
	for _, row := range []struct{ key, binding, items, body string }{
		{"empty-object", "{n=1}", "[{}]", "const checked:number=n;void checked"},
		{"do-default", "{n=do { 1 }}", "[{}]", "const checked:number=n;void checked"},
		{"effect-default", "{n=try succeed(1)}", "[{}]", "const checked:number=n;void checked"},
		{"do-effect-default", "{n=do { try succeed(1) }}", "[{}]", "const checked:number=n;void checked"},
		{"renamed", "{n:value=1}", "[{}]", "const checked:number=value;void checked"},
		{"computed", "{[\"n\"]:n=1}", "[{}]", "const checked:number=n;void checked"},
		{"nested", "{inner:{n=1}}", "[{inner:{}}]", "const checked:number=n;void checked"},
		{"union", "{n=1}", "[{}, {n:2}]", "const checked:number=n;void checked"},
		{"array", "[n=1]", "[[]]", "const checked:number=n;void checked"},
		{"nested-array", "[{n=1}]", "[[{}]]", "const checked:number=n;void checked"},
		{"rest", "{n=1,...rest}", "[{}]", "const checked:number=n;void checked;void rest"},
	} {
		for _, kind := range []string{"const", "let"} {
			for _, limit := range []string{"", "(1)"} {
				t.Run(fmt.Sprintf("%s/%s/%s", row.key, kind, limit), func(t *testing.T) {
					source := fmt.Sprintf("export effect function main(){for concurrent%s(%s %s of %s){%s};return 7}", limit, kind, row.binding, row.items, row.body)
					if errors := errorsOf(t, source); len(errors) != 0 {
						t.Fatalf("native binding default rejected: %v\n%s", errors, source)
					}
				})
			}
		}
	}
}

func TestConcurrentFreshBindingErrors(t *testing.T) {
	for _, row := range []struct {
		key, params, binding, items, body string
		code                              int32
	}{
		{"named-object", "rows:{}[]", "{n=1}", "rows", "void n", 2339},
		{"required-property", "", "{n}", "[{}]", "void n", 2339},
		{"wrong-default-type", "", "{n=1}", "[{}]", "const checked:string=n;void checked", 2322},
		{"independent-body", "", "{n=1}", "[{}]", "void n;missing()", 2304},
	} {
		t.Run(row.key, func(t *testing.T) {
			source := fmt.Sprintf("export effect function main(%s){for concurrent(const %s of %s){%s};return 7}", row.params, row.binding, row.items, row.body)
			errors := errorsOf(t, source)
			if len(errors) != 1 || errors[0].Code() != row.code {
				t.Fatalf("want exactly TS%d, got %v\n%s", row.code, errors, source)
			}
		})
	}
}

// Keep the existing RHS capture inference separate from fresh binding defaults.
func TestConcurrentFreshBindingRHSClosures(t *testing.T) {
	for _, row := range []struct{ binding, items, read, body string }{
		{"{n}", "[{n:3}]", "n.toFixed()", "void n"},
		{"[a,...rest]", "[[4,5]]", "[a.toFixed(),rest.length]", "void a;void rest"},
		{"{n=1}", "[{}]", "n.toFixed()", "void n"},
		{"{inner:{n=1}}", "[{inner:{}}]", "n.toFixed()", "void n"},
	} {
		source := fmt.Sprintf("export effect function main(){let probe:()=>unknown=()=>0;for concurrent(1)(const %s of (probe=()=>%s,%s)){%s};return probe}", row.binding, row.read, row.items, row.body)
		if errors := errorsOf(t, source); len(errors) != 0 {
			t.Errorf("existing RHS capture inference changed: %v; %s", errors, source)
		}
	}
}
