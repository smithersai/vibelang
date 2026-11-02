package vibelangfmt

import (
	"strings"
	"testing"
)

func TestServiceContractSeparators(t *testing.T) {
	identity := func(text string) (string, error) { return text, nil }
	for _, source := range []string{
		"export service M { first(): number!!, second(): string!!, }",
		"service P { readonly label: string, count: number, }",
		"service N { pair: [number,string], object: { x: number, y: string }, literal: \"a,b\", }",
		"service G { map<A,B>(a: A,b: B): [A,B], read?(): number!!, }",
		"service C { first(): number!! /* before comma */, /* after comma */ second(): string!!, }",
		"service F { callback: (a: number,b: string) => string, list: Array<[number,string]>, }",
		"abstract error E { detail: string, }",
		"abstract error N { pair: [number,string], object: { x: number, y: string }, literal: \"a,b\", }",
		"abstract error C { first: number /* before comma */, /* after comma */ second: string, }",
	} {
		t.Run(source, func(t *testing.T) {
			once, err := Format("service.vibe", source, identity)
			if err != nil {
				t.Fatal(err)
			}
			twice, err := Format("service.vibe", once, identity)
			if err != nil {
				t.Fatal(err)
			}
			if once != twice {
				t.Fatalf("not idempotent: %s\nthen %s", once, twice)
			}
			if err := SameProgram(source, once); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(source, "\"a,b\"") && !strings.Contains(once, "\"a,b\"") {
				t.Fatal("changed literal data")
			}
		})
	}
}
