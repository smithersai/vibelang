package compiler

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestForkPreparationLockCancelledBeforeAcquisition(t *testing.T) {
	name := filepath.Join(t.TempDir(), "prepare.lock")
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	release, err := acquireForkPreparationLock(ctx, name)
	if release != nil {
		defer release()
	}
	if !errors.Is(err, context.Canceled) || release != nil {
		t.Fatalf("cancelled acquisition granted a lock: release=%v error=%v", release != nil, err)
	}
	if _, err := os.Lstat(name); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("cancelled acquisition created a path: %v", err)
	}
}

func TestForkPreparationLockReleaseCannotReleaseSuccessor(t *testing.T) {
	name := filepath.Join(t.TempDir(), "prepare.lock")
	first, err := acquireForkPreparationLock(t.Context(), name)
	if err != nil {
		t.Fatal(err)
	}
	defer first()
	first()
	second, err := acquireForkPreparationLock(t.Context(), name)
	if err != nil {
		t.Fatal(err)
	}
	defer second()
	// A repeated release must not remove the next owner's lock path or close
	// its descriptor, including when callbacks release concurrently.
	var releases sync.WaitGroup
	for range 8 {
		releases.Add(1)
		go func() { defer releases.Done(); first() }()
	}
	releases.Wait()
	ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
	defer cancel()
	third, err := acquireForkPreparationLock(ctx, name)
	if third != nil {
		defer third()
	}
	if !errors.Is(err, context.DeadlineExceeded) || third != nil {
		t.Fatalf("repeated release stole the successor's lock: granted=%v error=%v", third != nil, err)
	}
}

func TestForkPreparationLockPreservesPersistentFile(t *testing.T) {
	name := filepath.Join(t.TempDir(), "prepare.lock")
	const evidence = "existing lock bytes must not be truncated\n"
	if err := os.WriteFile(name, []byte(evidence), 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(name)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	release, err := acquireForkPreparationLock(ctx, name)
	if err != nil {
		t.Fatal(err)
	}
	release()
	after, err := os.Stat(name)
	if err != nil || !os.SameFile(before, after) || !after.Mode().IsRegular() {
		t.Fatalf("release removed or replaced the shared lock inode: %v", err)
	}
	content, err := os.ReadFile(name)
	if err != nil || string(content) != evidence {
		t.Fatalf("lock content changed: %q, %v", content, err)
	}
}

func TestForkPreparationLockWaiterCancellationDoesNotReleaseOwner(t *testing.T) {
	name := filepath.Join(t.TempDir(), "prepare.lock")
	owner, err := acquireForkPreparationLock(t.Context(), name)
	if err != nil {
		t.Fatal(err)
	}
	defer owner()
	for range 2 {
		ctx, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
		release, err := acquireForkPreparationLock(ctx, name)
		cancel()
		if release != nil {
			release()
		}
		if !errors.Is(err, context.DeadlineExceeded) || release != nil {
			t.Fatalf("waiter released the owner: granted=%v error=%v", release != nil, err)
		}
	}
	owner()
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	next, err := acquireForkPreparationLock(ctx, name)
	if err != nil {
		t.Fatal(err)
	}
	next()
}

func TestForkPreparationLockIndependentPaths(t *testing.T) {
	directory := t.TempDir()
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	first, err := acquireForkPreparationLock(ctx, filepath.Join(directory, "first.lock"))
	if err != nil {
		t.Fatal(err)
	}
	defer first()
	second, err := acquireForkPreparationLock(ctx, filepath.Join(directory, "second.lock"))
	if err != nil {
		t.Fatal(err)
	}
	defer second()
}

func TestForkPreparationLockRefusesInvalidPaths(t *testing.T) {
	t.Run("directory", func(t *testing.T) {
		name := t.TempDir()
		ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
		defer cancel()
		release, err := acquireForkPreparationLock(ctx, name)
		if release != nil {
			release()
		}
		if err == nil || errors.Is(err, context.DeadlineExceeded) || release != nil {
			t.Fatalf("invalid directory was treated as a live lock: %v", err)
		}
		if info, err := os.Stat(name); err != nil || !info.IsDir() {
			t.Fatalf("invalid lock directory was removed: %v", err)
		}
	})
	t.Run("missing parent", func(t *testing.T) {
		release, err := acquireForkPreparationLock(t.Context(), filepath.Join(t.TempDir(), "missing", "prepare.lock"))
		if release != nil {
			release()
		}
		if !errors.Is(err, os.ErrNotExist) || release != nil {
			t.Fatalf("unexpected path error: %v", err)
		}
	})
}

func TestForkPreparationLockContention(t *testing.T) {
	name := filepath.Join(t.TempDir(), "prepare.lock")
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	start := make(chan struct{})
	problems := make(chan error, 8)
	var active, completed atomic.Int32
	var workers sync.WaitGroup
	for range 8 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			for range 12 {
				release, err := acquireForkPreparationLock(ctx, name)
				if err != nil {
					problems <- err
					return
				}
				owners := active.Add(1)
				runtime.Gosched()
				active.Add(-1)
				release()
				if owners != 1 {
					problems <- fmt.Errorf("%d simultaneous preparation owners", owners)
					return
				}
				completed.Add(1)
			}
		}()
	}
	close(start)
	workers.Wait()
	close(problems)
	for err := range problems {
		t.Error(err)
	}
	if completed.Load() != 96 || active.Load() != 0 {
		t.Fatalf("lost or overlapping preparations: completed=%d active=%d", completed.Load(), active.Load())
	}
}

