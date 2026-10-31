package vibelangfuzz

import (
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"testing"
)

// A CLI seed run builds the same compiler packages as its outer go test.
// Keep their build mode identical so a fresh validation mirror does not
// compile the entire compiler a second time in FuzzCommandLine setup.
func TestCLITrimpath(t *testing.T) {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		t.Fatal("test build metadata unavailable")
	}
	wantTrimpath := false
	for _, setting := range info.Settings {
		if setting.Key == "-trimpath" {
			wantTrimpath = setting.Value == "true"
		}
	}
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
	gotTrimpath := false
	for _, arg := range strings.Fields(string(data)) {
		if arg == "-trimpath" || arg == "-trimpath=true" {
			gotTrimpath = true
		}
	}
	if gotTrimpath != wantTrimpath {
		t.Fatalf("nested compiler trimpath=%t, test binary trimpath=%t; cannot share compiler build cache: %s", gotTrimpath, wantTrimpath, data)
	}
}
