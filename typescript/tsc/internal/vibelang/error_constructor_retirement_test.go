package vibelang

import "testing"

func TestErrorConstructorDiagnosticRetired(t *testing.T) {
	if registry[2118] != nil {
		t.Fatal("retired subclass constructor diagnostic EK2118 remains registered")
	}
}
