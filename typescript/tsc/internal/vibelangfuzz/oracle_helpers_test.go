package vibelangfuzz

import (
	"bytes"
	"encoding/json"
	"fmt"
	"path"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// specDiagnosticText is a diagnostic with its file, code and source line.
func specDiagnosticText(d *ast.Diagnostic) string {
	file, text := "", ""
	if d.File() != nil {
		file = path.Base(string(d.File().FileName()))
		src := d.File().Text()
		pos := d.Pos()
		for pos >= 0 && pos < len(src) && strings.ContainsRune(" \t\r\n", rune(src[pos])) {
			pos++
		}
		if pos >= 0 && pos <= len(src) {
			start := strings.LastIndex(src[:pos], "\n") + 1
			end := strings.Index(src[pos:], "\n")
			if end < 0 {
				end = len(src) - pos
			}
			text = fmt.Sprintf(" (line %d: %s)", strings.Count(src[:pos], "\n")+1, strings.TrimSpace(src[start:pos+end]))
		}
	}
	return fmt.Sprintf("%s %d: %s%s", file, d.Code(), d.String(), text)
}

// specObserved is a program's Outcome and trace.
type specObserved struct {
	Outcome Outcome
	Trace   json.RawMessage
}

// specSameOutcome compares two runs: the kind, the error's or defect's tag, the
// success value or failure's error as JSON values, the whole ordered cause
// (Chapter 17), and the trace and coldness (Chapter 27 rule 1).
func specSameOutcome(a, b specObserved) (bool, string) {
	aspect, diff := specCompare(a, b)
	return aspect == "", diff
}

// specCompare is specSameOutcome with the aspect that differs, the part of
// a gap's key that names what disagreed: "invalid" (the outcome is not one
// of Chapter 17's), "cold" (Chapter 27 rule 1), "cause", "kind" (the
// outcome's kind or tag), "value" or "trace". It is "" when the runs agree.
func specCompare(a, b specObserved) (aspect, diff string) {
	for _, o := range []specObserved{a, b} {
		switch o.Outcome.Kind {
		case "success", "failure", "defect", "interrupt":
		default:
			return "invalid", fmt.Sprintf("invalid semantic outcome %s: %s", o.Outcome.Kind, o.Outcome.Log)
		}
		if !bytes.Equal(o.Outcome.BeforeCall, o.Outcome.AfterCall) {
			return "cold", fmt.Sprintf("export is not cold: trace before call %s, after call %s", o.Outcome.BeforeCall, o.Outcome.AfterCall)
		}
	}
	if !slices.Equal(a.Outcome.Cause, b.Outcome.Cause) {
		return "cause", fmt.Sprintf("cause %v vs %v", a.Outcome.Cause, b.Outcome.Cause)
	}
	if a.Outcome.Kind != b.Outcome.Kind || a.Outcome.Tag != b.Outcome.Tag {
		return "kind", fmt.Sprintf("outcome %s %s vs %s %s", a.Outcome.Kind, a.Outcome.Tag, b.Outcome.Kind, b.Outcome.Tag)
	}
	if a.Outcome.Kind == "success" || a.Outcome.Kind == "failure" {
		var x, y any
		if err := json.Unmarshal(a.Outcome.Value, &x); err != nil {
			return "invalid", "invalid JSON value: " + err.Error()
		}
		if err := json.Unmarshal(b.Outcome.Value, &y); err != nil {
			return "invalid", "invalid JSON value: " + err.Error()
		}
		if !reflect.DeepEqual(x, y) {
			return "value", fmt.Sprintf("value %s vs %s", a.Outcome.Value, b.Outcome.Value)
		}
	}
	if !bytes.Equal(a.Trace, b.Trace) {
		return "trace", fmt.Sprintf("trace\n%s\nvs\n%s", a.Trace, b.Trace)
	}
	return "", ""
}

// specCorpusKey is the pending key of the input being run: its file name in
// testdata/fuzz/<target>/ when the input is a corpus file.
func specCorpusKey(t *testing.T) string {
	return "corpus:" + path.Base(t.Name())
}

type specGaps struct {
	t      *testing.T
	target string
	found  []specGap
}

type specGap struct{ target, key, text string }

// finish fails on each gap no pending line lists and skips when every gap
// is pending. With no gap, a pending reproduction fails as XPASS when
// final is set.
func (g *specGaps) finish(key string, final bool) {
	g.t.Helper()
	if len(g.found) == 0 {
		if final {
			ExpectPending(g.t, g.target, key)
		}
		return
	}
	var pending []string
	failed := false
	for _, f := range g.found {
		if entry, ok := Pending(f.target, f.key); ok {
			usePending(entry)
			pending = append(pending, fmt.Sprintf("%s %s (%s: %s)", f.target, f.key, entry.Owner, entry.Reason))
			continue
		}
		failed = true
		g.t.Errorf("%s %s: %s", f.target, f.key, f.text)
	}
	if failed {
		g.t.FailNow()
	}
	g.t.Skipf("pending: %s", strings.Join(pending, "; "))
}
