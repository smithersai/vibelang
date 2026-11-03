package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const wholeServiceShapeTarget = "FuzzWholeServiceShapeDeclaration"
const wholeServiceShapeQuote = "the TypeScript type annotation supplies the exact Shape"
const wholeServiceShapeNoNamespaceQuote = "This form adds no shape helper and no namespace"

func TestWholeServiceShapeDeclarationQuoted(t *testing.T) {
	for _, quote := range []string{wholeServiceShapeQuote, wholeServiceShapeNoNamespaceQuote} {
		if !strings.Contains(SpecText("005-services.md"), quote) {
			t.Fatalf("VIP-9 whole-shape authority changed: %q", quote)
		}
	}
}
func FuzzWholeServiceShapeDeclaration(f *testing.F) {
	startShortBudget(f)
	keys := []string{"interface", "generic", "intersection", "primitive", "callable", "unknown", "empty", "array", "union"}
	for _, key := range keys {
		for variant := uint8(0); variant < 4; variant++ {
			f.Add(key, variant)
		}
	}
	f.Add("alchemy-database-whole-shape", uint8(0))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestWholeServiceShapeDeclarationQuoted(t)

		valid := key == "alchemy-database-whole-shape"
		for _, known := range keys {
			if key == known {
				valid = true
				break
			}
		}
		if !valid {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		prefix := "import { Context } from \"effect\"\n"
		shape, head, value := "Shape", "", "{value:7}"
		switch key {
		case "interface":
			head = "interface Shape { readonly value:number }"
		case "generic":
			head = "type Shape<A>={readonly value:A}"
			shape = "Shape<number>"
		case "intersection":
			head = "type A={readonly value:number};type B={readonly flag:boolean}"
			shape = "A & B"
			value = "{value:7,flag:true}"
		case "primitive":
			shape = "number"
			value = "7"
		case "callable":
			head = "type Shape=()=>number"
			value = "()=>7"
		case "unknown":
			shape = "unknown"
			value = "undefined"
		case "empty":
			head = "type Shape={}"
			value = "{}"
		case "array":
			shape = "ReadonlyArray<number>"
			value = "[1,2]"
		case "union":
			head = "type Shape={readonly value:number}|{readonly text:string}"
		case "alchemy-database-whole-shape":
		default:
			if key == "" {
				return
			}
			return
		}
		variant %= 4
		prefix += head + "\n"
		body := "static readonly key=\"alchemy/Port\""
		native := "export class Port extends Context.Service<Port," + shape + ">()(\"alchemy/Port\") {}"
		if variant&1 != 0 {
			body += "; static readonly defaultValue:()=>" + shape + "=()=>(" + value + ")"
			native = "export const Port=Context.Reference<" + shape + ">(\"alchemy/Port\",{defaultValue:()=>(" + value + ")})"
		}
		vibe := "export service Port:" + shape + " { " + body + " }"
		if variant&2 != 0 {
			vibe = "export namespace Library { " + vibe + " }"
			native = "export namespace Library { " + native + " }"
		}
		vibe, native = prefix+vibe+"\n", prefix+native+"\n"
		if key == "alchemy-database-whole-shape" {
			data, err := os.ReadFile(filepath.Join("testdata", "whole-service-shape", "alchemy-database-whole-shape.vibe"))
			if err != nil {
				t.Fatal(err)
			}
			vibe = string(data)
			native = "import {Context} from \"effect\"\ninterface Shape {readonly value:number}\nexport class Port extends Context.Service<Port,Shape>()(\"BetterAuth.Database\") {}\n"
		}
		label := fmt.Sprintf("%s/%d", key, variant)
		outputs := [2]string{}
		for i, source := range []string{native, vibe} {
			file := "main.ts"
			if i == 1 {
				file = "main.vibe"
			}
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source}})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			if !toolsErrorFree(result) {
				Gap(t, wholeServiceShapeTarget, "compile:"+label, "VIP-9: %s; errors%v\n%s", wholeServiceShapeQuote, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
				return
			}
			text, ok := result.Outputs["out/main.d.ts"]
			if !ok {
				t.Fatal("missing declaration")
			}
			outputs[i] = text
		}
		if outputs[0] != outputs[1] {
			Gap(t, wholeServiceShapeTarget, "declaration:"+label, "VIP-9: %s; native:\n%s\nwhole-shape:\n%s", wholeServiceShapeNoNamespaceQuote, outputs[0], outputs[1])
		}
		if strings.Contains(outputs[1], "namespace Port") || strings.Contains(outputs[1], "Port_shape") {
			Gap(t, wholeServiceShapeTarget, "extra-shape:"+label, "VIP-9: %s:\n%s", wholeServiceShapeNoNamespaceQuote, outputs[1])
		}
	})
}
