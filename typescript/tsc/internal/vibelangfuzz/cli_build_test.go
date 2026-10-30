package vibelangfuzz

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// A CLI seed run builds the same compiler packages as its outer go test.
// Keep their build mode identical so a fresh validation mirror does not
// compile the entire compiler a second time in FuzzCommandLine setup.
func TestCLITrimpath(t *testing.T) {
	dir := t.TempDir()
	args := filepath.Join(dir, "args")
	fake := "#!/bin/sh\nprintf \"%s\\n\" \"$@\" > \"$VIBELANG_FUZZ_BUILD_ARGS\"\n"
	if err := os.WriteFile(filepath.Join(dir, "go"), []byte(fake), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("VIBELANG_FUZZ_BUILD_ARGS", args)
	cliBuild(t, dir)
	data, err := os.ReadFile(args)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(strings.Fields(string(data)), "-trimpath") {
		t.Fatalf("nested compiler build cannot share the trimmed test build cache: %s", data)
	}
}
