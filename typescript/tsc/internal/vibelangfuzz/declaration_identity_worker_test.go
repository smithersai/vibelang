package vibelangfuzz

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type declarationIdentityProbe func(context.Context, string, string, string) (string, error)

type declarationIdentityProbePool struct {
	api   string
	slots chan *declarationIdentityWorker
	count int
	label string
}

func newDeclarationIdentityPool(ctx context.Context, api string, count int) *declarationIdentityProbePool {
	p := &declarationIdentityProbePool{api: api, count: count, slots: make(chan *declarationIdentityWorker, count)}
	for i := 0; i < count; i++ {
		p.slots <- &declarationIdentityWorker{parent: ctx, api: api}
	}
	return p
}
func newDeclarationIdentityProbePool(tb testing.TB, api string, count int) *declarationIdentityProbePool {
	tb.Helper()
	p := newDeclarationIdentityPool(tb.Context(), api, count)
	p.label = tb.Name()
	tb.Cleanup(p.Close)
	return p
}
func (p *declarationIdentityProbePool) Close() {
	var probes, failures, hits, lookups int64
	var cpu time.Duration
	var documentReads, documentHits, documentResets, peakDocumentText, peakRSS int64
	for i := 0; i < p.count; i++ {
		worker := <-p.slots
		worker.stop()
		probes += worker.probes
		failures += worker.failures
		hits += worker.cacheHits
		lookups += worker.cacheLookups
		cpu += worker.nodeCPU
		documentReads += worker.documentReads
		documentHits += worker.documentHits
		documentResets += worker.documentResets
		peakDocumentText = max(peakDocumentText, worker.peakDocumentText)
		peakRSS = max(peakRSS, worker.peakRSS)
	}
	fmt.Fprintf(os.Stderr, "declaration identity scope=%s worker-probes=%d failed=%d dependency-cache-hits=%d/%d node-cpu=%s document-cache-hits=%d/%d resets=%d peak-text-bytes=%d peak-node-rss=%d\n", p.label, probes, failures, hits, lookups, cpu, documentHits, documentReads, documentResets, peakDocumentText, peakRSS)
}

func (p *declarationIdentityProbePool) Compare(ctx context.Context, api, before, after string) (string, error) {
	if api != p.api {
		return "", fmt.Errorf("declaration identity worker API mismatch")
	}
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case worker := <-p.slots:
		defer func() { p.slots <- worker }()
		worker.label = p.label
		return worker.compare(ctx, before, after)
	}
}

// Preflight runs the stock API preflight in a pooled worker; its errors read
// as the cold command's do.
func (p *declarationIdentityProbePool) Preflight(ctx context.Context, api, dir string) ([]byte, error) {
	if api != p.api {
		return nil, fmt.Errorf("declaration identity worker API mismatch")
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case worker := <-p.slots:
		defer func() { p.slots <- worker }()
		worker.label = p.label
		records, err := worker.preflight(ctx, dir)
		if err != nil {
			return nil, fmt.Errorf("stock declaration API preflight failed: %w", err)
		}
		return records, nil
	}
}

type identityStderr struct {
	sync.Mutex
	data []byte
}

func (b *identityStderr) Write(p []byte) (int, error) {
	b.Lock()
	defer b.Unlock()
	n := len(p)
	if remain := 16384 - len(b.data); remain > 0 {
		b.data = append(b.data, p[:min(len(p), remain)]...)
	}
	return n, nil
}
func (b *identityStderr) String() string { b.Lock(); defer b.Unlock(); return string(b.data) }

type declarationIdentityWorker struct {
	documentReads, documentHits, documentResets, lastDocumentReads, lastDocumentHits, lastDocumentResets, peakDocumentText, peakRSS int64
	parent                                                                                                                          context.Context
	api                                                                                                                             string
	label                                                                                                                           string
	cmd                                                                                                                             *exec.Cmd
	input                                                                                                                           io.WriteCloser
	scanner                                                                                                                         *bufio.Scanner
	stderr                                                                                                                          *identityStderr
	serial                                                                                                                          uint64
	uses                                                                                                                            int
	probes, failures, cacheHits, cacheLookups, lastHits, lastLookups                                                                int64
	nodeCPU                                                                                                                         time.Duration
	lastExit                                                                                                                        string
}

