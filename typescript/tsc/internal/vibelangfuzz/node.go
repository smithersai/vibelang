package vibelangfuzz

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"sync"
	"syscall"
	"time"
)

// HangLimit is how long one input may take in a stage before Within crashes
// the process. VIBELANG_FUZZ_HANG overrides it, for example "60s" under -race.
var HangLimit = hangLimit(os.Getenv("VIBELANG_FUZZ_HANG"), os.Args[1:])

// workerHangLimit caps HangLimit in a fuzzing worker, a process cmd/go starts
// with -test.fuzzworker. Go's worker panics "deadlocked!" when one input runs
// 60 s (internal/fuzz/worker.go), printing no stack and saving no crasher,
// so Within must fire first to name the stage and save the input.
const workerHangLimit = 45 * time.Second

func hangLimit(env string, args []string) time.Duration {
	limit := 10 * time.Second
	if l, err := time.ParseDuration(env); err == nil {
		limit = l
	}
	if slices.Contains(args, "-test.fuzzworker") {
		limit = min(limit, workerHangLimit)
	}
	return limit
}

// Within runs fn, and panics from another goroutine with every goroutine's
// stack when fn takes longer than HangLimit. The panic ends the process, so
// the fuzzer saves the input as a crasher: a compiler that does not stop is a
// bug the specification never allows.
func Within(stage string, fn func()) {
	timer := time.AfterFunc(HangLimit, func() {
		killChildren()
		stacks := make([]byte, 1<<22)
		stacks = stacks[:runtime.Stack(stacks, true)]
		panic(fmt.Sprintf("hang: %s took longer than %v\n%s", stage, HangLimit, stacks))
	})
	defer timer.Stop()
	fn()
}

// An Outcome is how a program's Effect ended, in the terms of Chapter 17:
// a success with its value, an expected failure, a defect, or an
// interruption. Plain values expose a Chapter 27 rule 1 ABI disagreement.
type Outcome struct {
	Kind       string          `json:"kind"`            // "success", "failure", "defect", "interrupt", "plain", "timeout", "crash"
	Value      json.RawMessage `json:"value,omitempty"` // the success value, or the failure's error, as JSON
	Tag        string          `json:"tag,omitempty"`   // a failure's or defect's _tag or class name
	Cause      []string        `json:"cause,omitempty"` // Chapter 17: every reason, in order
	BeforeCall json.RawMessage `json:"beforeCall,omitempty"`
	AfterCall  json.RawMessage `json:"afterCall,omitempty"`
	Trace      json.RawMessage `json:"trace,omitempty"`
	Log        string          `json:"log,omitempty"` // the cause, or what Node printed, for a report
}

// A Node runs emitted programs in one long-lived Node process, so a target
// pays Node's start-up once rather than per input. The worker answers on file
// descriptor 3, so what a program prints, as Effect.log does, never takes an
// answer's place; the last of what it prints is kept for a report.
type Node struct {
	dir        string
	mu         sync.Mutex
	cmd        *exec.Cmd
	stdin      io.WriteCloser
	answers    *bufio.Reader
	answerPipe *os.File
	runs       int
	closed     bool
	printed    *tail
}

// RunLimit is how long one program may run before Run reports a timeout.
var RunLimit = 10 * time.Second

