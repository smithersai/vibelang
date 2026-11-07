package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFixCallTimeDefaults(t *testing.T) {
	for _, call := range []struct{ key, text string }{
		{"intrinsic", "JSON.parse(text)"},
		{"foreign", "native.load(7)"},
		{"constructor", "new native.Box(7)"},
	} {
		for _, binding := range []string{"simple", "destructured"} {
			for _, kind := range []string{"effect", "arrow", "method", "producer", "producer-method", "factory", "stream-factory"} {
				t.Run(call.key+"/"+binding+"/"+kind, func(t *testing.T) {
					parameters := "text:string,value=" + call.text
					if binding == "destructured" {
						parameters = "text:string,{value=" + call.text + "}:{value?:unknown}={}"
					}
					source := ""
					switch kind {
					case "effect":
						source = "export effect function read(" + parameters + "){return value}"
					case "arrow":
						source = "export const read=effect(" + parameters + ")=>{return value}"
					case "method":
						source = "export const holder={effect read(" + parameters + "){return value}}"
					case "producer":
						source = "export effect function* read(" + parameters + "){yield value}"
					case "producer-method":
						source = "export const holder={effect *read(" + parameters + "){yield value}}"
					case "factory":
						source = "export function read(" + parameters + "):Effect.Effect<unknown>{return Effect.succeed(value)}"
					case "stream-factory":
						source = "export function read(" + parameters + "){return Stream.succeed(value)}"
					}
					_, file, _, _ := editorProgram(t, "import * as native from \"./native.js\";"+source)
					native := "/** @throws {unknown} */\nexport function load(n:number):number{return n}\nexport class Box{\n/** @throws {Error} */\nconstructor(readonly n:number){}\n}\n"
					if err := os.WriteFile(filepath.Join(filepath.Dir(file.FileName().AsString()), "native.ts"), []byte(native), 0600); err != nil {
						t.Fatal(err)
					}
					result := fixCase(t, filepath.Dir(file.FileName().AsString()))
					if result.Err != nil {
						t.Fatal(result.Err)
					}
					fixed := result.Files[file.FileName()]
					if fixed == nil || !strings.Contains(fixed.Text, "$default(") || !strings.Contains(fixed.Text, "get value(): A") || len(result.Sites) != 0 {
						t.Fatalf("missing call-time default boundary: %+v", result)
					}
				})
			}
		}
	}
}

func TestFixCallTimeDefaultsReuse(t *testing.T) {
	_, file, _, _ := editorProgram(t, "export effect function read(a=JSON.parse(\"1\"),b=JSON.parse(\"2\")){return [a,b]}")
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	fixed := result.Files[file.FileName()]
	if fixed == nil || strings.Count(fixed.Text, "export function $default<") != 1 || len(result.Sites) != 0 {
		t.Fatalf("default helper not reused: %+v", result)
	}
}

func TestFixCallTimeDefaultsRefuseScopeChanges(t *testing.T) {
	for _, source := range []string{
		"export effect function read(value=JSON.parse(eval(\"'1'\"))){return value}",
		"export function read():Effect.Effect<unknown>{return Effect.succeed(JSON.parse(\"1\"))}",
	} {
		_, file, _, _ := editorProgram(t, source)
		result := fixCase(t, filepath.Dir(file.FileName().AsString()))
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		if len(result.Sites) == 0 {
			t.Fatalf("missing scope refusal: %+v", result)
		}
		if fixed := result.Files[file.FileName()]; fixed != nil && strings.Contains(fixed.Text, "$default(") {
			t.Fatalf("call moved out of its scope: %s", fixed.Text)
		}
	}
}

func TestFixCallTimeDefaultsInsideFlatMap(t *testing.T) {
	source := "export const main=(s:string)=>Effect.flatMap(Effect.void,(v=JSON.parse(s))=>Effect.succeed(v))"
	_, file, _, _ := editorProgram(t, source)
	result := fixCase(t, filepath.Dir(file.FileName().AsString()))
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	fixed := result.Files[file.FileName()]
	if fixed == nil || len(result.Sites) != 0 || !strings.Contains(fixed.Text, "$default(") || !strings.Contains(fixed.Text, "Effect.flatMap(Effect.void") {
		t.Fatalf("callback default lost its invocation boundary: %+v", result)
	}
}
