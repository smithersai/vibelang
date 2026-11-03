package vibelang

import "testing"

// VIP-1 chooses a function's kind from its keyword; the removed implicit
// native factory-body implementation no longer reports EK2116. EK2115
// remains in the stock TypeScript mapper and must stay registered.
func TestFactoryDiagnosticRegistrationsRetired(t *testing.T) {
	for _, code := range []int32{2116} {
		if m := registry[code]; m != nil {
			t.Errorf("%s remains registered after its reporting path was removed", m)
		}
	}
	for _, code := range []int32{2115, 2109, 2117, 9205} {
		if registry[code] == nil {
			t.Errorf("retiring factory diagnostics also removed neighboring EK%04d", code)
		}
	}
}
