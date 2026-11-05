package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestRethrowsConditionalAdmission(t *testing.T) {
	const library = "/** @throws {RangeError} */\nexport declare function risky(n:number):number\n/** @throws {never} */\nexport declare function safe(n:number):number\n/** @throws {never}\n * @rethrows cb\n */\nexport declare function invoke(cb:(n:number)=>number):number\n/** @throws {never} */\nexport declare function accepts(cb:(n:number)=>number):number\n"
	for _, ext := range []string{"ts", "d.ts"} {
		for _, shape := range []string{"flag ? risky : safe", "flag ? safe : risky", "(flag ? risky : safe)", "flag ? risky : (flag ? safe : risky)"} {
			for _, row := range []struct {
				key, host, before, after string
				code                     int32
			}{
				{"caught", "", "try {return invoke(", ")} catch {return 0}", 0},
				{"effect", "effect ", "return invoke(", ")", 403},
				{"plain", "", "return invoke(", ")", 401},
				{"non-rethrows", "", "return accepts(", ")", 402},
			} {
				t.Run(fmt.Sprintf("%s/%s/%s", ext, shape, row.key), func(t *testing.T) {
					source := "import {invoke,accepts,risky,safe} from './lib.js'\nexport " + row.host + "function probe(flag:boolean){" + row.before + shape + row.after + "}"
					program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: library})
					codes := []int32{}
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							codes = append(codes, d.Code())
						}
					}
					want := 0
					if row.code != 0 {
						want = 1
					}
					if row.code == 402 {
						want = strings.Count(shape, "risky")
					}
					if len(codes) != want {
						t.Fatalf("got %v, want %d occurrences of code %d", codes, want, row.code)
					}
					for _, code := range codes {
						if code != row.code {
							t.Fatalf("got %v, want only code %d", codes, row.code)
						}
					}
				})
			}
		}
	}
}

func TestRethrowsConditionalNullableAndSpread(t *testing.T) {
	for _, ext := range []string{"ts", "d.ts"} {
		for _, shape := range []struct{ key, parameter, call string }{
			{"optional", "cb?: (n:number)=>number", "invoke(flag?risky:undefined)"},
			{"undefined", "cb:((n:number)=>number)|undefined", "invoke(flag?risky:undefined)"},
			{"null", "cb:((n:number)=>number)|null", "invoke(flag?risky:null)"},
			{"nullish-undefined", "cb:((n:number)=>number)|null|undefined", "invoke(flag?risky:undefined)"},
			{"nullish-null", "cb:((n:number)=>number)|null|undefined", "invoke(flag?risky:null)"},
			{"tuple-prefix", "a:number,b:number,cb:(n:number)=>number", "invoke(...[1,2] as const,flag?risky:safe)"},
		} {
			lib := "/** @throws {RangeError} */\nexport declare function risky(n:number):number\n/** @throws {never} */\nexport declare function safe(n:number):number\n/** @throws {never}\n * @rethrows cb\n */\nexport declare function invoke(" + shape.parameter + "):number\n"
			for _, row := range []struct {
				key, host, prefix, suffix string
				code                      int32
			}{
				{"effect", "effect ", "return ", "", 403},
				{"plain", "", "return ", "", 401},
				{"caught", "", "try{return ", "}catch{return 0}", 0},
				{"wrapped", "effect ", "return try Effect.try(()=>", ")", 0},
			} {
				t.Run(ext+"/"+shape.key+"/"+row.key, func(t *testing.T) {
					source := "import {invoke,risky,safe} from './lib.js'\nexport " + row.host + "function probe(flag:boolean){" + row.prefix + shape.call + row.suffix + "}"
					program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib." + ext: lib})
					var codes []int32
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Category() == diagnostics.CategoryError {
							codes = append(codes, d.Code())
						}
					}
					want := 0
					if row.code != 0 {
						want = 1
					}
					if len(codes) != want || want == 1 && codes[0] != row.code {
						t.Fatalf("got %v, want code %d", codes, row.code)
					}
				})
			}
		}
	}
}
