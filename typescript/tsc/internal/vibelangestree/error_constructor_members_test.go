package vibelangestree

import (
	"fmt"
	"strings"
	"testing"
)

func TestPlainErrorConstructorPayloadRetainsSourceMembers(t *testing.T) {
	for _, field := range []string{"constructor: string", "constructor?: string", "readonly constructor: string", "code: string"} {
		for _, name := range []string{"label", "$label", "Δείγμα"} {
			for _, trivia := range []string{" ", "\n  ", " /* source */\n  "} {
				for _, getter := range []bool{false, true} {
					label := fmt.Sprintf("%s/%s/%q/getter=%t", field, name, trivia, getter)
					t.Run(label, func(t *testing.T) {
						prefix := ""
						if getter {
							prefix = "get "
						}
						read := "constructor"
						if strings.HasPrefix(field, "code:") {
							read = "code"
						}
						text := "// 😀 source offsets\nexport error Failure { " + field + ";" + trivia + prefix + name + "() { return this." + read + " } }\n"
						tree := parse(t, "test.vibe", text)
						var bodies, methods, fields int
						var methodStart int
						for _, node := range nodes(tree) {
							switch node["type"] {
							case "ClassBody":
								bodies++
								start, end := rangeOf(node)
								if got := utf16Slice(text, start, end); !strings.HasPrefix(got, "{") || !strings.HasSuffix(got, "}") {
									t.Errorf("class body must cover its written braces, got %q", got)
								}
							case "MethodDefinition":
								methods++
								key := node["key"].(map[string]any)
								if key["name"] != name {
									t.Errorf("method name %v, want %s", key["name"], name)
								}
								start, end := rangeOf(key)
								methodStart = start
								if got := utf16Slice(text, start, end); got != name {
									t.Errorf("method key source %q, want %q", got, name)
								}
								kind := "method"
								if getter {
									kind = "get"
								}
								if node["kind"] != kind {
									t.Errorf("kind %v, want %s", node["kind"], kind)
								}
							case "PropertyDefinition":
								fields++
								key := node["key"].(map[string]any)
								if key["name"] != read {
									t.Errorf("field name %v, want %s", key["name"], read)
								}
							}
						}
						if bodies != 1 || methods != 1 || fields != 1 {
							t.Fatalf("source class bodies=%d methods=%d fields=%d; want one each", bodies, methods, fields)
						}
						if methodStart == 0 {
							t.Fatal("method lost source position")
						}
					})
				}
			}
		}
	}
}
