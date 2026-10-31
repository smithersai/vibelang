package vibelangfuzz

import (
	"slices"
	"testing"
)

// TestToolsContracts checks the names toolsContractMismatch imports: a
// default-exported function is read as `default`, named or not.
func TestToolsContracts(t *testing.T) {
	for _, c := range []struct {
		dts  string
		want []string
	}{
		{"export default function main(x: number): number;\nexport declare function f(): void;\n", []string{"default", "f"}},
		{"export default function (x: number): number;\n", []string{"default"}},
		{"export declare const g: () => number;\n", []string{"g"}},
	} {
		if got := toolsContracts(c.dts); !slices.Equal(got, c.want) {
			t.Errorf("toolsContracts(%q) = %v, want %v", c.dts, got, c.want)
		}
	}
}
