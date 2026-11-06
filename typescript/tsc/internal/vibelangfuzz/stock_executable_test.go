package vibelangfuzz

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

func TestStockExecutable(t *testing.T) {
	modules := t.TempDir()
	touch := func(path string) string {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, nil, 0o755); err != nil {
			t.Fatal(err)
		}
		return path
	}
	tsc := touch(filepath.Join(modules, ".bin", "tsc"))
	if got := stockExecutable(tsc); got != tsc {
		t.Fatalf("an install without a platform binary keeps its launcher, got %s", got)
	}
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x64"
	}
	native := touch(filepath.Join(modules, "@typescript", "typescript-"+runtime.GOOS+"-"+arch, "lib", "tsc"))
	if got := stockExecutable(tsc); got != native {
		t.Fatalf("want the platform binary %s, got %s", native, got)
	}
}

// The binary must be the compiler that the pinned launcher runs.
func TestStockExecutableMatchesLauncher(t *testing.T) {
	tsc := StockTypeScript(t)
	version := func(program string) []byte {
		t.Helper()
		out, err := exec.Command(program, "--version").CombinedOutput()
		if err != nil {
			t.Fatalf("%s --version: %v: %s", program, err, out)
		}
		return out
	}
	launcher := filepath.Join(filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(tsc)))), ".bin", "tsc")
	if _, err := os.Stat(launcher); err != nil {
		t.Skipf("the install has no platform binary: %v", err)
	}
	if got, want := version(tsc), version(launcher); !bytes.Equal(got, want) {
		t.Fatalf("binary reports %q, launcher %q", got, want)
	}
}
