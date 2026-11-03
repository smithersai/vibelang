package vibelang

import (
	"strings"
	"testing"
)

func TestNativeTryPlacement(t *testing.T) {
	for _, test := range []struct {
		name, source string
		count        int
	}{
		{"witness", "effect function f() { try { return 1 } catch { return 2 } }", 1},
		{"finally", "effect function f() { try { return 1 } finally {} }", 1},
		{"newline", "effect function f() { try\n{} catch {} finally {} }", 1},
		{"block", "const f = effect { try {} catch {} }", 1},
		{"arrow", "const f = effect () => { try {} catch {} }", 1},
		{"method", "class C { effect f() { try {} catch {} } }", 1},
		{"producer", "effect function* f() { try {} finally {}; yield 1 }", 1},
		{"plain", "function f() { try { return 1 } catch { return 2 } }", 0},
		{"nested plain", "effect function f() { function g() { try {} catch {} }; return 1 }", 0},
		{"plain generator", "function* f() { try { yield 1 } finally {} }", 0},
		{"async", "async function f() { try {} finally {} }", 0},
		{"nested effect", "function f() { const g = effect () => { try {} finally {} }; return g }", 1},
		{"computed class key", "effect function f() { class C { [do { try {} finally {}; \"key\" }]() {} } }", 1},
		{"class heritage", "effect function f() { class C extends (do { try {} finally {}; Object }) {} }", 1},
		{"class field", "effect function f() { class C { value = do { try {} finally {}; 1 } } }", 0},
		{"class static block", "effect function f() { class C { static { try {} finally {} } } }", 0},
		{"enum member", "effect function f() { enum E { Value = do { try {} finally {}; 1 } } }", 0},
		{"parameter default", "effect function f(value = do { try {} finally {}; 1 }) {}", 0},
		{"do expression", "effect function f() { const value = do { try {} finally {}; 1 } }", 1},
		{"synthesized binding close", "effect function f(values: Iterable<number | undefined>) { const [x = do { return 1; 1 }] = values; return x }", 0},
		{"synthesized binding close in loop", "effect function f(values: Iterable<number | undefined>) { outer: for (let i = 0; i < 2; i++) { const [x = do { if(i) return 1; return 1; 1 }] = values; return x }; return 0 }", 0},
		{"written try in binding default", "effect function f(values: Iterable<number | undefined>) { const [x = do { try {} finally {}; return 1; 1 }] = values; return x }", 1},
		{"commented keyword", "effect function f() { try /* keyword */\n{} finally {} }", 1},
		{"try operator", "effect function f() { return try Effect.succeed(1) }", 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			count := 0
			for _, d := range errorsOf(t, test.source) {
				if d.Code() == 503 {
					count++
				} else {
					t.Errorf("unexpected diagnostic: %s", d.String())
				}
			}
			if count != test.count {
				t.Fatalf("EK0503 count %d; want %d", count, test.count)
			}
		})
	}
}

func TestNativeTryFixPreservesCompletions(t *testing.T) {
	for _, test := range []struct{ name, source, keep string }{
		{"return", "export effect function f(): number!! { try { return 1 } catch { return 2 } }", "return $nativeTryCompletion.value"},
		{"match return", "error Bad; export effect function f(): number!! { try { throw new Bad() } catch(e) { return match(e) { when Bad: 1; } } }", "return $nativeTryCompletion.value"},
		{"jump comments", "export effect function f() { outer: for (let n=0;n<2;n++) { try { if(n) break /* jump */ outer; continue outer } finally {} }; return 1 }", "/* jump */"},
		{"return comments", "export effect function f() { try { return /* value */ 1 /* after */; } finally {} }", "/* value */"},
		{"comma return", "export effect function f(): number!! { let n=0; try { return n++, n } finally {} }", "return $nativeTryCompletion.value"},
		{"switch returns", "error Bad; export effect function f(n: number): number!! { try { throw new Bad() } catch { switch(n) { case 0: return 1; default: return 2 } } }", "return $nativeTryCompletion.value"},
		{"catch binding default", "error Fallback; effect function fallback(): number!Fallback! { throw new Fallback() }; export effect function f(found?: number): number!Fallback! { try { throw { id: found } as { id?: number } } catch ({ id = try fallback() }) { id += 1; return id } }", "let { id"},
		{"using Effect acquisition", "effect function resource() { return { [Symbol.dispose](): void {} } }; export effect function f(): number!! { try { using r = try resource(); return 1 } finally {} }", "using r"},
		{"using scope", "export effect function f(): number!! { try { using r = { [Symbol.dispose](): void {} }; return 1 } finally {} }", "using r"},
		{"mutable array", "export effect function f(): number[]!! { try { return [1] } finally {} }", "return $nativeTryCompletion.value"},
		{"bare return", "export effect function f(): void!! { try { return } finally {} }", "return;"},
		{"fallthrough", "export effect function f() { let n = 0; try { n = 1 } finally { n += 2 }; return n }", ".onExit("},
		{"conditional return", "export effect function f(flag: boolean): number!! { try { if (flag) return 1 } catch { return 2 }; return 3 }", "kind: \"normal\""},
		{"break", "export effect function f() { let n = 0; while (n < 3) { try { n++; break } finally { n += 2 } }; return n }", "break;"},
		{"labeled continue", "export effect function f() { let n = 0; outer: while (n < 3) { try { n++; continue outer } finally { n += 2 } }; return n }", "continue outer;"},
		{"catch failure", "error Bad; export effect function f(): number!! { try { throw new Bad() } catch (e) { return 2 } }", ".catch("},
		{"nested", "export effect function f(): number!! { try { try { return 1 } finally {} } catch { return 2 } }", "return $nativeTryCompletion"},
		{"shadowed API", "export effect function f() { const Effect = 0; try { return Effect } finally {} }", "from \"effect/Effect\""},
		{"escaped hygiene", `const \u0024nativeTryCompletion = 1; export effect function f() { try { return \u0024nativeTryCompletion } finally {} }`, "$nativeTryCompletion1"},
		{"hygiene", "const $nativeTryCompletion = 1; const $nativeTryEffect = 2; export effect function f() { try { return $nativeTryCompletion } finally {} }", "$nativeTryCompletion1"},
	} {
		t.Run(test.name, func(t *testing.T) {
			result := fixProjectOf(t, map[string]string{"main.vibe": test.source})
			fixed := fixedText(result, "main.vibe")
			if fixed == "" || !strings.Contains(fixed, test.keep) {
				t.Fatalf("missing %q:\n%s\nrefused %+v", test.keep, fixed, result.Refused)
			}
			for _, d := range errorsOf(t, fixed) {
				t.Errorf("fixed source: %s", d.String())
			}
			again := fixProjectOf(t, map[string]string{"main.vibe": fixed})
			if len(again.Files) != 0 {
				t.Fatalf("not idempotent: %+v", again.Files)
			}
		})
	}
}

