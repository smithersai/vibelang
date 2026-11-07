package vibelang

import (
	"strings"
	"testing"
)

func TestEffectFnElidedParameters(t *testing.T) {
	for _, shape := range []struct{ key, parameter, result string }{
		{"plain", "[,n]:number[]", "n"},
		{"nested", "{p:[,n]}:{p:number[]}", "n"},
		{"default", "[,n]:number[]=[0,7]", "n"},
		{"only", "[,]:number[]", "7"},
		{"rest", "[, ...n]:number[]", "n"},
		{"second", "head:number,[,n]:number[]", "n"},
		{"trailing", "[,n,]:number[]", "n"},
	} {
		for _, callee := range []string{"Effect.fn", "Effect.fn(\"read\")", "Effect.fnUntraced"} {
			t.Run(shape.key+"/"+callee, func(t *testing.T) {
				defer func() {
					if value := recover(); value != nil {
						t.Errorf("valid array parameter crashed migration: %v", value)
					}
				}()
				source := "import {Effect} from \"effect\";export const read=" + callee + "(function*(" + shape.parameter + "){return " + shape.result + "})"
				r, name := fixSourceOptions(t, source, FixOptions{})
				if r.Err != nil {
					t.Fatal(r.Err)
				}
				fixed := r.Files[name]
				if callee == "Effect.fn(\"read\")" {
					text := source
					if fixed != nil {
						text = fixed.Text
					}
					originalCall := source[strings.Index(source, callee):]
					if !strings.Contains(text, originalCall) {
						t.Fatalf("unsupported named binding changed: %s", text)
					}
				} else if fixed == nil || len(r.Sites) != 0 || strings.Contains(fixed.Text, "function*") {
					t.Fatalf("array binding did not migrate: %+v", r)
				}
			})
		}
	}
}
func TestEffectFnElidedPipelineStaysNative(t *testing.T) {
	source := "import {Effect} from \"effect\";export const read=Effect.fn(function*([,n]:number[]){return n},Effect.orDie)"
	defer func() {
		if value := recover(); value != nil {
			t.Errorf("unsupported pipeline crashed instead of refusing: %v", value)
		}
	}()
	r, name := fixSourceOptions(t, source, FixOptions{})
	if r.Err != nil {
		t.Fatal(r.Err)
	}
	text := source
	if fixed := r.Files[name]; fixed != nil {
		text = fixed.Text
	}
	originalCall := source[strings.Index(source, "Effect.fn("):]
	if !strings.Contains(text, originalCall) {
		t.Fatalf("unsupported staged binding changed: %s", text)
	}
}
