package compiler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

func TestEmbeddedForkPatchSeriesIsDigestGatedAndIdentified(t *testing.T) {
	series, err := loadPinnedForkPatchSeries()
	if err != nil {
		t.Fatal(err)
	}
	if series.manifest.Revision != PinnedTypeScriptRevision {
		t.Fatalf("patch revision = %q, want %q", series.manifest.Revision, PinnedTypeScriptRevision)
	}
	if len(series.manifest.Patches) == 0 || len(series.patches) != len(series.manifest.Patches) {
		t.Fatalf("embedded patch set is incomplete: %#v", series.manifest.Patches)
	}
	if decoded, err := hex.DecodeString(series.identity); err != nil || len(decoded) != sha256.Size {
		t.Fatalf("patch-series identity is not a SHA-256: %q", series.identity)
	}
	for _, patch := range series.manifest.Patches {
		content := series.patches[patch.File]
		digest := sha256.Sum256(content)
		if got := hex.EncodeToString(digest[:]); got != patch.SHA256 {
			t.Fatalf("%s digest = %s, want %s", patch.File, got, patch.SHA256)
		}
	}
}

func TestForkPatchCheckoutClassificationFailsClosedOnMixedImages(t *testing.T) {
	checkout := t.TempDir()
	write := func(name string, content string) {
		t.Helper()
		path := filepath.Join(checkout, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	digest := func(content string) string {
		sum := sha256.Sum256([]byte(content))
		return hex.EncodeToString(sum[:])
	}
	manifest := forkPatchManifest{
		Created: []string{"tsc/created.go"},
		PreImage: map[string]string{
			"tsc/changed.go": digest("before\n"),
		},
		PostImage: map[string]string{
			"tsc/changed.go": digest("after\n"),
			"tsc/created.go": digest("created\n"),
		},
	}

	write("tsc/changed.go", "before\n")
	state, err := classifyForkPatchCheckout(checkout, manifest)
	if err != nil || state.state != "pristine" {
		t.Fatalf("pristine checkout classified as %#v, err %v", state, err)
	}

	write("tsc/changed.go", "after\n")
	write("tsc/created.go", "created\n")
	state, err = classifyForkPatchCheckout(checkout, manifest)
	if err != nil || state.state != "applied" {
		t.Fatalf("applied checkout classified as %#v, err %v", state, err)
	}

	write("tsc/created.go", "tampered\n")
	state, err = classifyForkPatchCheckout(checkout, manifest)
	if err != nil || state.state != "mixed" {
		t.Fatalf("tampered checkout classified as %#v, err %v", state, err)
	}
	if problem := firstForkPatchProblem(state); !strings.Contains(problem, "created.go") {
		t.Fatalf("mixed-state error does not identify the divergent file: %q", problem)
	}
}

func TestForkPatchPreparationRejectsWrongRevisionBeforeApplying(t *testing.T) {
	git, err := exec.LookPath("git")
	if err != nil {
		t.Skip("git is required to verify a fork checkout")
	}
	checkout := t.TempDir()
	run := func(arguments ...string) {
		t.Helper()
		command := exec.Command(git, arguments...)
		command.Dir = checkout
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %s failed: %v\n%s", strings.Join(arguments, " "), err, output)
		}
	}
	run("init", "--quiet")
	if err := os.WriteFile(filepath.Join(checkout, "README"), []byte("wrong revision\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", "README")
	run("-c", "user.name=Smithers Test", "-c", "user.email=test@invalid", "commit", "--quiet", "-m", "wrong revision")

	series, err := loadPinnedForkPatchSeries()
	if err != nil {
		t.Fatal(err)
	}
	err = verifyAndApplyPinnedCheckout(context.Background(), checkout, t.TempDir(), series)
	if !errors.Is(err, ErrForkUnavailable) {
		t.Fatalf("wrong revision did not fail closed: %v", err)
	}
	var forkError *ForkError
	if !errors.As(err, &forkError) || forkError.Op != "verify revision" {
		t.Fatalf("wrong revision failed at %v, want verify revision", err)
	}
	status := exec.Command(git, "status", "--porcelain=v1", "--untracked-files=all")
	status.Dir = checkout
	if output, err := status.Output(); err != nil || len(output) != 0 {
		t.Fatalf("wrong-revision rejection mutated the checkout: %q, %v", output, err)
	}
}
