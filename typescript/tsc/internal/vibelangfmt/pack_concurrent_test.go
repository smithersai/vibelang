package vibelangfmt

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func checkOwnedArchive(t *testing.T, name string, payload []byte) {
	t.Helper()
	dir := t.TempDir()
	executable := filepath.Join(dir, "compiler")
	if err := os.WriteFile(executable, payload, 0o755); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(dir, name)
	foreign := output + ".tmp"
	if err := os.WriteFile(foreign, []byte("another writer owns this"), 0o644); err != nil {
		t.Fatal(err)
	}
	checksum, err := writeArchive(output, executable, "plugin")
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(foreign)
	if err != nil || string(got) != "another writer owns this" {
		t.Fatalf("foreign temporary was changed: %q, %v", got, err)
	}
	verifyArchive(t, output, checksum, payload)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("writer left temporary files: %v", entries)
	}
}

func verifyArchive(t *testing.T, output, checksum string, payload []byte) {
	t.Helper()
	data, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	if checksum != hex.EncodeToString(digest[:]) {
		t.Fatal("archive and returned checksum disagree")
	}
	archive, err := zip.OpenReader(output)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	if len(archive.File) != 1 || archive.File[0].Name != "plugin" || archive.File[0].Mode().Perm() != 0o755 {
		t.Fatal("wrong plugin entry")
	}
	entry, err := archive.File[0].Open()
	if err != nil {
		t.Fatal(err)
	}
	defer entry.Close()
	got, err := io.ReadAll(entry)
	if err != nil || !bytes.Equal(got, payload) {
		t.Fatal("archive payload changed")
	}
}

func TestWriteArchivePreservesForeignTemporary(t *testing.T) {
	for _, name := range []string{"plugin.zip", "space plugin.zip", "λ.zip"} {
		t.Run(name, func(t *testing.T) { checkOwnedArchive(t, name, []byte("compiler payload")) })
	}
}

func TestWriteArchiveConcurrentWriters(t *testing.T) {
	dir := t.TempDir()
	executable := filepath.Join(dir, "compiler")
	payload := bytes.Repeat([]byte("compiler payload"), 65536)
	if err := os.WriteFile(executable, payload, 0o755); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(dir, "plugin.zip")
	type result struct {
		checksum string
		err      error
	}
	for wave := range 3 {
		start := make(chan struct{})
		results := make(chan result, 8)
		for range 8 {
			go func() { <-start; sum, err := writeArchive(output, executable, "plugin"); results <- result{sum, err} }()
		}
		close(start)
		completed := make([]result, 8)
		for i := range completed {
			completed[i] = <-results
		}
		for _, r := range completed {
			if r.err != nil {
				t.Errorf("wave %d: concurrent writer failed: %v", wave, r.err)
				continue
			}
			verifyArchive(t, output, r.checksum, payload)
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 2 {
		t.Fatalf("temporary files remain: %v, %v", entries, err)
	}
}

// A writer owns only its random temporary directory, even when a caller has
// left a file at the old shared .tmp name. Check both payload integrity and
// cleanup, including empty and arbitrary binary executable bytes.
func FuzzWriteArchiveTemporaryOwnership(f *testing.F) {
	for _, payload := range [][]byte{nil, []byte("compiler"), {0, 255, 0, 10}, bytes.Repeat([]byte("x"), 4096)} {
		f.Add(payload, uint8(0))
	}
	f.Fuzz(func(t *testing.T, payload []byte, kind uint8) {
		if len(payload) > 65536 {
			t.Skip()
		}
		names := []string{"plugin.zip", "space plugin.zip", "λ.zip"}
		checkOwnedArchive(t, names[int(kind)%len(names)], payload)
	})
}
