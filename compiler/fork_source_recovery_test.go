package compiler

import (
	"strings"
	"testing"
	"unicode/utf16"
)

func TestPinnedForkSourceRecovery(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	planner := backend.(SourceRecoveryPlanner)
	for _, tc := range []struct{ name, source, want string }{
		{"empty", "", ""},
		{"ordinary", "// 🐱\r\nif (value) { go(); }", "// 🐱\r\nif (value) { go(); }"},
		{"single", "if(const x=1;x>0){use(x)}", "{ const x=1; if (x>0){use(x)} }"},
		{"branch chain", "if(let x=1;x>1){a(x)}else if(x===1){b(x)}else{c(x)}", "{ let x=1; if (x>1){a(x)}else if(x===1){b(x)}else{c(x)} }"},
		{"nested", "if(const x=1;x){if(const y=2;y){use(x,y)}}", "{ const x=1; if (x){{ const y=2; if (y){use(x,y)} }} }"},
		{"else header", "if(const x=1;false){}else if(const y=x+1;y){}", "{ const x=1; if (false){}else { const y=x+1; if (y){} } }"},
		{"Unicode", "// 🐱\nif(const 猫='😀';猫){use('é猫🐱')}", "// 🐱\n{ const 猫='😀'; if (猫){use('é猫🐱')} }"},
		{"function body semicolons", "if(const f=()=>{let x=1;return x};f()){}", "{ const f=()=>{let x=1;return x}; if (f()){} }"},
		{"regex separators", "if(const p=/[;{}()]/;p.test('x')){}", "{ const p=/[;{}()]/; if (p.test('x')){} }"},
		{"template separators", "if(const p=`;${1};`;p){}", "{ const p=`;${1};`; if (p){} }"},
		{"strings are not syntax", "const x='if(const x=1;x){}'; // if(const y=1;y){}", "const x='if(const x=1;x){}'; // if(const y=1;y){}"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := planner.RecoverSource(ctx, SourceRecoveryRequest{Text: tc.source})
			if err != nil || got.Code != tc.want || got.Changed != (tc.source != tc.want) || len(got.Diagnostics) != 0 || got.IdentityFallback {
				t.Fatalf("got=%+v err=%v; want=%q", got, err, tc.want)
			}
			// The Go binding independently validates exact UTF16 runs and total
			// coverage; a second pass must be an unchanged fixed point.
			again, err := planner.RecoverSource(ctx, SourceRecoveryRequest{Text: got.Code})
			if err != nil || again.Changed || again.Code != got.Code {
				t.Fatalf("not stable: %+v %v", again, err)
			}
		})
	}
	for _, tc := range []struct{ source, message string }{
		{"if(var x=1;x){}", "hoists"},
		{"if(x;true){}", "must begin"},
		{"if(const x=1;x;true){}", "exactly one"},
		{"if(const x=1;){}", "both a declaration"},
		{"if(const x=1;x)use(x)", "braced"},
		{"if(const x=1;x){}else use(x)", "braced"},
	} {
		t.Run("refuse "+tc.message+tc.source, func(t *testing.T) {
			prefix := "// 🐱\r\n"
			got, err := planner.RecoverSource(ctx, SourceRecoveryRequest{Text: prefix + tc.source})
			if err != nil || got.Changed || got.IdentityFallback || len(got.Diagnostics) != 1 || !strings.Contains(got.Diagnostics[0].Message, tc.message) ||
				got.Diagnostics[0].Start != len(utf16.Encode([]rune(prefix))) || len(got.RejectedStarts) != 1 || got.RejectedStarts[0] != got.Diagnostics[0].Start {
				t.Fatalf("%+v %v", got, err)
			}
		})
	}
	t.Run("rejection after prior rewrites uses both authored and derived positions", func(t *testing.T) {
		source := "// 🐱\nif(const x=1;x){} if(var y=2;y){}"
		got, err := planner.RecoverSource(ctx, SourceRecoveryRequest{Text: source})
		if err != nil || len(got.Diagnostics) != 1 || len(got.RejectedStarts) != 1 ||
			got.Diagnostics[0].Start != utf16Extent(source[:strings.Index(source, "if(var")]) ||
			got.RejectedStarts[0] != utf16Extent(got.Code[:strings.Index(got.Code, "if(var")]) {
			t.Fatalf("%+v %v", got, err)
		}
	})
	t.Run("native token kinds carry exact spellings and expression boundaries", func(t *testing.T) {
		got, err := planner.RecoverSource(ctx, SourceRecoveryRequest{Text: "// 🐱\nconst value=/[;{}]/g; `a ${value} b`; value / 2;"})
		if err != nil {
			t.Fatal(err)
		}
		found := map[string]RecoveryToken{}
		for _, token := range got.Tokens {
			found[token.Kind] = token
		}
		for _, name := range []string{"Identifier", "RegularExpressionLiteral", "TemplateHead", "TemplateTail", "SlashToken", "NumericLiteral"} {
			if found[name].Text == "" {
				t.Fatalf("missing %s: %+v", name, got.Tokens)
			}
		}
		if !found["Identifier"].EndsExpression || !found["RegularExpressionLiteral"].EndsExpression || !found["TemplateTail"].EndsExpression || found["ConstKeyword"].EndsExpression || found["SlashToken"].EndsExpression {
			t.Fatal(got.Tokens)
		}
	})
	for name, source := range map[string]string{
		"constructs": strings.Repeat("if(const x=1;x){}\n", 257),
		"iterations": strings.Repeat("if(const x=1;x){", 33) + strings.Repeat("}", 33),
	} {
		t.Run("checked fallback "+name, func(t *testing.T) {
			got, err := planner.RecoverSource(ctx, SourceRecoveryRequest{Text: source})
			if err != nil || got.Changed || got.Code != source || !got.IdentityFallback || len(got.Diagnostics) != 1 || got.Diagnostics[0].Code != "VIBE1717" {
				t.Fatalf("%+v %v", got, err)
			}
		})
	}
	for name, source := range map[string]string{
		"source units": strings.Repeat(" ", 4*1024*1024+1),
		"token count":  strings.Repeat("x;", 500_001),
	} {
		t.Run("transport budget "+name, func(t *testing.T) {
			if _, err := planner.RecoverSource(ctx, SourceRecoveryRequest{Text: source}); err == nil {
				t.Fatal("oversized input accepted")
			}
		})
	}
}
