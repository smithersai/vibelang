package compiler

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"
)

const forkPreparationCacheLayout = "v2"

// acquireForkPreparationLock owns an OS lock, not the existence of its path.
// Closing the file (including process termination) releases ownership. The
// file remains in place: unlinking it would let a new opener bypass waiters
// still holding the previous inode. The cache is host-trusted local storage,
// not a distributed lease or a security boundary against another cache writer.
func acquireForkPreparationLock(ctx context.Context, name string) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if info, err := os.Lstat(name); err == nil {
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("preparation lock %q must be a regular file", name)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	file, err := os.OpenFile(name, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	release := sync.OnceFunc(func() { _ = file.Close() })
	granted := false
	defer func() {
		if !granted {
			release()
		}
	}()
	identity, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !identity.Mode().IsRegular() {
		return nil, fmt.Errorf("preparation lock %q must be a regular file", name)
	}
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		locked, err := tryForkPreparationLock(file)
		if err != nil {
			return nil, &os.PathError{Op: "lock preparation", Path: name, Err: err}
		}
		if locked {
			// Cancellation never grants ownership. A waiter whose path was
			// removed or replaced must also not proceed on an orphaned inode.
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			current, err := os.Lstat(name)
			if err != nil {
				return nil, err
			}
			if !current.Mode().IsRegular() || !os.SameFile(identity, current) {
				return nil, fmt.Errorf("preparation lock %q changed while acquiring it", name)
			}
			granted = true
			return release, nil
		}
		timer := time.NewTimer(25 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}
