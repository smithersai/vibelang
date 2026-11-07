package vipgen

import (
	"strings"
	"testing"
)

func TestMapperJoinReferenceIndependence(t *testing.T) {
	for form := byte(0); form < 7; form++ {
		input := append(Seed("vip17.mapper-join-native-observations"), 0, 0, 0, 7, form)
		program := Generate(input, nil)
		printed := PrintEffect(program)
		if form == 3 && !strings.Contains(printed, "Fiber.join(read())") {
			t.Fatalf("factory corpus must select its keyed form: %s", printed)
		}
		g := &Gen{used: map[string]bool{}, c: chooser{data: []byte{7, form}}, files: map[string]string{}, imports: map[string][]string{}, modules: map[string]bool{}}
		s := &Scope{Fn: &Func{Name: "main"}}
		nodes := g.mapperJoinNativeObservations(s)
		vibe, effect := &Writer{mode: modeVibe}, &Writer{mode: modeEffect}
		for _, node := range nodes {
			node.Vibe(vibe)
			node.Effect(effect)
		}
		if !strings.Contains(effect.String(), "yield* Fiber.join(") || strings.Contains(effect.String(), "mappedJoin") {
			t.Fatalf("reference must use the native primitive: %s", effect.String())
		}
		if !strings.Contains(vibe.String(), "try mappedJoin") {
			t.Fatalf("actual must exercise mapper output: %s", vibe.String())
		}
		if len(g.files) != 1 {
			t.Fatalf("one native bridge, got%d", len(g.files))
		}
		for _, file := range g.files {
			if !strings.Contains(file, "__joinEffect.suspend(() => {") || !strings.Contains(file, "new Function(") || strings.Contains(file, "@ts-nocheck") {
				t.Fatalf("bridge must defer strict JavaScript without disabling source checks: %s", file)
			}
		}
	}
}
