package vibelangfuzz

import (
	"context"
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const concurrentReturnSitesQuote = "`return` targeting the enclosing function in head binding initialization or the body: `for concurrent (const x of xs) { return x }`"

const concurrentNativeDiagnosticsQuote = "ordinary TypeScript syntax keeps its own diagnostics."

func TestConcurrentReturnSitesQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", concurrentReturnSitesQuote)
	chapterSays(t, "001-functions.md", concurrentNativeDiagnosticsQuote)
}

func FuzzConcurrentReturnSites(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", concurrentReturnSitesQuote)
	chapterSays(f, "001-functions.md", concurrentNativeDiagnosticsQuote)
	type site struct {
		key, body  string
		warn       bool
		nativeCode int32
	}
	var sites []site
	for _, home := range []string{"body", "head"} {
		for _, shape := range []string{"do", "object-method", "class-method", "class-field-key", "heritage", "getter"} {
			for depth := 0; depth < 3; depth++ {
				key := "do { if (flag) return \"m\" as const; \"m\" as const }"
				for i := 0; i < depth; i++ {
					key = "do { (" + key + "); \"m\" as const }"
				}
				var body string
				switch shape {
				case "do":
					body = "const value = " + key
				case "object-method":
					body = "const value = {[" + key + "]() { return 1 }}"
				case "class-method":
					body = "class Value {[" + key + "]() { return 1 }}"
				case "class-field-key":
					body = "class Value {[(" + key + ") as \"m\"] = 1}"
				case "heritage":
					heritage := "do { if (flag) return (class {}); (class {}) }"
					for i := 0; i < depth; i++ {
						heritage = "do { (" + heritage + "); (class {}) }"
					}
					body = "class Value extends (" + heritage + ") {}"
				case "getter":
					body = "const value = {get [" + key + "]() { return 1 }}"
				}
				if home == "head" {
					body = "for concurrent (const { x = do { " + body + "; 0 } } of rows) {}"
				} else {
					body = "for concurrent (const x of [1]) { " + body + " }"
				}
				nativeCode := int32(0)
				if shape == "class-field-key" {
					// A call in a field key also has native TS1166, even with
					// a literal assertion (stock TypeScript5.9.3 control).
					nativeCode = 1166
				}
				sites = append(sites, site{fmt.Sprintf("%s-%s-%d", home, shape, depth), body, true, nativeCode})
			}
		}
	}
	for _, control := range []struct{ key, body string }{
		{"arrow", "const value = () => { return 7 }"},
		{"method", "const value = { m() { return 7 } }"},
		{"own-do", "const value = () => { const x = do { if (flag) return 7; 1 }; return x }"},
		{"class-method", "class Value { m() { return 7 } }"},
		{"key-value", "const value = { [(do { \"m\" })]() { return 7 } }"},
		{"heritage-value", "class Value extends (do { (class {}) }) { m() { return 7 } }"},
	} {
		sites = append(sites, site{"control-" + control.key, "for concurrent (const x of [1]) { " + control.body + " }", false, 0})
	}
	sites = append(sites,
		site{"control-field-entity", "for concurrent (const x of [1]) { const key = \"m\" as const; class Value { [key] = 1 } }", false, 0},
		site{"control-field-do", "for concurrent (const x of [1]) { class Value { [(do { \"m\" as const })] = 1 } }", false, 1166},
	)
	keys := make([]string, len(sites))
	for i, s := range sites {
		keys[i] = s.key
		f.Add([]byte(s.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, _ := keyedChoice(keys, data)
		s := sites[choice]
		source := "const rows: { x?: number }[] = [{}]; export effect function main(flag: boolean) { " + s.body + "; return 0 }"
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		wanted, native, other := 0, 0, 0
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == 1904 {
				wanted++
			} else if !IsEK(d) && d.Code() == s.nativeCode {
				native++
			} else {
				other++
			}
		}
		expected := 0
		if s.warn {
			expected = 1
		}
		expectedNative := 0
		if s.nativeCode != 0 {
			expectedNative = 1
		}
		if wanted != expected || native != expectedNative || other != 0 {
			Gap(t, "FuzzConcurrentReturnSites", "destination:"+s.key, "%s; %s; want EK1904 x%d and native TS%d x%d with no other error, got %v\n%s", concurrentReturnSitesQuote, concurrentNativeDiagnosticsQuote, expected, s.nativeCode, expectedNative, Keys(r.Dir, r.Diagnostics), source)
		}
		ExpectPending(t, "FuzzConcurrentReturnSites", "destination:"+s.key)
		ExpectPending(t, "FuzzConcurrentReturnSites", specCorpusKey(t))
	})
}
