package vibelang

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func TestGenericCallbackRethrows(t *testing.T) {
	for _, bound := range []string{"never", "RangeError"} {
		for _, binding := range []struct{ name, prefix, arg string }{
			{"direct", "", "reader.read"},
			{"alias", "const read=reader.read;", "read"},
			{"chain", "const first=reader.read;const read=first;", "read"},
			{"object", "const {read}=reader;", "read"},
			{"nested", "const {reader:{read}}=nested;", "read"},
		} {
			for _, invoke := range []string{"array", "foreign", "constructor", "tag"} {
				for _, plain := range []bool{false, true} {
					t.Run(fmt.Sprintf("%s/%s/%s/plain=%t", bound, binding.name, invoke, plain), func(t *testing.T) {
						lib := "export interface Reader<T>{\n/** @throws {T} */\nread(s:number):number\n}\nexport declare const reader:Reader<" + bound + ">\nexport declare const nested:{reader:Reader<" + bound + ">}\n" +
							"/** @throws {never}\n * @rethrows cb\n */\nexport declare function run(cb:(s:number)=>number):number\n" +
							"export declare class Invoke{\n/** @throws {never}\n * @rethrows cb\n */\nconstructor(cb:(s:number)=>number)}\n" +
							"/** @throws {never}\n * @rethrows cb\n */\nexport declare function tag(parts:TemplateStringsArray,cb:(s:number)=>number):number"
						call := "[1].map(" + binding.arg + ")"
						switch invoke {
						case "foreign":
							call = "run(" + binding.arg + ")"
						case "constructor":
							call = "new Invoke(" + binding.arg + ")"
						case "tag":
							call = "tag" + string(rune(96)) + "${" + binding.arg + "}" + string(rune(96))
						}
						effect := "effect "
						if plain {
							effect = ""
						}
						source := "import {reader,nested,run,Invoke,tag} from './lib.js';export " + effect + "function probe(){" + binding.prefix + "return " + call + "}"
						program, file, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.ts": lib})
						count := 0
						for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
							if d.Category() != diagnostics.CategoryError {
								continue
							}
							count++
							code := int32(403)
							if plain {
								code = 401
							}
							if bound == "never" || d.Code() != code || d.Source() != diagnosticSource {
								t.Errorf("unexpected diagnostic: %s", d.String())
							}
							if bound != "never" && !strings.Contains(d.String(), "RangeError") {
								t.Errorf("lost receiver substitution: %s", d.String())
							}
						}
						want := 0
						if bound != "never" {
							want = 1
						}
						if count != want {
							t.Errorf("got %d errors,want %d", count, want)
						}
					})
				}
			}
		}
	}
}

func TestGenericCallbackInferredReceiver(t *testing.T) {
	for _, reverse := range []bool{false, true} {
		left, right := "safe", "risky"
		if reverse {
			left, right = right, left
		}
		for _, alias := range []bool{false, true} {
			for _, invoke := range []string{"array", "foreign", "constructor", "tag"} {
				for _, plain := range []bool{false, true} {
					t.Run(fmt.Sprintf("reverse=%t/alias=%t/%s/plain=%t", reverse, alias, invoke, plain), func(t *testing.T) {
						lib := "export interface Reader<T>{\n/** @throws {T} */\nread(n:number):number\n}\nexport declare const safe:Reader<never>\nexport declare const risky:Reader<RangeError>\n" +
							"/** @throws {never}\n * @rethrows cb\n */\nexport declare function run(cb:(n:number)=>number):number\n" +
							"export declare class Invoke{\n/** @throws {never}\n * @rethrows cb\n */\nconstructor(cb:(n:number)=>number)}\n" +
							"/** @throws {never}\n * @rethrows cb\n */\nexport declare function tag(parts:TemplateStringsArray,cb:(n:number)=>number):number"
						binding := "const selected=flag?" + left + ":" + right + ";"
						arg := "selected.read"
						if alias {
							binding += "const read=selected.read;"
							arg = "read"
						}
						call := "[1].map(" + arg + ")"
						switch invoke {
						case "foreign":
							call = "run(" + arg + ")"
						case "constructor":
							call = "new Invoke(" + arg + ")"
						case "tag":
							call = "tag" + string(rune(96)) + "${" + arg + "}" + string(rune(96))
						}
						effect := "effect "
						if plain {
							effect = ""
						}
						source := "import {safe,risky,run,Invoke,tag} from './lib.js';export " + effect + "function probe(flag:boolean){" + binding + "return " + call + "}"
						p, f, _, _ := requirementIdentityProgram(t, source, map[string]string{"lib.ts": lib})
						count := 0
						for _, d := range p.GetSemanticDiagnostics(t.Context(), f) {
							if d.Category() != diagnostics.CategoryError {
								continue
							}
							count++
							code := int32(403)
							if plain {
								code = 401
							}
							if d.Code() != code || d.Source() != diagnosticSource {
								t.Errorf("unexpected diagnostic: %s", d.String())
							}
						}
						if count != 1 {
							t.Errorf("got %d errors,want one throwing-alternative rejection", count)
						}
					})
				}
			}
		}
	}
}