func TestPinnedForkPreparationPreservesLegacyLock(t *testing.T) {
	checkout := os.Getenv("VIBELANG_TYPESCRIPT_FORK")
	if checkout == "" {
		t.Skip("set VIBELANG_TYPESCRIPT_FORK to run the executable fork test")
	}
	series, err := loadPinnedForkPatchSeries()
	if err != nil {
		t.Fatal(err)
	}
	// This is the exact former cache address. Preserve its lock and payload
	// even if its owner is dead: older executables may still be using it.
	hash := sha256.New()
	for _, file := range forkBridgeFiles {
		hash.Write([]byte(file.target))
		hash.Write([]byte{0})
		hash.Write(*file.source)
		hash.Write([]byte{0})
	}
	cache := t.TempDir()
	legacy := filepath.Join(cache, PinnedTypeScriptRevision+"-"+series.identity+"-"+hex.EncodeToString(hash.Sum(nil))+"-"+runtime.GOOS+"-"+runtime.GOARCH)
	legacyLock := filepath.Join(legacy, "prepare.lock")
	if err := os.MkdirAll(legacyLock, 0o700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(legacyLock, "owner-evidence")
	if err := os.WriteFile(marker, []byte("preserve"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 2*time.Minute)
	defer cancel()
	prepared, err := PreparePinnedFork(ctx, ForkConfig{CheckoutDirectory: checkout, CacheDirectory: cache})
	if err != nil {
		t.Fatal(err)
	}
	canonicalCache, err := filepath.EvalSymlinks(cache)
	if err != nil {
		t.Fatal(err)
	}
	relative, err := filepath.Rel(canonicalCache, prepared.Executable)
	if err != nil || !strings.HasPrefix(relative, "v2"+string(filepath.Separator)) {
		t.Fatalf("preparation reused the legacy cache: %q, %v", relative, err)
	}
	if prepared.Revision != PinnedTypeScriptRevision || prepared.APIVersion != APIVersion || prepared.PatchSeries != series.identity {
		t.Fatalf("cache migration changed compiler identity: %#v", prepared)
	}
	if content, err := os.ReadFile(marker); err != nil || string(content) != "preserve" {
		t.Fatalf("legacy ownership evidence changed: %q, %v", content, err)
	}
	if info, err := os.Stat(filepath.Join(filepath.Dir(prepared.Executable), "prepare.lock")); err != nil || !info.Mode().IsRegular() {
		t.Fatalf("prepared cache has no persistent file lock: %v", err)
	}
}

type forkPreparationLockChild struct {
	command *exec.Cmd
	input   io.WriteCloser
	output  <-chan error
	wait    func() error
	stderr  *bytes.Buffer
}

func startForkPreparationLockChild(t *testing.T, name string) *forkPreparationLockChild {
	t.Helper()
	command := exec.CommandContext(t.Context(), os.Args[0], "-test.run=^TestForkPreparationLockProcess$", "-test.v=false")
	command.Env = append(os.Environ(), "VIBELANG_PREPARATION_LOCK_HELPER="+name)
	input, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	stderr := new(bytes.Buffer)
	command.Stderr = stderr
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	var once sync.Once
	var waitErr error
	wait := func() error { once.Do(func() { waitErr = command.Wait() }); return waitErr }
	t.Cleanup(func() { _ = input.Close(); _ = command.Process.Kill(); _ = wait() })
	ready := make(chan error, 1)
	go func() {
		line, err := bufio.NewReader(stdout).ReadString('\n')
		if err == nil && line != "vibelang-preparation-locked\n" {
			err = fmt.Errorf("unexpected child output %q", line)
		}
		ready <- err
	}()
	return &forkPreparationLockChild{command: command, input: input, output: ready, wait: wait, stderr: stderr}
}

func (child *forkPreparationLockChild) ready(t *testing.T) {
	t.Helper()
	select {
	case err := <-child.output:
		if err != nil {
			_ = child.command.Process.Kill()
			_ = child.wait()
			t.Fatalf("lock child failed: %v\n%s", err, child.stderr)
		}
	case <-time.After(3 * time.Second):
		_ = child.command.Process.Kill()
		_ = child.wait()
		t.Fatalf("fresh process could not acquire preparation lock\n%s", child.stderr)
	}
}

func TestForkPreparationLockProcess(t *testing.T) {
	if name := os.Getenv("VIBELANG_PREPARATION_LOCK_HELPER"); name != "" {
		ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
		defer cancel()
		release, err := acquireForkPreparationLock(ctx, name)
		if err != nil {
			t.Fatal(err)
		}
		defer release()
		fmt.Fprintln(os.Stdout, "vibelang-preparation-locked")
		if _, err := io.Copy(io.Discard, os.Stdin); err != nil {
			t.Fatal(err)
		}
		return
	}
	for _, crash := range []bool{false, true} {
		t.Run(fmt.Sprintf("crash=%t", crash), func(t *testing.T) {
			name := filepath.Join(t.TempDir(), "prepare.lock")
			owner := startForkPreparationLockChild(t, name)
			owner.ready(t)
			ctx, cancel := context.WithTimeout(t.Context(), 100*time.Millisecond)
			defer cancel()
			release, err := acquireForkPreparationLock(ctx, name)
			if release != nil {
				release()
			}
			if !errors.Is(err, context.DeadlineExceeded) || release != nil {
				t.Fatalf("live child lost exclusion: granted=%v error=%v", release != nil, err)
			}
			if crash {
				if err := owner.command.Process.Kill(); err != nil {
					t.Fatal(err)
				}
				if err := owner.wait(); err == nil {
					t.Fatal("crash control did not kill its lock owner")
				}
			} else {
				if err := owner.input.Close(); err != nil {
					t.Fatal(err)
				}
				if err := owner.wait(); err != nil {
					t.Fatalf("normal lock owner exit: %v\n%s", err, owner.stderr)
				}
			}
			// The successor is another OS process, not a goroutine or mocked
			// liveness check. No lock file/directory is removed on its behalf.
			successor := startForkPreparationLockChild(t, name)
			successor.ready(t)
			if err := successor.input.Close(); err != nil {
				t.Fatal(err)
			}
			if err := successor.wait(); err != nil {
				t.Fatalf("successor failed: %v\n%s", err, successor.stderr)
			}
		})
	}
}
