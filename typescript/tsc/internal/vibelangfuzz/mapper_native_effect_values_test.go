package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
	"regexp"
	"strings"
	"testing"
)

func FuzzMapperNativeEffectValues(f *testing.F) {
	startShortBudget(f)
	const quote = "The non-function value exports are globals too"
	if !strings.Contains(SpecText("005-services.md"), quote) {
		f.Fatal("native Effect globals quote changed")
	}
	for _, name := range []string{"interrupt", "yieldNow"} {
		for shape := uint8(0); shape < 4; shape++ {
			f.Add(name, shape)
		}
	}
	f.Fuzz(func(t *testing.T, name string, shape uint8) {
		if name != "interrupt" && name != "yieldNow" {
			name = "yieldNow"
		}
		source := "export const value = " + name
		switch shape % 4 {
		case 1:
			source = "const selected = " + name + "; export const value = selected"
		case 2:
			source = "const " + name + " = 7; export const value = " + name
		case 3:
			source = "function local(" + name + ": number) { return " + name + " }; export const value = " + name
		}
		source = strings.Repeat("/* native value */\n", int(shape)%3) + source
		js, _, diags := vibelangmapper.Emit(source, vibelangmapper.FileContext{})
		if len(diags) != 0 {
			t.Fatalf("%s: %v", quote, diags)
		}
		if shape%4 != 2 && !strings.Contains(js, "effect/Effect") {
			Gap(t, "FuzzMapperNativeEffectValues", fmt.Sprintf("%s/%d", name, shape%4), "%s: lost native import\n%s", quote, js)
		}
		retiredBinding := regexp.MustCompile(`(?m)^import[^;\n]*\b` + name + `\b[^;\n]*["\x27]vibelang-runtime["\x27]`)
		if retiredBinding.MatchString(js) {
			Gap(t, "FuzzMapperNativeEffectValues", fmt.Sprintf("%s/%d", name, shape%4), "%s: imported a retired runtime factory\n%s", quote, js)
		}
	})
}
