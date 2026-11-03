package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const tryAssignmentCallbacksTarget = "FuzzTryAssignmentCallbacks"
const tryAssignmentCallbacksQuote = "An inferred type takes its success from what the function returns, a `return` in a parameter default included, and its errors and requirements from the Effects its body runs, exactly as `Effect.gen` infers them."

func TestTryAssignmentCallbacksQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), tryAssignmentCallbacksQuote) {
		t.Fatal("inferred type authority changed")
	}
}
func FuzzTryAssignmentCallbacks(f *testing.F) {
	startShortBudget(f)
	keys := []string{"if-plain", "if-effect", "if-block", "if-reference", "if-else-plain", "if-else-effect", "if-else-nullable", "all-plain", "absent-default", "undefined-default", "supplied-default", "dependent-default"}
	for _, key := range keys {
		for variant := uint8(0); variant < 4; variant++ {
			f.Add(key, variant)
		}
	}
	f.Add("alchemy-dataset-catch-if-assignment", uint8(0))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestTryAssignmentCallbacksQuoted(t)
		corpus := key == "alchemy-dataset-catch-if-assignment"
		if !corpus && !slices.Contains(keys, key) {
			if key == "" {
				return
			}
			key = keys[int(key[0])%len(keys)]
		}
		source := ""
		nullable := variant&1 != 0
		expectedError := "Extract<Err,{readonly _tag:\"Other\"}>"
		if corpus {
			bytes, err := os.ReadFile(filepath.Join("testdata", "try-assignment-catch-if", key+".vibe"))
			if err != nil {
				t.Fatal(err)
			}
			source = string(bytes)
			nullable = false
			expectedError = "Err"
		} else {
			result := "Item"
			if nullable {
				result = "Item|undefined"
			}
			source = "import * as Effect from \"effect/Effect\"\ninterface Item {readonly id:string}\ntype Err={readonly _tag:\"Conflict\"}|{readonly _tag:\"Other\"}\ninterface Unset {readonly sentinel:unique symbol}\ndeclare const create:()=>Effect.Effect<Item,Err>\ndeclare const update:()=>Effect.Effect<" + result + ">\ndeclare const exact:()=>Effect.Effect<Item>\ndeclare const fallback:()=>Effect.Effect<" + result + ">\ndeclare const branch:<A,B=Unset>(self:Effect.Effect<A,Err>,recovery?:()=>Effect.Effect<B>)=>Effect.Effect<A|Exclude<B,Unset>,Err>\ndeclare const dependent:<A,B=Unset,C=B>(self:Effect.Effect<A,Err>,recovery?:()=>Effect.Effect<B>)=>Effect.Effect<A|Exclude<C,Unset>,Err>\n"
			guard := "(e):e is {readonly _tag:\"Conflict\"}=>e._tag===\"Conflict\""
			callback := "()=>update()"
			if strings.Contains(key, "effect") {
				callback = "effect()=>try update()"
			}
			if key == "if-block" {
				callback = "effect()=>{return try update()}"
			}
			if key == "if-reference" {
				callback = "fallback"
			}
			expression := "try Effect.catchIf(create()," + guard + "," + callback + ")"
			switch key {
			case "if-else-plain", "if-else-effect":
				expression = "try Effect.catchIf(create()," + guard + "," + callback + ",()=>exact())"
				expectedError = "never"
			case "if-else-nullable":
				expression = "try Effect.catchIf(create()," + guard + ",()=>exact(),()=>update())"
				expectedError = "never"
			case "all-plain":
				expression = "try Effect.catch(create(),()=>update())"
				expectedError = "never"
			case "absent-default":
				expression = "try branch(create())"
				nullable = false
				expectedError = "Err"
			case "undefined-default":
				expression = "try branch(create(),undefined)"
				nullable = false
				expectedError = "Err"
			case "supplied-default":
				expression = "try branch(create()," + callback + ")"
				expectedError = "Err"
			case "dependent-default":
				expression = "try dependent(create()," + callback + ")"
				expectedError = "Err"
			}
			name := fmt.Sprintf("current%d", variant>>2)
			assignment := name + "=" + expression + ";"
			if variant&2 != 0 {
				assignment = "const filled=" + expression + ";" + name + "=filled;"
			}
			source += "export effect function caught(observed:Item|undefined){let " + name + "=observed;if(" + name + "===undefined){" + assignment + "return " + name + ".id}return " + name + ".id}\n"
		}
		source += "type Errors<T>=T extends Effect.Effect<infer _A,infer E,infer _R>?E:never\ntype Equal<A,B>=(<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?((<T>()=>T extends B?1:2) extends (<T>()=>T extends A?1:2)?true:false):false\ntype Assert<T extends true>=T\ntype ErrorProof=Assert<Equal<Errors<ReturnType<typeof caught>>," + expectedError + ">>\n"
		result, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		found := false
		label := fmt.Sprintf("%s/%d", key, variant)
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if nullable && d.Code() == 18048 {
				found = true
				continue
			}
			Gap(t, tryAssignmentCallbacksTarget, "check:"+label, "VIP-1: %s; unexpected %s\n%s", tryAssignmentCallbacksQuote, d.String(), source)
		}
		if nullable && !found {
			Gap(t, tryAssignmentCallbacksTarget, "nullable:"+label, "VIP-1: a genuinely nullable success must retain TS18048\n%s", source)
		}
	})
}
