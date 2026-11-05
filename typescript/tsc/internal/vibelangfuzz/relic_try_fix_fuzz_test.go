package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

func FuzzRelicTryStatementFix(f *testing.F) {
	startShortBudget(f)
	requireRelicTryRejectionQuote(f)
	if !testing.Short() {
		for _, key := range []string{"typed", "normal", "return", "failure", "defect", "interrupt", "combined", "do-completion", "held-result", "structural", "chained", "smithers-incur-finally", "smithers-invoke-finally", "cleanup-fails", "combined-cleanup-fails", "partial-return"} {
			f.Add(key, byte(7))
		}
	}
	w := NewWorkspace(f)
	var node *Node
	f.Cleanup(func() {
		if node != nil {
			node.Close()
		}
	})
	f.Fuzz(func(t *testing.T, key string, value byte) {
		if key == "partial-return" {
			source := fmt.Sprintf("error Missing\nexport effect function main(flag:boolean){try{if(flag)throw new Missing()}catch(e:Missing){return %d}}", value)
			checkRelicMigration(t, w, &node, "FuzzRelicTryStatementFix", key, source, "refused:declaration output")
			return
		}
		if key == "structural" || key == "chained" {
			chain := ""
			tag := "Missing"
			if key == "chained" && value%2 == 0 {
				tag = "Other"
			}
			if key == "chained" {
				chain = "catch (e:Other) {return e.id + 2}"
			}
			source := fmt.Sprintf("type Missing={readonly _tag:\"Missing\";id:number}; type Other={readonly _tag:\"Other\";id:number};\nexport effect function main(){try {throw {_tag:%q,id:%d} as Missing | Other} catch(e:Missing){return e.id + 1} %s}", tag, value, chain)
			checkRelicMigration(t, w, &node, "FuzzRelicTryStatementFix", key, source, "catch effect")
			return
		}
		if key == "held-result" {
			source := fmt.Sprintf("error Missing { id:number }\nexport effect function inner(){try {if(%d %% 2===0)throw new Missing({id:%d});return Effect.succeed(%d)}catch(e:Missing){return Effect.succeed(e.id+1)}}\nexport effect function main(){const held=try inner();return {effect:Effect.isEffect(held),value:try held}}", value, value, value)
			checkRelicMigration(t, w, &node, "FuzzRelicTryStatementFix", key, source, "catch effect")
			return
		}
		if key == "do-completion" {
			source := fmt.Sprintf("export effect function main(){const events:string[]=[]; const result=do {try {%d;} finally (observed) {events.push(Exit.isSuccess(observed) ? String(observed.value) : observed._tag)}}; return {result,events}}", value)
			checkRelicMigration(t, w, &node, "FuzzRelicTryStatementFix", key, source, "refused:do expression")
			return
		}
		if key == "typed" {
			source := fmt.Sprintf("error Missing { id:number }\neffect function work():number!Missing { if (%d %% 2 === 0) throw new Missing({id:%d}); return %d }\nexport effect function main() { try { return try work() } catch (e:Missing) { return e.id + 1 } }", value, value, value)
			checkRelicMigration(t, w, &node, "FuzzRelicTryStatementFix", key, source, "catch effect")
			return
		}
		body := fmt.Sprintf("events.push(\"body\"); return %d", value)
		catch := ""
		switch key {
		case "normal":
			body = "events.push(\"body\")"
		case "failure", "combined-cleanup-fails":
			body = fmt.Sprintf("return try Effect.fail(%d)", value)
		case "defect":
			body = fmt.Sprintf("return try Effect.die(%d)", value)
		case "interrupt", "smithers-incur-finally":
			// A fixed interruptor makes full Exit values comparable across runs.
			body = "return try Effect.failCause(Cause.interrupt(0))"
		case "combined":
			body = fmt.Sprintf("throw new Missing({id:%d})", value)
			catch = " catch (e: Missing) { return e.id + 1 }"
		case "smithers-invoke-finally", "cleanup-fails":
		default:
			key = "return"
		}
		source := fmt.Sprintf("error Missing { id:number }\neffect function work(events:string[]) { try { %s }%s finally (observed) { events.push(Exit.isSuccess(observed) ? String(observed.value) : observed._tag) } }\nexport effect function main() { const events:string[]=[]; const result=try Effect.exit(work(events)); return {result,events} }", body, catch)
		if key == "smithers-incur-finally" {
			source = strings.Replace(source, "events.push(Exit.isSuccess(observed) ? String(observed.value) : observed._tag)", "if (Exit.isFailure(observed) && Cause.hasInterrupts(observed.cause)) events.push(\"interrupted\")", 1)
		}
		if key == "smithers-invoke-finally" {
			source = strings.Replace(source, "effect function work(events:string[])", "const work = effect (events:string[]) =>", 1)
		}
		if key == "cleanup-fails" || key == "combined-cleanup-fails" {
			source = strings.Replace(source, "events.push(Exit.isSuccess(observed) ? String(observed.value) : observed._tag)", fmt.Sprintf("events.push(observed._tag); throw new Missing({id:%d})", value), 1)
		}
		checkRelicMigration(t, w, &node, "FuzzRelicTryStatementFix", key, source, "onExit")
	})
}

const relicTryRejectionQuote = "At the start of a statement, `try` followed by `{`, on the same line or not, begins a `try` statement, as in JavaScript, and that is an error in effect code."

func TestRelicTryRejectionQuoted(t *testing.T) { requireRelicTryRejectionQuote(t) }
func requireRelicTryRejectionQuote(t testing.TB) {
	text, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil || !strings.Contains(string(text), relicTryRejectionQuote) {
		t.Fatalf("missing retired-try rejection authority: %v", err)
	}
}