func (w *declarationIdentityWorker) start() error {
	script := filepath.Join(Root(), "typescript/tsc/internal/vibelangfuzz/declaration_identity_worker.mjs")
	gate := filepath.Join(Root(), "scripts/api-identity.mjs")
	cmd := exec.CommandContext(w.parent, "node", "--single-threaded", "--max-old-space-size=2048", script, gate, w.api)
	input, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		input.Close()
		return err
	}
	stderr := &identityStderr{}
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		input.Close()
		output.Close()
		return err
	}
	w.cmd, w.input, w.stderr = cmd, input, stderr
	w.scanner = bufio.NewScanner(output)
	w.scanner.Buffer(make([]byte, 65536), 16<<20)
	w.uses = 0
	w.lastHits, w.lastLookups = 0, 0
	w.lastDocumentReads, w.lastDocumentHits, w.lastDocumentResets = 0, 0, 0
	w.lastExit = ""
	return nil
}
func (w *declarationIdentityWorker) stop() {
	if w.cmd == nil {
		return
	}
	w.input.Close()
	_ = w.cmd.Process.Kill()
	_ = w.cmd.Wait()
	if state := w.cmd.ProcessState; state != nil {
		w.nodeCPU += state.UserTime() + state.SystemTime()
		w.lastExit = state.String()
	}
	w.cmd, w.input, w.scanner = nil, nil, nil
	w.uses = 0
}
func (w *declarationIdentityWorker) compare(ctx context.Context, before, after string) (string, error) {
	diff, _, err := w.exchange(ctx, "", before, after)
	return diff, err
}

// preflight returns the stock API preflight's JSON error records for the
// emitted baseline in root, as the cold command prints them.
func (w *declarationIdentityWorker) preflight(ctx context.Context, root string) ([]byte, error) {
	_, records, err := w.exchange(ctx, "preflight", root, "")
	return records, err
}

