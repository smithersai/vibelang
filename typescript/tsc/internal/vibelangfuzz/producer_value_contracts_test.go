package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestProducerValueContractsRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, domain := range []string{"unknown", "any", "{}", "object"} {
		for _, order := range []string{"value-first", "generator-first"} {
			for _, home := range []string{"inline", "named", "alias"} {
				t.Run(domain+"/"+order+"/"+home, func(t *testing.T) {
					v := "/** @throws {never} */ export declare function take(f:" + domain + "):number;"
					g := "/** @throws {never} */ export declare function take(f:()=>Generator<number,void,unknown>):number;"
					api := v + g
					if order == "generator-first" {
						api = g + v
					}
					source := "import {take} from \"./api.js\";"
					arg := "effect function*(){yield 1}"
					if home != "inline" {
						source += "effect function* values(){yield 1};"
						arg = "values"
						if home == "alias" {
							source += "const alias=values;"
							arg = "alias"
						}
					}
					source += "export const result=take(" + arg + ");"
					r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "api.ts": api}})
					if err != nil {
						t.Fatal(err)
					}
					defer r.Remove()
					var codes []int32
					for _, d := range r.Diagnostics {
						if d.Category() == diagnostics.CategoryError {
							codes = append(codes, d.Code())
						}
					}
					if len(codes) != 0 {
						t.Fatalf("value overload: %v; %s", codes, source)
					}
				})
			}
		}
	}
	for _, call := range []string{
		"Effect.fn(\"read\")(ARG,(value:string)=>value)",
		"Effect.fn(\"read\")(ARG,1)",
		"Effect.fnUntraced(ARG,(value:string)=>value)",
		"Effect.fnUntraced(ARG,1)",
		"Option.gen(ARG)", "Effect.gen(ARG)",
	} {
		t.Run(call, func(t *testing.T) {
			source := "import {Effect,Option} from \"effect\";export const result=" + strings.ReplaceAll(call, "ARG", "effect function*(){yield 1}") + ";"
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			found := false
			var codes []int32
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, d.Code())
					found = found || d.Code() == 1002
				}
			}
			if !found {
				t.Fatalf("native generator mismatch missing: %v; %s", codes, source)
			}
		})
	}
}
