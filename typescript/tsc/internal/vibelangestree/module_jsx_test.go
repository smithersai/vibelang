package vibelangestree

import (
	"strings"
	"testing"
)

func TestNativeModuleJSXTree(t *testing.T) {
	for _, name := range []string{"view", ""} {
		for _, tc := range []struct{ expression, diagnostic string }{
			{"<div />", "'>' expected"},
			{"<><button onClick={() => process.cwd()} /></>", "Type expected"},
		} {
			text := "module " + name + " { export const view = " + tc.expression + " }\n"
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
			if strings.Contains(tc.expression, "=>") && len(find(body, "ArrowFunctionExpression")) != 1 {
				t.Fatal("native JSX callback is missing")
			}
			if _, failure := Parse("/view.vibe", text); failure == nil || !strings.Contains(failure.Message, tc.diagnostic) {
				t.Errorf("want %q in a non-JSX module, got %v", tc.diagnostic, failure)
			}
		}
	}
}