func (w *declarationIdentityWorker) exchange(ctx context.Context, kind, first, second string) (string, []byte, error) {
	started := time.Now()
	if err := ctx.Err(); err != nil {
		return "", nil, err
	}
	if w.cmd == nil {
		if err := w.start(); err != nil {
			return "", nil, fmt.Errorf("start declaration identity worker: %w", err)
		}
	}
	w.serial++
	w.probes++
	request := struct {
		ID       uint64 `json:"id"`
		Kind     string `json:"kind,omitempty"`
		Root     string `json:"root,omitempty"`
		Baseline string `json:"baseline"`
		Current  string `json:"current"`
	}{ID: w.serial, Kind: kind}
	stage, what := "worker", "probe"
	if kind == "preflight" {
		request.Root = first
		stage, what = "preflight-worker", "preflight"
	} else {
		request.Baseline, request.Current = first, second
	}
	if err := json.NewEncoder(w.input).Encode(request); err != nil {
		stderr := w.stderr
		w.failures++
		w.stop()
		return "", nil, fmt.Errorf("declaration identity worker write: %w exit=%s: %.1200s", err, w.lastExit, stderr.String())
	}
	type reply struct {
		ID      uint64          `json:"id"`
		Diff    string          `json:"diff"`
		Records json.RawMessage `json:"records"`
		Error   string          `json:"error"`
		Stats   struct {
			Lookups, Hits int64
			Entries       int
			RSS           int64
			CPU           struct{ User, System int64 }
			WallMs        float64
			Files         struct{ Lookups, Hits, Entries int64 }
			Documents     struct{ Reads, Hits, Resets, TextBytes int64 }
		}
	}
	type received struct {
		reply reply
		err   error
	}
	done := make(chan received, 1)
	scanner := w.scanner
	go func() {
		var result received
		if !scanner.Scan() {
			result.err = scanner.Err()
			if result.err == nil {
				result.err = io.ErrUnexpectedEOF
			}
		} else {
			result.err = json.Unmarshal(scanner.Bytes(), &result.reply)
		}
		done <- result
	}()
	select {
	case <-ctx.Done():
		w.failures++
		w.stop()
		return "", nil, fmt.Errorf("declaration identity worker interrupted after %s: %w", time.Since(started).Round(time.Millisecond), ctx.Err())
	case result := <-done:
		if result.err != nil || result.reply.ID != w.serial {
			stderr := w.stderr
			w.failures++
			w.stop()
			return "", nil, fmt.Errorf("declaration identity worker protocol after %s: %v (reply %d, request %d) exit=%s: %.1200s", time.Since(started).Round(time.Millisecond), result.err, result.reply.ID, w.serial, w.lastExit, stderr.String())
		}
		w.cacheHits += result.reply.Stats.Hits - w.lastHits
		w.cacheLookups += result.reply.Stats.Lookups - w.lastLookups
		w.lastHits, w.lastLookups = result.reply.Stats.Hits, result.reply.Stats.Lookups
		w.documentReads += result.reply.Stats.Documents.Reads - w.lastDocumentReads
		w.documentHits += result.reply.Stats.Documents.Hits - w.lastDocumentHits
		w.documentResets += result.reply.Stats.Documents.Resets - w.lastDocumentResets
		w.lastDocumentReads, w.lastDocumentHits, w.lastDocumentResets = result.reply.Stats.Documents.Reads, result.reply.Stats.Documents.Hits, result.reply.Stats.Documents.Resets
		w.peakDocumentText = max(w.peakDocumentText, result.reply.Stats.Documents.TextBytes)
		w.peakRSS = max(w.peakRSS, result.reply.Stats.RSS)
		declarationCostRecord(w.label, stage, map[string]any{"probe": w.serial, "cpu_seconds": float64(result.reply.Stats.CPU.User+result.reply.Stats.CPU.System) / 1e6, "wall_seconds": result.reply.Stats.WallMs / 1000, "rss_bytes": result.reply.Stats.RSS, "cache_hits": result.reply.Stats.Hits, "cache_lookups": result.reply.Stats.Lookups, "file_hits": result.reply.Stats.Files.Hits, "file_lookups": result.reply.Stats.Files.Lookups, "file_entries": result.reply.Stats.Files.Entries})
		w.uses++
		// Release V8/compiler state on a fixed request bound, without dropping or
		// retrying an input. The next distinct request starts a fresh worker.
		if w.uses >= 128 {
			w.stop()
		}
		if result.reply.Error != "" {
			w.failures++
			return "", nil, fmt.Errorf("declaration identity worker %s after %s: %s", what, time.Since(started).Round(time.Millisecond), result.reply.Error)
		}
		return result.reply.Diff, result.reply.Records, nil
	}
}