const nodeWorker = `import { writeSync } from "node:fs";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
const { Effect, Exit, Cause } = await import("effect");
const json = (v) => JSON.stringify(v, (k, x) => x === undefined ? { $undefined: true } : typeof x === "bigint" ? { $bigint: String(x) } : x);
const tag = (e) => e && typeof e === "object" ? (e._tag ?? e.constructor?.name) : typeof e;
` + vipWorker + `
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.vip) {
    writeSync(3, json(await vip(request.entry, request.maxSteps)) + "\n");
    continue;
  }
  const { entry, name, args, observe } = request;
  let out, module, beforeCall, afterCall;
  try {
    module = await import(pathToFileURL(entry).href);
    // Chapter 27 rule 1: observe the call separately from running its Effect.
    if (observe) beforeCall = JSON.parse(json(module.traceOf()));
    const program = module[name](...(args ?? []));
    if (observe) afterCall = JSON.parse(json(module.traceOf()));
    if (!Effect.isEffect(program)) out = { kind: "plain", value: JSON.parse(json(program)) };
    else {
      const exit = await Effect.runPromiseExit(program);
      if (Exit.isSuccess(exit)) out = { kind: "success", value: JSON.parse(json(exit.value)) };
      else {
        // Chapter 17 and D305: retain every reason; a defect takes precedence.
        const cause = exit.cause.reasons.map(r => Cause.isFailReason(r) ? "fail:" + tag(r.error) : Cause.isDieReason(r) ? "die:" + tag(r.defect) : "interrupt");
        const defect = exit.cause.reasons.find(Cause.isDieReason);
        const failure = exit.cause.reasons.find(Cause.isFailReason);
        const log = Cause.pretty(exit.cause);
        if (defect) out = { kind: "defect", tag: tag(defect.defect), cause, log };
        else if (failure) out = { kind: "failure", tag: tag(failure.error), value: JSON.parse(json(failure.error)), cause, log };
        else out = { kind: "interrupt", cause, log };
      }
    }
    if (observe) Object.assign(out, { beforeCall, afterCall, trace: JSON.parse(json(module.traceOf())) });
  } catch (error) {
    out = { kind: "crash", tag: tag(error), log: String(error?.stack ?? error) };
  }
  writeSync(3, json(out) + "\n");
}
`

// NewNode starts a worker in dir, which must contain node_modules with
// effect; a Workspace's directory does.
func NewNode(dir string) (*Node, error) {
	if _, err := exec.LookPath("node"); err != nil {
		return nil, fmt.Errorf("node is not on PATH: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "fuzz-worker.mjs"), []byte(nodeWorker), 0o600); err != nil {
		return nil, err
	}
	n := &Node{dir: dir}
	return n, n.start()
}

func (n *Node) start() error {
	n.cmd = exec.Command("node", "--no-warnings", "--stack-size=4000", "fuzz-worker.mjs")
	n.cmd.Dir = n.dir
	n.printed = &tail{}
	n.cmd.Stdout, n.cmd.Stderr = n.printed, n.printed
	answers, writer, err := os.Pipe()
	if err != nil {
		n.cmd = nil
		return err
	}
	n.cmd.ExtraFiles = []*os.File{writer} // the worker's file descriptor 3
	stdin, err := n.cmd.StdinPipe()
	if err != nil {
		answers.Close()
		writer.Close()
		n.cmd = nil
		return err
	}
	n.stdin, n.answerPipe, n.answers = stdin, answers, bufio.NewReaderSize(answers, 1<<20)
	n.runs = 0
	err = startChild(n.cmd)
	writer.Close() // The worker holds its own copy; its exit ends the answers.
	if err != nil {
		n.stop()
	}
	return err
}

// A tail keeps the last 64 KiB written to it.
type tail struct {
	mu   sync.Mutex
	text []byte
}

func (t *tail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.text = append(t.text, p...)
	if over := len(t.text) - 64<<10; over > 0 {
		t.text = append(t.text[:0], t.text[over:]...)
	}
	return len(p), nil
}

func (t *tail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.text)
}

// Close stops the worker.
func (n *Node) Close() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.closed = true
	n.stop()
}

// stop closes both pipes and reaps the worker, including a blocked answer read.
func (n *Node) stop() {
	if n.stdin != nil {
		_ = n.stdin.Close()
	}
	if n.answerPipe != nil {
		_ = n.answerPipe.Close()
	}
	if n.cmd != nil && n.cmd.Process != nil {
		_ = syscall.Kill(-n.cmd.Process.Pid, syscall.SIGKILL)
		_ = waitChild(n.cmd)
	}
	n.cmd, n.stdin, n.answerPipe, n.answers = nil, nil, nil, nil
}

