package vibelangmapper

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"sync/atomic"
	"time"
)

const scopeProgressInterval = 30 * time.Second

var scopeStageID atomic.Uint64

type scopeStageRecord struct {
	RunID       int    `json:"run"`
	ID          uint64 `json:"id"`
	Stage       string `json:"stage"`
	State       string `json:"state"`
	ElapsedMS   int64  `json:"elapsed_ms"`
	OutputBytes *int   `json:"output_bytes,omitempty"`
	ExitCode    *int   `json:"exit_code,omitempty"`
	Cause       string `json:"cause,omitempty"`
}

// observeScopeStage keeps admission waits and silent builds visible without
// logging command arguments, paths, environment values or captured output.
// It joins the operation before returning, retaining its complete result.
func observeScopeStage(stage string, diagnostics io.Writer, interval time.Duration, run func() ([]byte, error)) ([]byte, error) {
	id := scopeStageID.Add(1)
	started := time.Now()
	emit := func(state string, size, exitCode *int, cause string) {
		record := scopeStageRecord{RunID: os.Getpid(), ID: id, Cause: cause, Stage: stage, State: state, ElapsedMS: time.Since(started).Milliseconds(), OutputBytes: size, ExitCode: exitCode}
		b, _ := json.Marshal(record)
		// One write keeps concurrent stage records together on the shared stderr.
		_, _ = diagnostics.Write(append(append([]byte("[mapper-scope] "), b...), 10))
	}
	emit("start", nil, nil, "")
	type result struct {
		out []byte
		err error
	}
	done := make(chan result, 1)
	go func() { out, err := run(); done <- result{out, err} }()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			emit("progress", nil, nil, "")
		case r := <-done:
			size, code, state, cause := len(r.out), 0, "pass", "exit"
			if r.err != nil {
				state, code, cause = "fail", -1, "operation"
				var exit *exec.ExitError
				if errors.As(r.err, &exit) {
					code = exit.ExitCode()
					if code < 0 {
						cause = "signal"
					} else {
						cause = "exit"
					}
				}
			}
			emit(state, &size, &code, cause)
			return r.out, r.err
		}
	}
}
