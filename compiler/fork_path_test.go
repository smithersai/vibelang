package compiler

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCacheOverlapIsDetectedBeforeCreation(t *testing.T) {
	checkout, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cacheBase := filepath.Join(checkout, "not-created", "cache")
	resolved, err := resolvePathForCreation(cacheBase)
	if err != nil {
		t.Fatal(err)
	}
	cacheDirectory := filepath.Join(resolved, "bridge-revision")
	if !pathsOverlap(checkout, cacheDirectory) {
		t.Fatalf("expected %q and %q to overlap", checkout, cacheDirectory)
	}
	if _, err := os.Stat(filepath.Join(checkout, "not-created")); !os.IsNotExist(err) {
		t.Fatalf("overlap check created a directory: %v", err)
	}
}

func TestCacheSymlinkIntoCheckoutIsDetected(t *testing.T) {
	root := t.TempDir()
	checkout := filepath.Join(root, "checkout")
	outside := filepath.Join(root, "outside")
	if err := os.Mkdir(checkout, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(outside, "cache-link")
	if err := os.Symlink(checkout, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	resolved, err := resolvePathForCreation(link)
	if err != nil {
		t.Fatal(err)
	}
	canonicalCheckout, err := filepath.EvalSymlinks(checkout)
	if err != nil {
		t.Fatal(err)
	}
	if !pathsOverlap(canonicalCheckout, filepath.Join(resolved, "bridge-revision")) {
		t.Fatal("symlinked cache into checkout was not detected")
	}
}
