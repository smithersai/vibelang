package vipgen

import (
	"fmt"
	"strings"
)

// Object member names execute in the enclosing body. Member bodies remain
// cold. Runtime coverage belongs to FuzzVIPDifferential's existing Exit and
// call-time/event comparison; the separate static target checks EK0501.
func init() {
	Register(&Construct{
		Key:      "vip01.object-member-key",
		VIP:      1,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{
			{VIP: 1, Template: "function ‹f›() { return Effect.gen(function* () { ‹body› }) }", Quote: vip01Unrun,
				Reading: "Chapter001: computed object method and accessor names evaluate in their enclosing function, like JavaScript await. Their bodies keep their own function context. This prints the chapter's Effect.gen counterpart, with key resolution and ToPropertyKey events inside the generator and member bodies uncalled."},
			{VIP: 5, Template: "yield* Effect.sync(‹callback›)", Quote: "`try e` runs the Effect `e` inside an `effect` function or block and gives its success value.",
				Reading: "The computed name is the current function's expression, so VIP5's yield* runs its key Effect at object construction. JavaScript performs the subsequent key coercion and leaves method/accessor bodies cold."},
		},
		Focus: func(g *Gen, s *Scope) []Stmt { return []Stmt{objectMemberKeyCode(g)} },
		Stmt:  func(g *Gen, s *Scope) Stmt { return objectMemberKeyCode(g) },
	})
}

func objectMemberKeyCode(g *Gen) *Code {
	g.UseEffect()
	shape := []string{"method", "getter", "setter", "effect-method", "property"}[g.Intn(5)]
	keyKind := []string{"string", "symbol", "coercion"}[g.Intn(3)]
	nested := g.Intn(2) != 0
	keyName := g.Name("key")
	resolve, coerce, body, after := g.Label(), g.Label(), g.Label(), g.Label()
	keyValue := fmt.Sprintf("%q as const", keyName)
	keyValueNative := fmt.Sprintf("%q", keyName)
	switch keyKind {
	case "symbol":
		keyValue = fmt.Sprintf("Symbol(%q)", keyName)
		keyValueNative = keyValue
	case "coercion":
		keyValue = fmt.Sprintf("({[Symbol.toPrimitive](){ev(%q);return %q}} as unknown as string)", coerce, keyName)
		keyValueNative = fmt.Sprintf("({[Symbol.toPrimitive](){ev(%q);return %q}})", coerce, keyName)
	}
	keyEffect := fmt.Sprintf("Effect.sync(() => {ev(%q);return %s})", resolve, keyValue)
	keyEffectNative := fmt.Sprintf("Effect.sync(() => {ev(%q);return %s})", resolve, keyValueNative)
	member := func(key string, native bool) string {
		switch shape {
		case "method":
			return fmt.Sprintf("[%s](){ev(%q);return 7}", key, body)
		case "getter":
			return fmt.Sprintf("get [%s](){ev(%q);return 7}", key, body)
		case "setter":
			param := "value:number"
			if native {
				param = "value"
			}
			return fmt.Sprintf("set [%s](%s){ev(%q)}", key, param, body)
		case "effect-method":
			if native {
				return fmt.Sprintf("[%s](){return Effect.gen(function*(){ev(%q);return 7})}", key, body)
			}
			return fmt.Sprintf("effect [%s](){ev(%q);return 7}", key, body)
		default:
			return fmt.Sprintf("[%s]:()=>{ev(%q);return 7}", key, body)
		}
	}
	object := g.Name("object")
	vibe := fmt.Sprintf("const %s={%s}; ev(%q);", object, member("try "+keyEffect, false), after)
	native := fmt.Sprintf("const %s={%s}; ev(%q);", object, member("yield* "+keyEffectNative, true), after)
	if nested {
		host, inner, result := g.Name("host"), g.Name("inner"), g.Name("result")
		vibe = fmt.Sprintf("function %s(){effect function %s(){%s return 1}return %s()} const %s=try %s();", host, inner, vibe, inner, result, host)
		native = fmt.Sprintf("function %s(){function %s(){return Effect.gen(function*(){%s return 1})}return %s()} const %s=yield* %s();", host, inner, native, inner, result, host)
	}
	// Generator coverage receipts can identify the selected shape without
	// reading or changing either runtime's comparison.
	mode := fmt.Sprintf("// object-member-key %s/%s/nested=%t\n", shape, keyKind, nested)
	return &Code{V: mode + vibe, E: mode + strings.TrimSpace(native)}
}
