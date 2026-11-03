package vibelangestree

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

// This oracle is typescript-estree 8.69.0 on TypeScript 5.9.3, not another
// mode of our converter. Refresh with test/eslint/jsx-golden.mjs.
func TestVibexJSXTypeScriptESTreeParity(t *testing.T) {
	data, err := os.ReadFile("testdata/jsx.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name     string
		Code     string
		Expected map[string]any
	}
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, f := range fixtures {
		t.Run(f.Name, func(t *testing.T) {
			tree := parse(t, "/fixture.vibex", f.Code)
			roots := []any{}
			var walk func(any)
			walk = func(value any) {
				switch v := value.(type) {
				case map[string]any:
					if v["type"] == "JSXElement" || v["type"] == "JSXFragment" {
						roots = append(roots, v)
						return
					}
					for key, child := range v {
						if key != "comments" && key != "tokens" {
							walk(child)
						}
					}
				case []any:
					for _, child := range v {
						walk(child)
					}
				}
			}
			walk(tree)
			actual := map[string]any{"roots": roots, "tokens": tree["tokens"], "comments": tree["comments"]}
			if !reflect.DeepEqual(actual, f.Expected) {
				got, _ := json.Marshal(actual)
				want, _ := json.Marshal(f.Expected)
				t.Fatalf("JSX differs from TypeScript-ESTree\ngot: %s\nwant: %s", got, want)
			}
		})
	}
}

func TestVibexJSXContainsVibeLangForms(t *testing.T) {
	text := "effect function View() { return <Box value={1 |> % + 1}>{try load()}{effect () => <b/>}</Box> }"
	tree := parse(t, "/View.vibex", text)
	for _, typ := range []string{"JSXElement", "JSXExpressionContainer", "VibePipeExpression", "TopicReference", "CallExpression"} {
		if len(find(tree, typ)) == 0 {
			t.Errorf("missing %s in JSX", typ)
		}
	}
	_, failure := Parse("/View.vibe", text)
	if failure == nil {
		t.Error(".vibe unexpectedly accepts JSX")
	}
	_, failure = Parse("/View.tsx", text)
	if failure == nil || !strings.Contains(failure.Message, "expected") {
		t.Errorf("TypeScript accepts VibeLang: %v", failure)
	}
}
