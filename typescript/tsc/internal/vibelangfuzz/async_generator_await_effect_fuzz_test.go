package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

const asyncGeneratorAwaitEffectQuote = "and so is `await` on an Effect inside an `async` function"

func TestAsyncGeneratorAwaitEffectQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), asyncGeneratorAwaitEffectQuote) {
		t.Fatal("async await Effect rule changed")
	}
}

// VIP-5 checks the awaited value even when an async generator writes its
// native iterator contract. Vary the contract, callable form and operand type.
func FuzzAsyncGeneratorAwaitEffect(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("002-running.md"), asyncGeneratorAwaitEffectQuote) {
		f.Fatal("async await Effect rule changed")
	}
	domains := []struct {
		key, typ string
		reject   bool
	}{
		{"effect", "Effect.Effect<number>", true},
		{"effect-union", "Effect.Effect<number>|undefined", true},
		{"promise", "Promise<number>", false},
		{"value", "number", false},
		{"any", "any", false},
		{"unknown", "unknown", false},
	}
	for _, d := range domains {
		f.Add([]byte(d.key), uint8(0))
		f.Add([]byte(d.key), uint8(3))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte, variant uint8) {
		key := string(data)
		index := 0
		if len(data) > 0 {
			index = int(data[0]) % len(domains)
		}
		for i, d := range domains {
			if key == d.key {
				index = i
				break
			}
		}
		d := domains[index]
		annotation := []string{": AsyncGenerator<number,void,unknown>", ": AsyncIterator<number>", ": AsyncIterableIterator<number>", ": AsyncIterable<number>", ": (AsyncGenerator<number,void,unknown>)", ""}[int(variant)%6]
		forms := []string{"export async function* values()%s { %s; yield 2 }", "export const values=async function* ()%s { %s; yield 2 }", "export class Feed { async *values()%s { %s; yield 2 } }", "export const feed={async *values()%s { %s; yield 2 }}"}
		body := fmt.Sprintf(forms[int(variant/6)%len(forms)], annotation, "await /* operand */ input")
		source := "import {Effect} from \"effect\"; declare const input:" + d.typ + "; " + body
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		found := false
		for _, diag := range r.Diagnostics {
			if IsEK(diag) && diag.Code() == 103 {
				found = true
			} else if diag.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzAsyncGeneratorAwaitEffect", d.key, "unexpected diagnostic: %s\n%s", diag.String(), source)
				return
			}
		}
		if found != d.reject {
			Gap(t, "FuzzAsyncGeneratorAwaitEffect", d.key, "%s; EK0103=%v, want %v\n%s", asyncGeneratorAwaitEffectQuote, found, d.reject, source)
		}
		ExpectPending(t, "FuzzAsyncGeneratorAwaitEffect", d.key)
		ExpectPending(t, "FuzzAsyncGeneratorAwaitEffect", specCorpusKey(t))
	})
}
