package vipgen

import "fmt"

// VIP-4 detail 282's exact-identity repair is compared with native Effect
// TypeScript in the existing differential runner. The generator mixes
// success and foreign primitive, object and Error exceptions with generic operands.
// The VibeLang printer never puts a forbidden throw statement in a plain thunk.
func init() {
	Register(&Construct{
		Key:      "vip04.defect-bridge",
		VIP:      4,
		Requires: []string{"vip01.effect-function", "vip05.try"},
		Citations: []Citation{{
			VIP:      4,
			Template: "Effect.orDie(Effect.try({ try: () => ‹foreign call›, catch: (error) => error }))",
			Quote:    "An `effect` function may call a function that may throw only through an Effect wrapper. The wrapped call is then run with `try` (VIP-5).",
			Reading:  "Decided detail 282 preserves a retired empty trusted wrapper through identity-mapped Effect.try followed by Effect.orDie: keep the actual thrown value and turn only that new failure channel into a defect. This is the approved replacement, not a new trust form.",
		}},
		Focus: func(g *Gen, s *Scope) []Stmt {
			g.AddFile("defect-bridge.ts", defectBridgeForeignSource, "defectBridgeForeign")
			return []Stmt{&defectBridgeProbe{value: g.Intn(9), kind: g.Intn(4), fails: g.Chance(2)}}
		},
		Stmt: func(g *Gen, s *Scope) Stmt {
			g.AddFile("defect-bridge.ts", defectBridgeForeignSource, "defectBridgeForeign")
			return &defectBridgeProbe{value: g.Intn(9), kind: g.Intn(4), fails: g.Chance(2)}
		},
	})
}

type defectBridgeProbe struct {
	value int
	kind  int
	fails bool
}

// TypeScript owns the throwing implementation; both printers import this
// same module. No @throws means unknown under VIP-4, so the call is wrapped.
const defectBridgeForeignSource = `export function defectBridgeForeign(value: number, kind: number, fails: boolean): number {
  if (!fails) return value
  switch (kind) {
    case 1: throw "bridge" + value
    case 2: throw new Error("bridge" + value)
    case 3: throw { kind: "foreign", value }
    default: throw value
  }
}
`

func (p *defectBridgeProbe) call() string {
	return fmt.Sprintf("defectBridgeForeign(%d, %d, %t)", p.value, p.kind, p.fails)
}
func (p *defectBridgeProbe) Vibe(w *Writer) {
	w.Write("try Effect.orDie(Effect.try({ try: () => " + p.call() + ", catch: (error) => error }))")
}
func (p *defectBridgeProbe) Effect(w *Writer) {
	w.Write("yield* Effect.orDie(Effect.try({ try: () => " + p.call() + ", catch: (error) => error }))")
}
func (p *defectBridgeProbe) Ends() bool { return false }
