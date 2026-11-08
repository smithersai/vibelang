package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestWrappedEffectParameters(t *testing.T) {
	for _, shape := range []struct {
		name                             string
		marked, producer, options, arrow bool
	}{
		{"function", true, false, false, false},
		{"arrow", true, false, false, true},
		{"options-function", true, false, true, false},
		{"options-arrow", true, false, true, true},
		{"producer", true, true, false, false},
		{"options-producer", true, true, true, false},
		{"plain", false, false, false, false},
		{"plain-generator", false, true, false, false},
	} {
		for _, contract := range []string{"RangeError", "never", "untagged", "builtin", "constructor", "tagged"} {
			t.Run(fmt.Sprintf("%s/%s", shape.name, contract), func(t *testing.T) {
				tag := ""
				if contract != "untagged" {
					tag = "/** @throws {" + contract + "} */\n"
				}
				if contract == "constructor" || contract == "tagged" {
					tag = "/** @throws {RangeError} */\n"
				}
				if contract == "builtin" {
					tag = "/** @throws {RangeError} */\n"
				}
				expr := "risky()"
				if contract == "builtin" {
					expr = "JSON.parse(\"1\") as number"
				}
				if contract == "constructor" {
					expr = "new Risky()"
				}
				if contract == "tagged" {
					expr = "riskyTag\x60value\x60"
				}
				marker := ""
				if shape.marked {
					marker = "effect "
				}
				callback := marker + "function nested(value=" + expr + ") { return value }"
				if shape.arrow {
					callback = marker + "(value=" + expr + ") => value"
				}
				if shape.producer {
					callback = marker + "function* nested(value=" + expr + ") { yield value }"
				}
				argument := callback
				if shape.options {
					argument = "{try:" + callback + ",catch:(error)=>error}"
				}
				source := "import {risky,riskyTag,Risky} from \"./foreign.js\"\nexport const program=Effect.try(" + argument + ")\n"
				p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"foreign.d.ts": tag + "export declare function risky():number\n" + tag + "export declare function riskyTag(parts:TemplateStringsArray):number\nexport declare class Risky {\n" + tag + "constructor()\n}\n"})
				got := 0
				for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), f), p.GetSemanticDiagnostics(t.Context(), f)...) {
					if d.Category() != diagnostics.CategoryError {
						continue
					}
					got++
					if !shape.marked || contract == "never" || d.Source() != diagnosticSource || d.Code() != 401 {
						t.Errorf("unexpected: %s", d.String())
					}
				}
				want := 0
				if shape.marked && contract != "never" {
					want = 1
				}
				if got != want {
					t.Errorf("got %d errors, want %d EK0401", got, want)
				}
			})
		}
	}
}