// workerRunLimit bounds retained ESM imports, which Node cannot unload.
const workerRunLimit = 500

// Run writes the result's outputs to its directory, imports the emitted
// module that file names, calls its export name with args, and runs the
// Effect it returns. A program that runs longer than RunLimit is a timeout,
// and the worker restarts. An output a mutated configuration places outside
// the project's directory is never written.
func (n *Node) Run(result *Result, file, name string, args ...any) Outcome {
	return n.run(result, file, name, false, args...)
}

// RunObserved snapshots the plain traceOf export before and after the call,
// then after the Effect runs (Chapter 27 rule 1; Chapter 13 rule E11).
func (n *Node) RunObserved(result *Result, file, name string, args ...any) Outcome {
	return n.run(result, file, name, true, args...)
}

func (n *Node) run(result *Result, file, name string, observe bool, args ...any) Outcome {
	if crash := writeOutputs(result); crash != "" {
		return Outcome{Kind: "crash", Log: crash}
	}
	request, _ := json.Marshal(map[string]any{"entry": filepath.Join(result.Dir, filepath.FromSlash(file)), "name": name, "args": args, "observe": observe})
	line, failed := n.ask(request, file)
	if failed != nil {
		return *failed
	}
	var outcome Outcome
	if err := json.Unmarshal([]byte(line), &outcome); err != nil {
		return n.invalid(line)
	}
	if outcome.Kind == "crash" {
		outcome.Log += "\n" + n.printedText()
	}
	return outcome
}

// invalid restarts a worker whose answer is not JSON.
func (n *Node) invalid(line string) Outcome {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.restart("crash", "invalid worker response: "+line)
}

// printedText is the last of what the worker printed.
func (n *Node) printedText() string {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.printed.String()
}

// writeOutputs writes a result's outputs to its directory, and says why
// when it cannot.
func writeOutputs(result *Result) string {
	for path, text := range result.Outputs {
		if !filepath.IsLocal(filepath.FromSlash(path)) {
			return "an output outside the project: " + path
		}
		target := filepath.Join(result.Dir, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err.Error()
		}
		if err := os.WriteFile(target, []byte(text), 0o600); err != nil {
			return err.Error()
		}
	}
	return ""
}

// ask sends one request to the worker and returns its answer line, or the
// Outcome of a worker that crashed or did not answer within RunLimit.
func (n *Node) ask(request []byte, file string) (string, *Outcome) {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.closed {
		return "", &Outcome{Kind: "crash", Log: "Node is closed"}
	}
	if n.runs >= workerRunLimit {
		n.stop()
	}
	if n.cmd == nil {
		if err := n.start(); err != nil {
			return "", &Outcome{Kind: "crash", Log: "start: " + err.Error()}
		}
	}
	n.runs++
	type reply struct {
		line string
		err  error
	}
	replies := make(chan reply, 1)
	if _, err := n.stdin.Write(append(request, '\n')); err != nil {
		failed := n.restart("crash", err.Error())
		return "", &failed
	}
	answers := n.answers
	go func() {
		line, err := answers.ReadString('\n')
		replies <- reply{line, err}
	}()
	select {
	case r := <-replies:
		if r.err != nil {
			failed := n.restart("crash", r.err.Error())
			return "", &failed
		}
		return r.line, nil
	case <-time.After(RunLimit):
		failed := n.restart("timeout", fmt.Sprintf("%s did not finish in %v", file, RunLimit))
		return "", &failed
	}
}

func (n *Node) restart(kind, log string) Outcome {
	log += "\n" + n.printed.String()
	n.stop()
	if err := n.start(); err != nil {
		log += "\nrestart: " + err.Error()
	}
	return Outcome{Kind: kind, Log: log}
}
