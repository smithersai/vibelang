package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Appendix B (decided detail 212, loop round 1 ASTRA-10), quoted at test time:
// an unparenthesized execution expression on the left of `**` is EK0510, as
// ECMAScript rejects `await a ** b`. The generator places a `try` or `join`
// head on either side of `**`, `*` or `+`, parenthesized or not, under an
// optional unary prefix of the whole expression. Oracle: the program reports
// exactly one EK0510 and no other error when the bare head is the left operand
// of `**`, and compiles without errors otherwise.
const unaryPowQuote = "| `EK0510` | an unparenthesized `try`, `fork` or `join` expression on the left of `**`"

type unaryPowShape struct {
	head, op string
	paren, right, negate bool
}

func (s unaryPowShape) key() string {
	return fmt.Sprintf("%s/%s/paren=%t/right=%t/neg=%t", strings.Fields(s.head)[0], s.op, s.paren, s.right, s.negate)
}

func (s unaryPowShape) source() string {
	head := s.head
	if s.paren {
		head = "(" + head + ")"
	}
	expr := head + " " + s.op + " 2"
	if s.right {
		expr = "2 " + s.op + " " + head
	}
	if s.negate {
		expr = "-(" + expr + ")"
	}
	return "declare const a: Effect.Effect<number>\ndeclare const f: Fiber.Fiber<number>\nexport effect function main() {\n  const v = " + expr + "\n  return v\n}\n"
}

func unaryPowFrom(data []byte) unaryPowShape {
	b := func(i int) byte {
		if i < len(data) {
			return data[i]
		}
		return 0
	}
	heads := []string{"try a", "join f"}
	ops := []string{"**", "*", "+"}
	return unaryPowShape{head: heads[int(b(0))%len(heads)], op: ops[int(b(1))%len(ops)], paren: b(2)&1 != 0, right: b(2)&2 != 0, negate: b(2)&4 != 0}
}

func TestUnaryPowQuoted(t *testing.T) {
	if !strings.Contains(SpecText("900-appendices.md"), unaryPowQuote) {
		t.Fatalf("Appendix B no longer says %q", unaryPowQuote)
	}
}

func FuzzUnaryPow(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("900-appendices.md"), unaryPowQuote) {
		f.Fatalf("Appendix B no longer says %q", unaryPowQuote)
	}
	for head := byte(0); head < 2; head++ {
		for op := byte(0); op < 3; op++ {
			for flags := byte(0); flags < 8; flags += 1 {
				if op != 0 && flags > 3 {
					continue
				}
				f.Add([]byte{head, op, flags})
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		s := unaryPowFrom(data)
		source := s.source()
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		ek0510 := 0
		var others []string
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == 510 {
				ek0510++
				continue
			}
			others = append(others, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
		}
		want := s.op == "**" && !s.paren && !s.right
		switch {
		case want && (ek0510 != 1 || len(others) > 0):
			Gap(t, "FuzzUnaryPow", "missing:EK0510", "Appendix B: %s; %s gives %d EK0510 and %v:\n%s", unaryPowQuote, s.key(), ek0510, others, source)
			return
		case !want && (ek0510 > 0 || len(others) > 0):
			Gap(t, "FuzzUnaryPow", "valid:"+s.key(), "%s should compile; it gives %d EK0510 and %v:\n%s", s.key(), ek0510, others, source)
			return
		}
		if want {
			ExpectPending(t, "FuzzUnaryPow", "missing:EK0510")
		}
	})
}
