package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
)

func TestVIPFiberIDNumberEquality(t *testing.T) {
	env := newVIPEnv(t)
	for _, mode := range []string{"top", "cause", "exit", "reasons"} {
		for _, test := range []struct {
			name, ids string
			want      []int
		}{
			{"special", "[NaN, Infinity, -Infinity, NaN]", []int{0, 1, 2, 0}},
			{"repeated", "[NaN, NaN, NaN, NaN]", []int{0, 0, 0, 0}},
			{"zero", "[0, -0, 1, 0]", []int{0, 0, 1, 0}},
			{"extremes", "[Number.MIN_VALUE, Number.MAX_VALUE, Number.MIN_VALUE]", []int{0, 1, 0}},
			{"finite", "[-7, 1e21, -7]", []int{0, 1, 0}},
		} {
			t.Run(mode+"/"+test.name, func(t *testing.T) {
				value := "Effect.failCause(cause)"
				switch mode {
				case "cause":
					value = "Effect.succeed(cause)"
				case "exit":
					value = "Effect.succeed(Exit.failCause(cause))"
				case "reasons":
					value = "Effect.succeed(cause.reasons)"
				}
				body := fmt.Sprintf(`import { Cause, Exit } from "effect"
const cause = Cause.fromReasons(%s.map(id => Cause.makeInterruptReason(id)))
export const main = () => %s`, test.ids, value)
				outcome := env.runVIPModule(t, "fiber-numbers-"+mode+"-"+test.name, body)
				if outcome.Kind != "exit" {
					t.Fatalf("native reference did not end: %+v", outcome)
				}
				encoded, err := CanonicalVIPExit(outcome.Exit)
				if err != nil {
					t.Fatal(err)
				}
				var tree any
				if err = json.Unmarshal([]byte(encoded), &tree); err != nil {
					t.Fatal(err)
				}
				var ids []int
				var visit func(any)
				visit = func(value any) {
					switch value := value.(type) {
					case map[string]any:
						if id, ok := value["$fiber"]; ok && len(value) == 1 {
							ids = append(ids, int(id.(float64)))
							return
						}
						for _, key := range mapKeys(value) {
							visit(value[key])
						}
					case []any:
						for _, value := range value {
							visit(value)
						}
					}
				}
				visit(tree)
				if !reflect.DeepEqual(ids, test.want) {
					t.Fatalf("native fiber equality lost: got %v, want %v; %s", ids, test.want, encoded)
				}
			})
		}
	}
}
