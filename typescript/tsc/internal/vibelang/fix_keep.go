package vibelang

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sync"

	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// A fixKeeper writes the files of each set of fixes the gate verifies
// (FixOptions.Verified), so a --fix run stopped by SIGINT, SIGTERM or a
// timeout keeps the fixes it verified. A run on a large package checks it
// for an hour or more, and one that wrote only at its end lost all of it
// when a flow's timeout stopped it (opencode packages/ai, 2026-10-31).
// The sets the gate verifies grow, but for a fix a halving's checkpoint
// verified and its later checks refuse (gateRound.checkpoint), which the
// next set leaves out. The keeper writes a file only when its text
// changed: a stopped run's files hold the last set verified, and a run
// that finishes writes each changed file a few times at most.
type fixKeeper struct {
	// mu holds the fields below while a set is written; closed ends the
	// writes and the progress lines of a run that stopped (keeperWriter).
	mu       sync.Mutex
	closed   bool
	sys      tsc.System
	config   map[tspath.RootedFilePath]string // sidecar config fixes the fixes were checked under
	scope    *fixScope                        // the files it may write (fix_only.go)
	stop     context.CancelFunc               // stops the run when a write fails
	last     map[tspath.RootedFilePath]string // the text last written, by file
	original map[tspath.RootedFilePath]string // the text before the run, by file written
	wrote    bool                             // config written
	err      error
}

// keep writes the files of texts whose text is not on disk.
func (k *fixKeeper) keep(texts map[tspath.RootedFilePath]string) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.err != nil || k.closed {
		return
	}
	names := make([]tspath.RootedFilePath, 0, len(texts))
	for name, text := range texts {
		if last, ok := k.last[name]; ok && last == text {
			continue
		}
		if _, ok := k.last[name]; !ok {
			original, err := os.ReadFile(name.AsString())
			if err == nil && string(original) == text {
				k.last[name] = text
				continue
			}
			k.original[name] = string(original)
		}
		// The last line of defense for a list's promise: a run stopped at any
		// moment leaves every unlisted file as it was.
		if !k.scope.includes(name) {
			k.fail(fmt.Errorf("%s: a fix reached a file --only does not list; wrote nothing", relativeName(k.sys, name)))
			return
		}
		names = append(names, name)
	}
	if len(names) == 0 {
		return
	}
	// The fixes were checked with the sidecar config fixes in place.
	k.writeConfig()
	slices.SortFunc(names, tspath.RootedFilePath.Compare)
	for _, name := range names {
		if k.err != nil {
			return
		}
		if err := writeFileAtomically(name.AsString(), texts[name]); err != nil {
			k.fail(fmt.Errorf("%s: %w", relativeName(k.sys, name), err))
			return
		}
		k.last[name] = texts[name]
	}
}

// close waits for a write under way, ends the keeper's writes and says
// what the run kept.
func (k *fixKeeper) close() string {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.closed = true
	return k.kept()
}

// A keeperWriter writes to w until its keeper closes, so a stopped run's
// gate prints no progress after the run's last line.
type keeperWriter struct {
	k *fixKeeper
	w io.Writer
}

func (w keeperWriter) Write(p []byte) (int, error) {
	w.k.mu.Lock()
	defer w.k.mu.Unlock()
	if w.k.closed {
		return len(p), nil
	}
	return w.w.Write(p)
}

// fixRuns counts the gates FixWithOptions started that are still running,
// with those a stopped run left, so a test can wait for them.
var fixRuns sync.WaitGroup

// writeConfig writes the sidecar config fixes once.
func (k *fixKeeper) writeConfig() {
	if k.wrote || k.err != nil {
		return
	}
	k.wrote = true
	if err := writeSidecarConfigFixes(k.sys, k.config); err != nil {
		k.fail(err)
	}
}

func (k *fixKeeper) fail(err error) {
	k.err = err
	if k.stop != nil {
		k.stop()
	}
}

// kept says what a run that stopped kept.
func (k *fixKeeper) kept() string {
	changed := 0
	for name, text := range k.last {
		if original, ok := k.original[name]; ok && original != text {
			changed++
		}
	}
	if changed == 0 {
		return "no file written"
	}
	return fmt.Sprintf("kept the fixes it verified, in %d %s; run it again to finish", changed, plural(changed, "file", "files"))
}

// writeFileAtomically replaces the file name, or the file its symbolic
// link names, with text through a new file in its directory, so a process
// killed while writing leaves the old text or the new, never part of one.
// The file keeps its permissions.
func writeFileAtomically(name, text string) error {
	target := name
	if resolved, err := filepath.EvalSymlinks(name); err == nil {
		target = resolved
	}
	mode := os.FileMode(0o644)
	if info, err := os.Stat(target); err == nil {
		mode = info.Mode().Perm()
	}
	temp, err := os.CreateTemp(filepath.Dir(target), "."+filepath.Base(target)+".fix-*")
	if err != nil {
		return err
	}
	_, err = temp.WriteString(text)
	if err == nil {
		err = temp.Chmod(mode)
	}
	if closeErr := temp.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(temp.Name(), target)
	}
	if err != nil {
		os.Remove(temp.Name())
	}
	return err
}
