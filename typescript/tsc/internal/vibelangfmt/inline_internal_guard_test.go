package vibelangfmt

import (
	"strings"
	"testing"
)

func TestMixedJSDocAttachment(t *testing.T) {
	for _, source := range []string{
		"export error E { /** @internal */\n/** visible field */ payload: string; value: string;\nget text(): string { return this.value }\n}\n",
		"export schema error E { /** @internal */\n/** visible field */ payload: string; value: string;\nget text(): string { return this.value }\n}\n",
		"export class E { /** @internal */\n/** visible field */ payload!: string; value!: string;\n}\n",
		"export type E = { /** @internal */\n/** visible field */ payload: string; value: string;\n}\n",
		"export error E { /** @throws {Error} */\n/** visible method */ method(): number { return 1 }\n}\n",
	} {
		t.Run(source, func(t *testing.T) {
			after := strings.Replace(source, "{ /**", "{\n/**", 1)
			if err := SameProgram(source, after); err == nil {
				t.Fatal("already-documented member gained inline JSDoc: declarations differ even when both members have JSDoc")
			}
		})
	}
}

func TestOrdinaryInternalMemberAttachment(t *testing.T) {
	for _, source := range []string{
		"export error E { /* @internal */ method(): number { return 1 } }\n",
		"export error E { /* @internal */ get value(): number { return 1 } }\n",
		"export schema error E { /* @internal */ method(): number { return 1 } }\n",
		"export schema error E { /* @internal */ get value(): number { return 1 } }\n",
		"export class E { /* @internal */ method(): number { return 1 } }\n",
		"export class E { /* @internal */ get value(): number { return 1 } }\n",
	} {
		t.Run(source, func(t *testing.T) {
			after := strings.Replace(source, "{ /*", "{\n/*", 1)
			if err := SameProgram(source, after); err == nil {
				t.Fatal("ordinary @internal member changed declaration API despite unchanged JSDoc count")
			}
		})
	}
}

func TestInternalParameterAttachmentControls(t *testing.T) {
	t.Run("first", func(t *testing.T) {
		before := "export class E { constructor(/* @internal */ public value: string) {} }\n"
		after := "export class E { constructor(\n/* @internal */ public value: string) {} }\n"
		if err := SameProgram(before, after); err != nil {
			t.Fatalf("ordinary parameter annotation meaning is unchanged: %v", err)
		}
	})
	t.Run("second", func(t *testing.T) {
		before := "export class E { constructor(left: number, /* @internal */ public value: string) {} }\n"
		after := "export class E { constructor(left: number,\n/* @internal */ public value: string) {} }\n"
		if err := SameProgram(before, after); err != nil {
			t.Fatalf("ordinary parameter annotation meaning is unchanged: %v", err)
		}
	})
	t.Run("last-note", func(t *testing.T) {
		before := "export class E { constructor(/* @internal */ /* note */ public value: string) {} }\n"
		after := "export class E { constructor(\n/* @internal */ /* note */ public value: string) {} }\n"
		if err := SameProgram(before, after); err != nil {
			t.Fatalf("ordinary parameter annotation meaning is unchanged: %v", err)
		}
	})
}
