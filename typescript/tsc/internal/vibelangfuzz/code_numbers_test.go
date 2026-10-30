package vibelangfuzz

import (
	"slices"
	"testing"
)

func TestDiagnosticCodesKeepFullOrdinal(t *testing.T) {
	for _, test := range []struct {
		name, text string
		want       []int32
	}{
		{"four digits", "error EK0101: syntax; warning EK3801: lint", []int32{101, 3801}},
		{"growing ordinals", "EK3810 EK38100 EK381000 EK38108 EK38100", []int32{3810, 38100, 381000, 38108}},
		{"encounter order", "EK0042 EK38100 EK0001 EK0042", []int32{42, 38100, 1}},
		{"not printed codes", "TS38100 EK123 EK38108suffix EK38108_name", nil},
		{"integer domain", "EK0001 EK2147483647 EK2147483648 EK999999999999999999999999999", []int32{1, 2147483647}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := codesIn(test.text); !slices.Equal(got, test.want) {
				t.Fatalf("codesIn(%q) = %v, want %v", test.text, got, test.want)
			}
		})
	}
}
