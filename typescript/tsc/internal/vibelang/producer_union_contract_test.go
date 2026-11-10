package vibelang

import (
	"fmt"
	"maps"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var producerUnionContracts = []string{
	"(()=>Stream.Stream<number>)|(()=>Generator<number,void,unknown>)",
	"(()=>Generator<number,void,unknown>)|(()=>Stream.Stream<number>)",
	"()=>Stream.Stream<number>|Generator<number,void,unknown>",
	"()=>Generator<number,void,unknown>|Stream.Stream<number>",
	"(()=>Generator<number,void,unknown>)|(()=>unknown)",
	"(()=>Generator<number,void,unknown>)|{}",
	"()=>Generator<number,void,unknown>|{}",
	"()=>Generator<number,void,unknown>|unknown",
}

func TestProducerUnionContract(t *testing.T) {
	for index, contract := range producerUnionContracts {
		for _, shape := range []string{"inline", "wrapped", "declaration", "variable", "alias", "method"} {
			for _, valued := range []bool{false, true} {
				t.Run(fmt.Sprintf("contract=%d/%s/valued=%t", index, shape, valued), func(t *testing.T) {
					body := "yield 1"
					want := map[int32]int{}
					if valued {
						body += ";return undefined"
						want[2128] = 1
					}
					source := producerUnionSource(contract, shape, body, false)
					program, file, _, _ := editorProgram(t, source)
					got := map[int32]int{}
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Category() == diagnostics.CategoryError {
							got[d.Code()]++
						}
					}
					if !maps.Equal(got, want) {
						t.Fatalf("want %v, got %v\n%s", want, got, source)
					}
				})
			}
		}
	}
}

func TestProducerUnionNativeContracts(t *testing.T) {
	contracts := []string{
		"()=>Generator<number,void,unknown>",
		"(()=>Generator<number,void,unknown>)|undefined",
		"()=>Generator<number,void,unknown>|undefined",
		"(()=>Generator<number,void,unknown>)|null",
		"()=>Generator<number,void,unknown>|null",
		"(()=>Generator<number,void,unknown>)|(()=>AsyncGenerator<number,void,unknown>)",
		"()=>Generator<number,void,unknown>|AsyncGenerator<number,void,unknown>",
	}
	for index, contract := range contracts {
		for _, shape := range []string{"inline", "declaration"} {
			for _, native := range []bool{false, true} {
				t.Run(fmt.Sprintf("contract=%d/%s/native=%t", index, shape, native), func(t *testing.T) {
					source := producerUnionSource(contract, shape, "yield 1", native)
					program, file, _, _ := editorProgram(t, source)
					got := map[int32]int{}
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							got[d.Code()]++
						}
					}
					want := map[int32]int{}
					if !native {
						want[1002] = 1
					}
					if !maps.Equal(got, want) {
						t.Fatalf("want %v, got %v\n%s", want, got, source)
					}
				})
			}
		}
	}
}

func producerUnionSource(contract, shape, body string, native bool) string {
	marker := "effect "
	if native {
		marker = ""
	}
	literal := marker + "function*(){" + body + "}"
	prefix, argument := "", literal
	switch shape {
	case "wrapped":
		argument = "(" + literal + ")"
	case "declaration":
		prefix = marker + "function* p(){" + body + "};"
		argument = "p"
	case "variable":
		prefix = "const p=" + literal + ";"
		argument = "p"
	case "alias":
		prefix = marker + "function* p(){" + body + "};const alias=p;"
		argument = "alias"
	case "method":
		prefix = "const object={" + marker + "*p(){" + body + "}};"
		argument = "object.p"
	}
	return "import {Stream} from \"effect\";declare function take(f:" + contract + "):number;" + prefix + "export const result:number=take(" + argument + ");"
}