func TestDeclarationIdentityWorkerStrictAPI(t *testing.T) {
	api := declarationIdentityAPI(t)
	pool := newDeclarationIdentityProbePool(t, api, 1)
	dirs := []string{t.TempDir(), t.TempDir()}
	effect := "import type * as Effect from \"effect/Effect\";\n"
	for _, row := range []struct{ name, a, b, code string }{
		{"effect", effect + "export type Value=Effect.Effect<number,string>;\n", effect + "export type Value=Effect.Effect<number,string>;\n", ""},
		{"channel", effect + "export type Value=Effect.Effect<number,string>;\n", effect + "export type Value=Effect.Effect<number,Error>;\n", ""},
		{"documentation", "/** old */\nexport declare const value:string;\n", "/** changed */\nexport declare const value:string;\n", ""},
		{"name", "export declare const value:string;\n", "export declare const renamed:string;\n", ""},
		{"missing", "export {Value} from \"pmfix-worker-missing-package\";\n", "export {Value} from \"pmfix-worker-missing-package\";\n", "TS2307"},
		{"namespace", effect + "export type Value=Effect<number>;\n", effect + "export type Value=Effect<number>;\n", "TS2709"},
		{"after-errors", "export declare const value:string;\n", "export declare const value:string;\n", ""},
	} {
		t.Run(row.name, func(t *testing.T) {
			for i, text := range []string{row.a, row.b} {
				if err := os.WriteFile(filepath.Join(dirs[i], "index.d.ts"), []byte(text), 0600); err != nil {
					t.Fatal(err)
				}
			}
			cold, coldErr := compareIdentityDeclarations(t.Context(), api, dirs[0], dirs[1])
			warm, warmErr := pool.Compare(t.Context(), api, dirs[0], dirs[1])
			if (coldErr == nil) != (warmErr == nil) {
				t.Fatalf("cold=%q %v; worker=%q %v", cold, coldErr, warm, warmErr)
			}
			if row.code != "" {
				if coldErr == nil || !strings.Contains(coldErr.Error(), row.code) || !strings.Contains(warmErr.Error(), row.code) {
					t.Fatalf("unavailable API must remain unavailable: %v / %v", coldErr, warmErr)
				}
			} else {
				if coldErr != nil || cold != warm {
					t.Fatalf("strict comparison changed: %q %v / %q %v", cold, coldErr, warm, warmErr)
				}
				if (row.name == "effect" || row.name == "after-errors") != (warm == "") {
					t.Fatalf("wrong strict identity verdict: %q", warm)
				}
			}
			for i, text := range []string{row.a, row.b} {
				actual, err := os.ReadFile(filepath.Join(dirs[i], "index.d.ts"))
				if err != nil || string(actual) != text {
					t.Fatal("worker changed a declaration snapshot", err)
				}
			}
		})
	}
}

