package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestProducerCompatibleCallbacksRegression(t *testing.T) {
	w := NewWorkspace(t)
	stream := "/** @throws {never} */ export declare function take(f:()=>Stream.Stream<number>):number;"
	generator := "/** @throws {never} */ export declare function take(f:()=>Generator<number,void,unknown>):number;"
	for _, api := range []struct {
		key, source string
		accept      bool
	}{
		{"stream-first", stream + generator, true},
		{"generator-first", generator + stream, true},
		{"union", "/** @throws {never} */ export declare function take(f:(()=>Stream.Stream<number>)|(()=>Generator<number,void,unknown>)):number;", true},
		{"stream-only", stream, true},
		{"generator-only", generator, false},
	} {
		for _, home := range []string{"inline", "named", "alias"} {
			t.Run(api.key+"/"+home, func(t *testing.T) {
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
				r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "api.ts": "import {Stream} from \"effect\";" + api.source}})
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
				if (len(codes) == 0) != api.accept {
					t.Fatalf("accept=%t, got %v\n%s\n%s", api.accept, codes, source, api.source)
				}
				if !api.accept && (len(codes) != 1 || (codes[0] != 1002 && codes[0] != 2345)) {
					t.Fatalf("native generator rejection: %v", codes)
				}
			})
		}
	}
}
