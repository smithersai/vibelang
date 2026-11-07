package vibelang

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestErrorInstanceMemberExtractionArity(t *testing.T) {
	for _, kind := range []string{"error", "schema error"} {
		for _, body := range []string{
			"code:number",
			"code:number;label():number{return this.code}",
			"label():number{return this.code};code:number",
			"get label():number{return this.code};code:number",
			"code:number;label():number{return this.code};get other():number{return this.code}",
		} {
			for _, shape := range []struct {
				args string
				want int
			}{
				{"", 1}, {"let item", 0}, {"let first,let second", 1}, {"...let items", 0}, {"let first,...let rest", 0}, {"let first,let second,...let rest", 1},
			} {
				t.Run(kind+"/"+body+"/"+shape.args, func(t *testing.T) {
					source := fmt.Sprintf("%s Boom{%s};export function f(subject:unknown){return match(subject){when Boom(%s):1;default:0;}}", kind, body, shape.args)
					program, file, _, _ := editorProgram(t, source)
					count := 0
					for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
						if d.Code() == EK0703.Code {
							count++
							if d.Category() != diagnostics.CategoryWarning {
								t.Errorf("arity is not a warning: %s", d.String())
							}
						} else if d.Category() == diagnostics.CategoryError {
							t.Error(d.String())
						}
					}
					if count != shape.want {
						t.Errorf("got %d EK0703, want %d\n%s", count, shape.want, source)
					}
				})
			}
		}
	}
}

func TestErrorInstanceMemberTagCoverage(t *testing.T) {
	for _, kind := range []string{"error", "schema error"} {
		for _, body := range []string{
			"code:number",
			"code:number;label():number{return this.code}",
			"get label():number{return this.code};code:number",
		} {
			for _, extracted := range []bool{false, true} {
				t.Run(fmt.Sprint(kind, "/", body, "/", extracted), func(t *testing.T) {
					pattern, value := "Boom", "subject.payload"
					if extracted {
						pattern, value = "Boom(let item)", "item.payload"
					}
					source := fmt.Sprintf("%s Boom{%s};export function f(subject:{_tag:\"Boom\";payload:7}|{_tag:\"Other\";payload:9}){return match(subject){when %s:%s;when {_tag:\"Other\"}:subject.payload;}}", kind, body, pattern, value)
					if ds := errorsOf(t, source); len(ds) != 0 {
						t.Errorf("tag coverage lost through an instance member: %v\n%s", ds, source)
					}
				})
			}
		}
	}
}

func TestWrittenErrorInstanceMemberMatcher(t *testing.T) {
	for _, test := range []struct {
		name, extra string
		want        int
	}{
		{"method", "label():number{return 1}", 1},
		{"getter", "get label():number{return 1}", 1},
		{"field", "label=1", 1},
		{"setter", "set label(value:number){}", 1},
		{"static-override", "static [customMatcher](_subject:unknown){return [1,2] as const};label():number{return 1}", 0},
		{"static-code", "static {Object.defineProperty(this,customMatcher,{value:()=>[1,2]})};label():number{return 1}", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			source := `import {$schemaErrorMatcher as install,customMatcher} from "vibelang-runtime";class Boom {readonly _tag="Boom" as const;static {install(this,"Boom",true)};` + test.extra + `};export function f(subject:unknown){return match(subject){when Boom():1;default:0;}}`
			program, file, _, _ := editorProgram(t, source)
			count := 0
			for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Code() == EK0703.Code {
					count++
				} else if d.Category() == diagnostics.CategoryError {
					t.Error(d.String())
				}
			}
			if count != test.want {
				t.Errorf("got %d EK0703, want %d\n%s", count, test.want, source)
			}
		})
	}
}
