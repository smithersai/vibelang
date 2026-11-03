package vipgen

import (
	"math/rand/v2"
	"testing"
)

func TestRestoreMaskScope(t *testing.T) {
	var mask *Construct
	for _, c := range registry {
		if c.Key == "vip22.uninterruptible" {
			mask = c
			break
		}
	}
	if mask == nil {
		t.Fatal("missing interruption construct")
	}
	directRestore := func(body []Stmt) bool {
		for _, st := range body {
			if _, ok := st.(*Restore); ok {
				return true
			}
		}
		return false
	}
	for _, noReturn := range []bool{false, true} {
		for _, void := range []bool{false, true} {
			for _, depth := range []int{0, 1} {
				inline, ownFunction := 0, 0
				for sample := range 256 {
					r := rand.New(rand.NewPCG(uint64(sample), 22))
					data := make([]byte, 256)
					for i := range data {
						data[i] = byte(r.IntN(256))
					}
					g := &Gen{c: chooser{data: data}, used: map[string]bool{}, modules: map[string]bool{}, files: map[string]string{}, imports: map[string][]string{}, narrowed: map[string]int{}}
					scope := &Scope{Fn: &Func{Name: "parent", Void: void}, Depth: depth, NoReturn: noReturn}
					switch st := mask.Stmt(g, scope).(type) {
					case *Mask:
						if directRestore(st.Body) {
							inline++
							if noReturn {
								t.Fatalf("restore generated inline in a no-return source scope: void=%t depth=%d sample=%d", void, depth, sample)
							}
						}
					case *Seq:
						for _, child := range st.Stmts {
							fn, ok := child.(*LocalFunc)
							if !ok {
								continue
							}
							for _, body := range fn.Func.Body {
								if m, ok := body.(*Mask); ok && directRestore(m.Body) {
									ownFunction++
								}
							}
						}
					}
				}
				if ownFunction == 0 {
					t.Fatalf("lost restore coverage in fresh functions: noReturn=%t void=%t depth=%d", noReturn, void, depth)
				}
				if !noReturn && inline == 0 {
					t.Fatalf("lost inline root restore coverage: void=%t depth=%d", void, depth)
				}
			}
		}
	}
}
