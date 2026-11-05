package vibelangfuzz

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func writeDeclarationTree(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, text := range files {
		if err := writeInside(dir, name, text); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestDeclarationIdentityDiffProbesOnlyDifferentBytes(t *testing.T) {
	base := map[string]string{"main.d.ts": "export declare const x: 1;\n", "nested/other.d.ts": "export {};\n"}
	cases := []struct {
		name  string
		after map[string]string
		probe bool
	}{
		{"same", base, false},
		{"changed byte", map[string]string{"main.d.ts": "export declare const x: 2;\n", "nested/other.d.ts": "export {};\n"}, true},
		{"missing file", map[string]string{"main.d.ts": base["main.d.ts"]}, true},
		{"extra file", map[string]string{"main.d.ts": base["main.d.ts"], "nested/other.d.ts": base["nested/other.d.ts"], "extra.d.ts": "export {};\n"}, true},
		{"moved file", map[string]string{"main.d.ts": base["main.d.ts"], "other.d.ts": base["nested/other.d.ts"]}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before, after := writeDeclarationTree(t, base), writeDeclarationTree(t, tc.after)
			calls := 0
			probe := func(_ context.Context, _, gotBefore, gotAfter string) (string, error) {
				calls++
				if gotBefore != before || gotAfter != after {
					t.Fatalf("probe got %s and %s", gotBefore, gotAfter)
				}
				return "probe diff", nil
			}
			diff, err := declarationIdentityDiff(t.Context(), probe, "api", before, after)
			if err != nil {
				t.Fatal(err)
			}
			if tc.probe && (calls != 1 || diff != "probe diff") {
				t.Fatalf("different trees: calls %d, diff %q", calls, diff)
			}
			if !tc.probe && (calls != 0 || diff != "") {
				t.Fatalf("identical trees: calls %d, diff %q", calls, diff)
			}
		})
	}
}

// Two empty trees prove nothing, so they still reach the comparison, which
// reports the missing declarations.
func TestDeclarationIdentityDiffProbesEmptyTrees(t *testing.T) {
	before, after := t.TempDir(), t.TempDir()
	want := errors.New("no declarations")
	_, err := declarationIdentityDiff(t.Context(), func(context.Context, string, string, string) (string, error) {
		return "", want
	}, "api", before, after)
	if !errors.Is(err, want) {
		t.Fatalf("got %v", err)
	}
}

func TestDeclarationIdentityDiffReportsUnreadableTree(t *testing.T) {
	before := writeDeclarationTree(t, map[string]string{"main.d.ts": "export {};\n"})
	_, err := declarationIdentityDiff(t.Context(), func(context.Context, string, string, string) (string, error) {
		t.Fatal("a tree that cannot be read must not reach the comparison")
		return "", nil
	}, "api", before, filepath.Join(before, "absent"))
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("got %v", err)
	}
}