func TestDeclarationIdentityWorkerCancellationAndCrash(t *testing.T) {
	api := declarationIdentityAPI(t)
	pool := newDeclarationIdentityProbePool(t, api, 1)
	dirs := []string{t.TempDir(), t.TempDir()}
	for _, dir := range dirs {
		if err := os.WriteFile(filepath.Join(dir, "index.d.ts"), []byte("export declare const value:string;\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	cancelled, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := pool.Compare(cancelled, api, dirs[0], dirs[1]); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled input did not fail", err)
	}
	if diff, err := pool.Compare(t.Context(), api, dirs[0], dirs[1]); err != nil || diff != "" {
		t.Fatal(diff, err)
	}
	worker := <-pool.slots
	if err := worker.cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	pool.slots <- worker
	if _, err := pool.Compare(t.Context(), api, dirs[0], dirs[1]); err == nil {
		t.Fatal("a dead worker was reported as a successful comparison")
	}
	if err := os.WriteFile(filepath.Join(dirs[1], "index.d.ts"), []byte("export declare const value:number;\n"), 0600); err != nil {
		t.Fatal(err)
	}
	// A distinct later input may start a replacement; the failed input above
	// was returned as a failure and never retried or silently passed.
	if diff, err := pool.Compare(t.Context(), api, dirs[0], dirs[1]); err != nil || diff == "" {
		t.Fatal("replacement lost a real type difference", diff, err)
	}
}

// A cached worker must preserve the cold gate's complete verdict even for
// registered cases whose ambient environment cannot currently be compared.
// This remains a parity control if the cold gate later supports that setup.
func TestDeclarationIdentityWorkerRegisteredParity(t *testing.T) {
	for _, name := range []string{"schema-exact-optional-off", "schema-exact-optional-on", "error-computed-payload-members", "declaration-identity-schema-error-fix", "declaration-identity-error"} {
		t.Run(name, func(t *testing.T) {
			archive, _ := declarationIdentityRegisteredFixture(t, name)
			w := NewWorkspace(t)
			api := declarationIdentityAPI(t)
			c, stock := compileDeclarationIdentity(t, w, archive)
			defer c.Remove()
			dir := emitDeclarationIdentityStock(t, w, StockTypeScript(t), stock)
			defer os.RemoveAll(dir)
			current := filepath.Join(c.Dir, "__identity_current")
			if err := os.MkdirAll(current, 0755); err != nil {
				t.Fatal(err)
			}
			for file, text := range c.Outputs {
				if isDeclaration(file) {
					rel, ok := strings.CutPrefix(file, "__identity_out/")
					if !ok {
						t.Fatal(file)
					}
					if err := writeInside(current, rel, text); err != nil {
						t.Fatal(err)
					}
				}
			}
			cold, coldErr := compareIdentityDeclarations(t.Context(), api, filepath.Join(dir, "__identity_out"), current)
			pool := newDeclarationIdentityProbePool(t, api, 1)
			warm, warmErr := pool.Compare(t.Context(), api, filepath.Join(dir, "__identity_out"), current)
			if (coldErr == nil) != (warmErr == nil) || cold != warm {
				t.Fatalf("cold/warm verdict changed: %q %v / %q %v", cold, coldErr, warm, warmErr)
			}
			if coldErr != nil {
				_, before, ok := strings.Cut(coldErr.Error(), "Name differences:")
				_, after, other := strings.Cut(warmErr.Error(), "Name differences:")
				if !ok || !other || strings.TrimSuffix(before, "\n") != strings.TrimSuffix(after, "\n") {
					t.Fatalf("cold/warm diagnostic changed: %v / %v", coldErr, warmErr)
				}
			}
		})
	}
}

// File diagnostics persist across a worker's comparisons under the gate's
// environment keys. A dependency whose global script changes between inputs,
// at the same paths and with the dependency's own text unchanged, must be
// checked again: the warm verdict always equals a cold process's.
func TestDeclarationIdentityWorkerFileReuseEnvironment(t *testing.T) {
	api := declarationIdentityAPI(t)
	pool := newDeclarationIdentityProbePool(t, api, 1)
	dirs := []string{t.TempDir(), t.TempDir()}
	for _, row := range []struct {
		name, ambient, code string
	}{
		{"declared", "declare type Ambient = number;\n", ""},
		{"removed", "declare type Other = number;\n", "TS2304"},
		{"restored", "declare type Ambient = number;\n", ""},
	} {
		t.Run(row.name, func(t *testing.T) {
			for _, dir := range dirs {
				for name, text := range map[string]string{
					"index.d.ts":                    "import type { Value } from \"dep\";\nexport type Public = Value;\n",
					"node_modules/dep/package.json": `{"name":"dep","version":"1.0.0","types":"index.d.ts"}`,
					"node_modules/dep/index.d.ts":   "/// <reference path=\"./globals.d.ts\" />\nexport type Value = { a: Ambient };\n",
					"node_modules/dep/globals.d.ts": row.ambient,
				} {
					if err := writeInside(dir, name, text); err != nil {
						t.Fatal(err)
					}
				}
			}
			cold, coldErr := compareIdentityDeclarations(t.Context(), api, dirs[0], dirs[1])
			warm, warmErr := pool.Compare(t.Context(), api, dirs[0], dirs[1])
			if cold != warm || (coldErr == nil) != (warmErr == nil) {
				t.Fatalf("cold=%q %v; worker=%q %v", cold, coldErr, warm, warmErr)
			}
			if row.code == "" {
				if coldErr != nil || cold != "" {
					t.Fatalf("declared ambient type must compare identical: %q %v", cold, coldErr)
				}
				return
			}
			if !strings.Contains(coldErr.Error(), row.code) || !strings.Contains(warmErr.Error(), row.code) {
				t.Fatalf("the dependency's %s must be reported again: %v / %v", row.code, coldErr, warmErr)
			}
		})
	}
}
