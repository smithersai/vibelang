package vibelangfuzz

import (
	"maps"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// A compile in a case's directory must not change the seeds: FuzzCommandLine
// read a leftover main.d.vibe.ts as a source, and failed when --watch rewrote it.
func TestCaseSeedsIgnoreDeclarationSidecars(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "leftover")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, text := range map[string]string{
		"tsconfig.json":  "{}",
		"main.vibe":      "export const a = 1\n",
		"main.d.vibe.ts": "export declare const a: 1\n",
		"stub.d.ts":      "export {}\n",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	seeds := loadCaseSeeds(root)
	if len(seeds) != 1 {
		t.Fatalf("%d seeds, want 1", len(seeds))
	}
	got := slices.Sorted(maps.Keys(seeds[0].Files))
	if want := []string{"main.vibe", "stub.d.ts", "tsconfig.json"}; !slices.Equal(got, want) {
		t.Errorf("seed files %v, want %v", got, want)
	}
}
