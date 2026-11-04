package vibelangfuzz

import (
	"fmt"
	"regexp"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangfuzz/vipgen"
)

// Accepted-program differentials obey the same source admission rule as
// handwritten VibeLang. Retired var syntax belongs in FuzzVarDenial.
func TestVIPLoopHeadsAdmittedBindingsQuoted(t *testing.T) {
	requireVarDenialQuotes(t)
	legacy := regexp.MustCompile(`\bvar\s`)
	check := func(t *testing.T, key string, payload []byte) {
		t.Helper()
		input := append(vipgen.Seed(key), payload...)
		p := vipgen.Generate(input, nil)
		if p == nil || p.Focus != key || !p.Plain {
			t.Fatal("lost keyed plain loop-head probe")
		}
		if source := vipgen.PrintVibe(p); legacy.MatchString(source) {
			t.Fatalf("%s: accepted-program generator emitted retired var syntax\n%s", varDenialQuote, source)
		}
	}
	for kind := range 2 {
		for declaration := range 4 {
			for shape := range 6 {
				if kind == 1 && shape != 1 {
					continue
				}
				for _, count := range []byte{0, 2} {
					for mutation := range 2 {
						for shadow := range 2 {
							t.Run(fmt.Sprintf("do/%d/%d/%d/%d/%d/%d", kind, declaration, shape, count, mutation, shadow), func(t *testing.T) {
								check(t, "vip02.do-loop-head-plain", []byte{0, 0, byte(kind), byte(declaration), byte(shape), count, byte(mutation), byte(shadow)})
							})
						}
					}
				}
			}
		}
	}
	for declaration := range 4 {
		for shape := range 7 {
			for _, count := range []byte{0, 2} {
				for jump := range 3 {
					for withDo := range 2 {
						t.Run(fmt.Sprintf("for-of/%d/%d/%d/%d/%d", declaration, shape, count, jump, withDo), func(t *testing.T) {
							check(t, "vip31.for-of-head-tdz-plain", []byte{0, 0, byte(declaration), byte(shape), count, byte(jump), 0, 0, byte(withDo)})
						})
					}
				}
			}
		}
	}
}
