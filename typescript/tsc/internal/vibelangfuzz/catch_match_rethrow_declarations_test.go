package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestCatchMatchRethrowDeclarationsQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", "A `throw` in a plain handler is `EK0401`")
	chapterSays(t, "002-running.md", "it runs its Effects, and `throw` fails again, typed")
	chapterSays(t, "004-match.md", "It introduces no function or Effect boundary: its ordered tests and selected arm stay in the enclosing activation")
	chapterSays(t, "001-functions.md", "A slot holds such a type only in parentheses")
	chapterSays(t, "001-functions.md", "each export's type identical to `tsc`'s in both directions")
}

func FuzzCatchMatchRethrowDeclarations(f *testing.F) {
	startShortBudget(f)
	keys := []string{"reported", "plain-match", "effect-match", "effect-if", "effect-switch", "effect-all", "effect-rethrow"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	source, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "opencode-catch-match-default-rethrow.json"))
	if err != nil {
		f.Fatal(err)
	}
	var fixture struct{ Source string }
	if err := json.Unmarshal(source, &fixture); err != nil {
		f.Fatal(err)
	}
	w := NewWorkspace(f)
	tsc := annotationTwinTypeScript(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestCatchMatchRethrowDeclarationsQuoted(t)
		if !slices.Contains(keys, key) {
			if key == "" {
				key = keys[0]
			} else {
				key = keys[int(key[0])%len(keys)]
			}
		}
		mode &= 15
		text := fixture.Source
		if key != "reported" {
			text = strings.Replace(text, "void!NotFound | Failed!never", "void!(NotFound | Failed)!never", 1)
		}
		if key != "plain-match" && key != "reported" {
			text = strings.Replace(text, "catch (e)", "catch effect (e)", 1)
		}
		if key == "effect-if" {
			text = text[:strings.Index(text, "catch effect")] + "catch effect (e) => { if (e._tag === \"NotFound\") return false; throw e; }\n"
		}
		if key == "effect-switch" {
			text = text[:strings.Index(text, "catch effect")] + "catch effect (e) => { switch (e._tag) { case \"NotFound\": return false; default: throw e; } }\n"
		}
		if key == "effect-all" {
			text = strings.Replace(text, "default: throw e;", "default: false;", 1)
		}
		if key == "effect-rethrow" {
			text = text[:strings.Index(text, "catch effect")] + "catch effect (e) => { throw e; }\n"
		}
		failed, absent := "Failed", "NotFound"
		if mode&1 != 0 {
			text = strings.ReplaceAll(strings.ReplaceAll(text, "NotFound", "Absent"), "Failed", "Rejected")
			failed, absent = "Rejected", "Absent"
		}
		if mode&2 != 0 {
			text = "// Catch rethrow declaration control.\n" + text
		}
		if mode&4 != 0 {
			text = strings.ReplaceAll(text, "\n", "\r\n")
		}
		if mode&8 != 0 {
			text = strings.ReplaceAll(text, "(p:", "(π:")
			text = strings.ReplaceAll(text, "p ===", "π ===")
			text = strings.ReplaceAll(text, ": p", ": π")
			text = strings.ReplaceAll(text, "probe(p)", "probe(π)")
		}
		expected := fmt.Sprintf("%q", failed)
		if key == "effect-all" {
			expected = "never"
		}
		if key == "effect-rethrow" {
			expected = fmt.Sprintf("%q | %q", failed, absent)
		}
		check := `import type * as Effect from "effect/Effect";
import { exists } from "./candidate.js";
type ErrorOf<T> = T extends Effect.Effect<any,infer E,any> ? E : never;
type Tag<T> = T extends {_tag:infer K} ? K : never;
type Same<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
export const retained: Same<Tag<ErrorOf<ReturnType<typeof exists>>>,` + expected + `> = true;`
		if key == "effect-all" {
			check += "\nexport const exactError: Same<ErrorOf<ReturnType<typeof exists>>, never> = true;"
		}
		if mode == 0 {
			handler := `(e: NotFound | Failed) => e._tag === "NotFound" ? Effect.succeed(false) : Effect.fail(e)`
			if key == "effect-all" {
				handler = `(_e: NotFound | Failed) => Effect.succeed(false)`
			}
			if key == "effect-rethrow" {
				handler = `(e: NotFound | Failed) => Effect.fail(e)`
			}
			twin := `import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
class NotFound extends Data.TaggedError("NotFound")<{path:string}>{}
class Failed extends Data.TaggedError("Failed")<{message:string}>{}
const probe = (p:string):Effect.Effect<void,NotFound|Failed> => Effect.fail(p === "" ? new NotFound({path:p}) : new Failed({message:p}));
export const exists = (p:string) => Effect.catch(Effect.as(probe(p),true),` + handler + `);`
			out, ok := runAnnotationTwinTSC(t, w, tsc, map[string]string{"candidate.ts": twin, "check.ts": check}, `"candidate.ts","check.ts"`)
			if !ok {
				t.Fatalf("invalid stock TypeScript error-channel oracle: %s", out)
			}
		}
		r := toolsCompile(t, w, "FuzzCatchMatchRethrowDeclarations", map[string]string{"main.vibe": text})
		defer r.Remove()
		codes := map[int32]bool{}
		plainThrow := false
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				codes[d.Code()] = true
				if IsEK(d) && d.Code() == 401 {
					plainThrow = true
				}
			}
		}
		if key == "plain-match" || key == "reported" {
			if plainThrow && ((key == "plain-match" && len(codes) == 1) || (key == "reported" && codes[301] && len(codes) == 2)) {
				return
			}
			if len(codes) > 0 {
				t.Fatalf("unexpected plain-handler diagnostics: %v\n%s", SortedKeys(Keys(r.Dir, r.Diagnostics)), text)
			}
			Gap(t, "FuzzCatchMatchRethrowDeclarations", "handler:plain-match:missing-EK0401", "Chapter 2: a match arm retains its plain handler activation; throw must be EK0401\n%s", text)
			return
		}
		if len(codes) > 0 {
			t.Fatalf("effect handler source rejected: %v\n%s", SortedKeys(Keys(r.Dir, r.Diagnostics)), text)
		}
		declaration := r.Outputs["out/main.d.ts"]
		if declaration == "" {
			t.Fatal("missing declaration")
		}
		consumer := toolsCompile(t, w, "FuzzCatchMatchRethrowDeclarations", map[string]string{"candidate.d.ts": declaration, "check.ts": check})
		defer consumer.Remove()
		if !toolsErrorFree(consumer) {
			for _, d := range consumer.Diagnostics {
				if d.Category() == diagnostics.CategoryError && d.Code() != 2322 {
					t.Fatalf("unexpected declaration consumer error: %v\n%s", SortedKeys(Keys(consumer.Dir, consumer.Diagnostics)), declaration)
				}
			}
			Gap(t, "FuzzCatchMatchRethrowDeclarations", "channel:"+key, "Chapter 2 typed rethrow and Chapter 1 declaration identity retain the remaining tagged error\n%s\n%s", text, declaration)
		}
		ExpectPending(t, "FuzzCatchMatchRethrowDeclarations", "channel:"+key)
		ExpectPending(t, "FuzzCatchMatchRethrowDeclarations", specCorpusKey(t))
	})
}
