package vibelangfmt

import (
	"strings"
	"testing"
)

func TestForConcurrentSingleLineBracedBody(t *testing.T) {
	dropBraces := func(text string) (string, error) {
		// Simulate dprint's default useBraces: "whenNotSingleLine" removing
		// braces from a one-statement single-line loop body.
		text = strings.ReplaceAll(text, ") { void Console.log(id) }", ") void Console.log(id)")
		text = strings.ReplaceAll(text, ") { if (x > 1) continue }", ") if (x > 1) continue")
		return text, nil
	}
	addBraces := func(text string) (string, error) {
		text = strings.ReplaceAll(text, ") void Console.log(id)", ") { void Console.log(id) }")
		return text, nil
	}

	cases := []struct {
		name      string
		source    string
		formatter TypeScriptFormatter
		want      string
	}{
		{
			name: "for concurrent with limit drops single-line braces",
			source: `effect function e(ids: Array<string>) {
  for concurrent(2) (const id of ids) { try Console.log(id) }
}
`,
			formatter: dropBraces,
			want: `effect function e(ids: Array<string>) {
  for concurrent(2) (const id of ids) try Console.log(id)
}
`,
		},
		{
			name: "for concurrent with if-continue drops single-line braces",
			source: `effect function e(xs: Array<number>) {
  for concurrent (const x of xs) { if (x > 1) continue }
}
`,
			formatter: dropBraces,
			want: `effect function e(xs: Array<number>) {
  for concurrent (const x of xs) if (x > 1) continue
}
`,
		},
		{
			name: "labeled for concurrent drops single-line braces",
			source: `effect function e(ids: Array<string>) {
  outer: for concurrent (const id of ids) { try Console.log(id) }
}
`,
			formatter: dropBraces,
			want: `effect function e(ids: Array<string>) {
  outer: for concurrent (const id of ids) try Console.log(id)
}
`,
		},
		{
			name: "unbraced for concurrent accepts added braces",
			source: `effect function e(ids: Array<string>) {
  for concurrent(2) (const id of ids) try Console.log(id)
}
`,
			formatter: addBraces,
			want: `effect function e(ids: Array<string>) {
  for concurrent(2) (const id of ids) { try Console.log(id) }
}
`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Format("main.vibe", tc.source, tc.formatter)
			if err != nil {
				t.Fatalf("Format failed: %v", err)
			}
			if got != tc.want {
				t.Fatalf("Format mismatch:\ngot:\n%s\nwant:\n%s", got, tc.want)
			}
			again, err := Format("main.vibe", got, tc.formatter)
			if err != nil {
				t.Fatalf("second Format failed: %v", err)
			}
			if again != got {
				t.Fatalf("not idempotent:\nfirst:\n%s\nsecond:\n%s", got, again)
			}
		})
	}
}
