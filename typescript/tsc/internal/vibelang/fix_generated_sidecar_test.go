package vibelang

import (
	"testing"
)

func TestEffectFnTypeHasImport(t *testing.T) {
	for text, want := range map[string]bool{
		`import("./media.vibe.throwing.js").Asset`: true,
		`{ asset: import("./media.vibe").Asset }`:  true,
		`typeof import("./media.vibe")`:            true,
		`"import('./media')"`:                      false,
		`{ import(): number }`:                     false,
		`ReturnType<typeof make>`:                  false,
	} {
		if got := effectFnTypeHasImport(text); got != want {
			t.Errorf("%s: %t, want %t", text, got, want)
		}
	}
}
