package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const doUnreachableEntryQuote = "Its type is the union of the values reaching normal completion under ECMAScript's `UpdateEmpty` flow, including consumed local jumps."

func TestDoUnreachableEntryQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), doUnreachableEntryQuote) {
		t.Fatal("VIP-2 normal-completion type quote changed")
	}
}

// Dead enclosing code must not erase a do's locally normal completion type.
// The paired wrong annotation rejects any-valued or never-valued fallbacks.
func FuzzDoUnreachableEntry(f *testing.F) {
	startShortBudget(f)
	keys := []string{"return-number", "return-string", "stop-number", "stop-string", "throw-number", "throw-string", "branch-number", "branch-string"}
	for _, key := range keys {
		f.Add(key, byte(0))
		f.Add(key, byte(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestDoUnreachableEntryQuoted(t)
		if !strings.Contains("|"+strings.Join(keys, "|")+"|", "|"+key+"|") || key == "" {
			key = keys[int(variant)%len(keys)]
		}
		parts := strings.Split(key, "-")
		before := "return 'early';"
		switch parts[0] {
		case "stop":
			before = "stop();"
		case "throw":
			before = "try { raise(); } catch {} return 'early';"
		case "branch":
			before = "if (flag) return 'early'; else stop();"
		}
		value, read, wrong := "7", "value.toFixed()", "string"
		if parts[1] == "string" {
			value, read, wrong = "'seven'", "value.toUpperCase()", "number"
		}
		body := value
		for range int(variant % 3) {
			body = "(do { " + body + " })"
		}
		prefix := "declare function stop(): never; declare function raise(): never; export function check(flag: boolean): string { " + before
		source := prefix + " const value = do { " + body + " }; return " + read + " }"
		codes := doContextualNegativeCodes(t, w, "main.vibe", source)
		if fmt.Sprint(codes) != "[]" {
			Gap(t, "FuzzDoUnreachableEntry", key+":read", "%s; unexpected %v\n%s", doUnreachableEntryQuote, codes, source)
		}
		source = prefix + " const value: " + wrong + " = do { " + body + " }; return 'end' }"
		codes = doContextualNegativeCodes(t, w, "main.vibe", source)
		if fmt.Sprint(codes) != "[TS2322]" {
			Gap(t, "FuzzDoUnreachableEntry", key+":wrong-type", "%s; want TS2322, got %v\n%s", doUnreachableEntryQuote, codes, source)
		}
	})
}
