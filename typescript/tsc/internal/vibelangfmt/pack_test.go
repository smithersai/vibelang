package vibelangfmt

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteArchiveOwnsTemporaryFile(t *testing.T) {
	for _, scenario := range []string{"success", "missing executable", "rename failure"} {
		t.Run(scenario, func(t *testing.T) {
			dir := t.TempDir()
			executable := filepath.Join(dir, "compiler")
			payload := []byte("compiler payload")
			if scenario != "missing executable" {
				if err := os.WriteFile(executable, payload, 0o755); err != nil {
					t.Fatal(err)
				}
			}
			output := filepath.Join(dir, "plugin.zip")
			sentinel := filepath.Join(output, "keep")
			if scenario == "rename failure" {
				if err := os.Mkdir(output, 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(sentinel, []byte("unchanged"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			checksum, err := writeArchive(output, executable, "plugin")
			if scenario != "success" {
				if err == nil || checksum != "" {
					t.Fatalf("failed archive: checksum=%q, err=%v", checksum, err)
				}
				if scenario == "rename failure" {
					got, readErr := os.ReadFile(sentinel)
					if readErr != nil || string(got) != "unchanged" {
						t.Fatalf("destination changed: %q, %v", got, readErr)
					}
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				data, err := os.ReadFile(output)
				if err != nil {
					t.Fatal(err)
				}
				digest := sha256.Sum256(data)
				if checksum != hex.EncodeToString(digest[:]) {
					t.Fatalf("checksum does not describe the archive: %q", checksum)
				}
				archive, err := zip.OpenReader(output)
				if err != nil {
					t.Fatal(err)
				}
				defer archive.Close()
				if len(archive.File) != 1 || archive.File[0].Name != "plugin" || archive.File[0].Mode().Perm() != 0o755 {
					t.Fatalf("wrong archive entry: %+v", archive.File)
				}
				entry, err := archive.File[0].Open()
				if err != nil {
					t.Fatal(err)
				}
				got, err := io.ReadAll(entry)
				entry.Close()
				if err != nil || string(got) != string(payload) {
					t.Fatalf("wrong archive content: %q, %v", got, err)
				}
			}
			if _, err := os.Stat(output + ".tmp"); !os.IsNotExist(err) {
				t.Fatalf("temporary archive remains: %v", err)
			}
		})
	}
}