func TestNativeTryFixRefusesScopeChanges(t *testing.T) {
	for _, source := range []string{
		"export effect function f() { try { var n = 1 } finally {}; return n }",
		"export effect function f() { return do { try { 1 } finally {} ; {} } }",
		"export effect function f() { try { return arguments.length } finally {} }",
		"export effect function* f() { try { yield 1 } finally {} }",
		"export effect function f(flag: boolean) { try { return flag ? 'yes' : 'no' } finally {} }",
		"export effect function f(n: 'yes' | 'no') { try { switch(n) { case 'yes': return 1; case 'no': return 2 } } finally {} }",
	} {
		result := fixProjectOf(t, map[string]string{"main.vibe": source})
		if got := fixedText(result, "main.vibe"); got != "" && !strings.Contains(got, "try {") {
			t.Fatalf("unsafe rewrite:\n%s", got)
		}
	}
}

func TestNativeTryFixRetainsInferredSignatures(t *testing.T) {
	signature := func(source string) string {
		p, file, _, _ := editorProgram(t, source)
		c, done := p.GetTypeCheckerForFile(t.Context(), file)
		defer done()
		for _, s := range file.Statements.Nodes {
			if s.Name() != nil && s.Name().Text() == "f" {
				return c.TypeToString(c.GetTypeAtLocation(s.Name()))
			}
		}
		t.Fatal("missing f")
		return ""
	}
	for _, value := range []string{"1", "match(1) { default: 1; }", "[1, 2]", "{ n: 1 }", "[1, 2] as const", "undefined"} {
		t.Run(value, func(t *testing.T) {
			source := "export effect function f() { try { return " + value + " } finally {} }"
			result := fixProjectOf(t, map[string]string{"main.vibe": source})
			fixed := fixedText(result, "main.vibe")
			if fixed == "" {
				t.Fatalf("no fix: %+v", result.Refused)
			}
			before, after := signature(source), signature(fixed)
			if before != after {
				t.Fatalf("signature changed: %s -> %s\n%s", before, after, fixed)
			}
		})
	}
}

func TestNativeTryFixKeepsDirectives(t *testing.T) {
	source := "\"use client\";\nexport effect function f() { try { return 1 } finally {} }"
	result := fixProjectOf(t, map[string]string{"main.vibe": source})
	fixed := fixedText(result, "main.vibe")
	if !strings.HasPrefix(fixed, "\"use client\";") {
		t.Fatalf("directive moved: %s", fixed)
	}
	for _, d := range errorsOf(t, fixed) {
		t.Errorf("fixed source: %s", d.String())
	}
}

func TestNativeTryRecoveryDoesNotPlanInvalidRanges(t *testing.T) {
	for _, source := range []string{
		"effect function f() { try { return 1",
		"effect function f() { try { return 1 } catch",
		"effect function f() { try { return 1 } catch (e) { return",
		"effect function f() { try { return { x: 1 } } catch ({x = (() => 1)()}) { return x",
		"effect function f() { try { if (true) return 1 } finally",
	} {
		p, file, _, _ := editorProgram(t, source)
		ds := append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...)
		if len(ds) == 0 {
			t.Fatalf("incomplete try unexpectedly accepted: %s", source)
		}
		_ = fixProjectOf(t, map[string]string{"main.vibe": source})
	}
}
