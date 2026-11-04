package vibelang

import (
	"fmt"
	"regexp"
	"strings"
	"testing"
)

func checkCallTimeEffectBodyName(t *testing.T, kind, name string) {
	t.Helper()
	body := "{ try Effect.yieldNow; return value }"
	var source string
	switch kind {
	case "declaration":
		source = "export effect function " + name + "(value: number) " + body
	case "arrow":
		source = "export const " + name + " = effect (value: number) => " + body
	case "expression":
		source = "export const exported = effect function " + name + "(value: number) " + body
	case "recursive":
		source = "export const exported = effect function " + name + "(value: number): number!! { try Effect.yieldNow; if (value > 0) return try " + name + "(value - 1); return value }"
	case "method":
		source = "export const holder = { effect " + name + "(value: number) " + body + " }"
	case "shadow":
		source = "export effect function " + name + "(" + name + ": number) { try Effect.yieldNow; return " + name + " }"
	default:
		t.Fatalf("unknown frame fixture %q", kind)
	}
	program, _, _, _ := editorProgram(t, source)
	var js string
	for _, text := range emittedJS(t, program) {
		js += text
	}
	frame := regexp.MustCompile("(function\\* |\\*)" + regexp.QuoteMeta(name) + "\\(\\)")
	if !frame.MatchString(js) {
		t.Fatalf("%s must keep source frame %s without rebinding parameters:\n%s", kind, name, js)
	}
	if kind == "recursive" && strings.Contains(js, "function* "+name+"(") {
		t.Fatalf("recursive frame must not shadow its source callable:\n%s", js)
	}
}

func TestCallTimeEffectBodyNames(t *testing.T) {
	for _, kind := range []string{"declaration", "arrow", "expression", "recursive", "method", "shadow"} {
		t.Run(kind, func(t *testing.T) { checkCallTimeEffectBodyName(t, kind, "load") })
	}
}

// Exercise the debugger frame contract across source callable kinds and names.
func FuzzCallTimeEffectBodyNames(f *testing.F) {
	kinds := []string{"declaration", "arrow", "expression", "recursive", "method", "shadow"}
	for i, kind := range kinds {
		f.Add(kind, byte(i))
	}
	f.Fuzz(func(t *testing.T, kind string, choice byte) {
		if !strings.Contains("|"+strings.Join(kinds, "|")+"|", "|"+kind+"|") || kind == "" {
			kind = kinds[int(choice)%len(kinds)]
		}
		checkCallTimeEffectBodyName(t, kind, fmt.Sprintf("load%d", choice))
	})
}
