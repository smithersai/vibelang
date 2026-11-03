package vibelang

import "testing"

func TestInterruptionPlacementSourceExpressions(t *testing.T) {
	for _, test := range []struct {
		source string
		code   int32
	}{
		{"effect function f() { const o = { [do { uninterruptible { }; \"m\" }]() {} } }", 0},
		{"effect function f() { class C { [do { interruptible { }; \"m\" }]() {} } }", 0},
		{"effect function f() { class C extends do { uninterruptible { }; (class {}) } {} }", 0},
		{"effect function f() { enum E { A = do { uninterruptible { }; 1 } } }", 2201},
	} {
		t.Run(test.source, func(t *testing.T) {
			errors := errorsOf(t, test.source)
			if test.code == 0 && len(errors) != 0 || test.code != 0 && (len(errors) != 1 || errors[0].Code() != test.code) {
				t.Fatalf("want code %d, got %v", test.code, errors)
			}
		})
	}
}
