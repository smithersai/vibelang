package vibelang

import (
	"testing"
)

func TestNativeTryPlacement(t *testing.T) {
	for _, test := range []struct {
		name, source string
		count        int
	}{
		{"witness", "effect function f() { try { return 1 } catch { return 2 } }", 1},
		{"finally", "effect function f() { try { return 1 } finally {} }", 1},
		{"newline", "effect function f() { try\n{} catch {} finally {} }", 1},
		{"block", "const f = effect { try {} catch {} }", 1},
		{"arrow", "const f = effect () => { try {} catch {} }", 1},
		{"method", "class C { effect f() { try {} catch {} } }", 1},
		{"producer", "effect function* f() { try {} finally {}; yield 1 }", 1},
		{"plain", "function f() { try { return 1 } catch { return 2 } }", 0},
		{"nested plain", "effect function f() { function g() { try {} catch {} }; return 1 }", 0},
		{"plain generator", "function* f() { try { yield 1 } finally {} }", 0},
		{"async", "async function f() { try {} finally {} }", 0},
		{"nested effect", "function f() { const g = effect () => { try {} finally {} }; return g }", 1},
		{"computed class key", "effect function f() { class C { [do { try {} finally {}; \"key\" }]() {} } }", 1},
		{"class heritage", "effect function f() { class C extends (do { try {} finally {}; Object }) {} }", 1},
		{"class field", "effect function f() { class C { value = do { try {} finally {}; 1 } } }", 0},
		{"class static block", "effect function f() { class C { static { try {} finally {} } } }", 0},
		{"enum member", "effect function f() { enum E { Value = do { try {} finally {}; 1 } } }", 0},
		{"parameter default", "effect function f(value = do { try {} finally {}; 1 }) {}", 0},
		{"do expression", "effect function f() { const value = do { try {} finally {}; 1 } }", 1},
		{"synthesized binding close", "effect function f(values: Iterable<number | undefined>) { const [x = do { return 1; 1 }] = values; return x }", 0},
		{"synthesized binding close in loop", "effect function f(values: Iterable<number | undefined>) { outer: for (let i = 0; i < 2; i++) { const [x = do { if(i) return 1; return 1; 1 }] = values; return x }; return 0 }", 0},
		{"written try in binding default", "effect function f(values: Iterable<number | undefined>) { const [x = do { try {} finally {}; return 1; 1 }] = values; return x }", 1},
		{"commented keyword", "effect function f() { try /* keyword */\n{} finally {} }", 1},
		{"try operator", "effect function f() { return try Effect.succeed(1) }", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			count := 0
			for _, d := range errorsOf(t, test.source) {
				if d.Code() == 503 {
					count++
				} else {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			if count != test.count {
				t.Fatalf("EK0503 count %d; want %d", count, test.count)
			}
		})
	}
}
