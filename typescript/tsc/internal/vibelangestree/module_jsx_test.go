package vibelangestree

import (
	"strings"
	"testing"
)

func TestNativeModuleJSXTree(t *testing.T) {
	for _, name := range []string{"view", ""} {
		for _, expression := range []string{"<div />", "<><button onClick={() => process.cwd()} /></>"} {
			text := "module " + name + " { export const view = " + expression + " }\n"
			tree := parse(t, "/view.vibex", text)
			modules := find(tree, "VibeModuleDeclaration")
			if len(modules) != 1 {
				t.Fatalf("got %d native module declarations", len(modules))
			}
			body := modules[0]["body"].(map[string]any)
			elements := find(body, "JSXElement")
			if len(elements) != 1 {
				t.Fatalf("got %d JSX elements in native body", len(elements))
			}
			if got := sourceOf(text, elements[0]); !strings.HasPrefix(got, "<") || !strings.HasSuffix(got, "/>") {
				t.Fatalf("JSX range lost source identity: %q", got)
			}
			if strings.Contains(expression, "=>") && len(find(body, "ArrowFunctionExpression")) != 1 {
				t.Fatal("native JSX callback is missing")
			}
			if _, failure := Parse("/view.vibe", text); failure == nil {
				t.Fatal("a non-JSX native body accepted JSX")
			}
		}
	}
}
