package vibelang

import "testing"

func TestModuleRunDiagnosticRetired(t *testing.T) {
	if registry[1001] != nil {
		t.Fatal("VIP-26 replaced implicit module execution; EK1001 must not remain active")
	}
}
