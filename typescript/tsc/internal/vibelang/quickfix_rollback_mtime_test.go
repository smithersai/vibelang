package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestFixKeeperRestoresOriginalMetadata(t *testing.T) {
	for _, link := range []bool{false, true} {
		t.Run(map[bool]string{false: "file", true: "symlink"}[link], func(t *testing.T) {
			dir := t.TempDir()
			target := filepath.Join(dir, "main.vibe")
			name := target
			const original = "export function main(){return 7}\n"
			if err := os.WriteFile(target, []byte(original), 0600); err != nil {
				t.Fatal(err)
			}
			stamp := time.Unix(1234567890, 17)
			if err := os.Chtimes(target, stamp, stamp); err != nil {
				t.Fatal(err)
			}
			initial, err := os.Stat(target)
			if err != nil {
				t.Fatal(err)
			}
			if link {
				name = filepath.Join(dir, "alias.vibe")
				if err := os.Symlink(target, name); err != nil {
					t.Fatal(err)
				}
			}
			path := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(name))
			k := &fixKeeper{sys: &fixSys{cwd: dir, fs: bundled.WrapFS(osvfs.FS())}, last: map[tspath.RootedFilePath]string{}, original: map[tspath.RootedFilePath]string{}}
			defer k.close()
			k.keep(map[tspath.RootedFilePath]string{path: original})
			k.keep(map[tspath.RootedFilePath]string{path: "export function main(){return 8}\n"})
			k.keep(map[tspath.RootedFilePath]string{path: original})
			if k.err != nil {
				t.Fatal(k.err)
			}
			final, err := os.Stat(target)
			if err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(target)
			if err != nil {
				t.Fatal(err)
			}
			if string(data) != original || !final.ModTime().Equal(initial.ModTime()) || final.Mode().Perm() != initial.Mode().Perm() {
				t.Fatalf("rollback rewrote original metadata: bytes=%q mtime=%s want=%s mode=%s", data, final.ModTime(), initial.ModTime(), final.Mode())
			}
			k.close()
			if matches, _ := filepath.Glob(filepath.Join(dir, ".*.fix-*")); len(matches) != 0 {
				t.Fatalf("left rollback backups: %v", matches)
			}
		})
	}
}
func TestQuickFixRefusalKeepsFileMtime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	dir := copyCompilerFixture(t, filepath.Join(root, "typescript/vibelang/cases/diag-call-pipe.fail"), root)
	name := filepath.Join(dir, "main.vibe")
	data, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	stamp := time.Unix(1234567890, 17)
	if err := os.Chtimes(name, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(name)
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 2; n++ {
		sys := &fixSys{fs: bundled.WrapFS(osvfs.FS()), cwd: dir}
		FixWithOptions(t.Context(), sys, []string{"-p", dir}, FixOptions{})
		fixRuns.Wait()
		after, err := os.Stat(name)
		if err != nil {
			t.Fatal(err)
		}
		text, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		if string(text) != string(data) || !after.ModTime().Equal(before.ModTime()) {
			t.Fatalf("refused --fix rewrote bytes or mtime on run %d", n+1)
		}
		if !strings.Contains(sys.stdout.String(), "refused site") {
			t.Fatalf("missing refusal witness: %s %s", sys.stdout.String(), sys.stderr.String())
		}
	}
	if matches, _ := filepath.Glob(filepath.Join(dir, ".*.fix-*")); len(matches) != 0 {
		t.Fatalf("left rollback backups: %v", matches)
	}
}
