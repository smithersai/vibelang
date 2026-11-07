package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const nativeCallbackQuote = "Every value export of Effect's `Effect` module is a global variable in a `.vibe` file"

var nativeCallbackKeys = []string{"success", "failure", "exit", "register", "cleanup", "parentheses"}

func TestNativeCallbackDirectQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), nativeCallbackQuote) {
		t.Fatal("native Effect globals quote changed")
	}
}

// This static oracle compares contextual checking of direct calls with the
// qualified export. Runtime behavior is checked by the compiler case.
func FuzzNativeCallbackDirect(f *testing.F) {
	startShortBudget(f)
	for _, key := range nativeCallbackKeys {
		f.Add(key, byte(0))
		f.Add(key, byte(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant byte) {
		TestNativeCallbackDirectQuoted(t)
		value := fmt.Sprint(int(variant) - 128)
		body := "resume => resume(Effect.succeed(" + value + "))"
		switch key {
		case "failure":
			body = "resume => resume(Effect.fail(" + value + "))"
		case "exit":
			body = "resume => resume(Exit.succeed(" + value + "))"
		case "register":
			body = "register"
		case "cleanup":
			body = "(resume, signal) => { resume(Effect.succeed(signal.aborted ? 0 : " + value + ")); return Effect.void }"
		case "parentheses":
		default:
			key = "success"
		}
		call := "callback<number, number>"
		if key == "parentheses" {
			call = "(callback)<number, number>"
		}
		prefix := "const register = (resume: (program: number!number) => void) => resume(Effect.succeed(" + value + "));"
		source := prefix + "export effect function main() { return try " + call + "(" + body + ") }"
		reference := strings.ReplaceAll(source, "callback", "Effect.callback")
		if native := compileEffectGlobal(t, w, Single(reference)); native != nil {
			t.Fatalf("invalid native callback control: %v", native)
		}
		if got := compileEffectGlobal(t, w, Single(source)); got != nil {
			Gap(t, "FuzzNativeCallbackDirect", key, "a global call must use Effect.callback's contextual signature: %v", got)
		}
		ExpectPending(t, "FuzzNativeCallbackDirect", key)
		ExpectPending(t, "FuzzNativeCallbackDirect", specCorpusKey(t))
	})
}
