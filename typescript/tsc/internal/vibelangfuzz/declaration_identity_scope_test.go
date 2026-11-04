package vibelangfuzz

import (
	"context"
	"strings"
	"sync"
	"testing"
)

type declarationIdentityScope struct {
	sync.Mutex
	ctx  context.Context
	name string
	pool *declarationIdentityProbePool
}

var declarationIdentityScopes = struct {
	sync.Mutex
	fuzz map[string]*declarationIdentityScope
	unit *declarationIdentityScope
}{fuzz: map[string]*declarationIdentityScope{}}

// Register AFTER the CPU guard's cleanup. Cleanup is LIFO, so workers are
// killed and waited before RUSAGE_CHILDREN is measured. Ordinary test workers
// are stopped before the fuzz window starts, never charged to a later target.
func registerDeclarationIdentityScope(tb testing.TB) {
	name := tb.Name()
	scope := &declarationIdentityScope{ctx: tb.Context(), name: name}
	declarationIdentityScopes.Lock()
	if _, exists := declarationIdentityScopes.fuzz[name]; exists {
		declarationIdentityScopes.Unlock()
		return
	}
	declarationIdentityScopes.fuzz[name] = scope
	declarationIdentityScopes.Unlock()
	tb.Cleanup(func() {
		declarationIdentityScopes.Lock()
		delete(declarationIdentityScopes.fuzz, name)
		declarationIdentityScopes.Unlock()
		scope.close()
	})
}
func (s *declarationIdentityScope) close() {
	if s == nil {
		return
	}
	s.Lock()
	p := s.pool
	s.pool = nil
	s.Unlock()
	if p != nil {
		p.Close()
	}
}
func closeDeclarationIdentityUnitWorkers() {
	declarationIdentityScopes.Lock()
	scope := declarationIdentityScopes.unit
	declarationIdentityScopes.unit = nil
	declarationIdentityScopes.Unlock()
	scope.close()
}
func declarationIdentityProbeFor(tb testing.TB, api string) declarationIdentityProbe {
	name, _, _ := strings.Cut(tb.Name(), "/")
	declarationIdentityScopes.Lock()
	scope := declarationIdentityScopes.fuzz[name]
	if scope == nil && !strings.HasPrefix(name, "Fuzz") {
		if declarationIdentityScopes.unit == nil {
			declarationIdentityScopes.unit = &declarationIdentityScope{ctx: context.Background(), name: "unit"}
		}
		scope = declarationIdentityScopes.unit
	}
	declarationIdentityScopes.Unlock()
	// An unregistered fuzz oracle retains the cold adapter. It cannot borrow
	// another target's workers and hide their CPU from its own budget.
	if scope == nil {
		return compareIdentityDeclarations
	}
	scope.Lock()
	if scope.pool == nil {
		scope.pool = newDeclarationIdentityPool(scope.ctx, api, 1)
		scope.pool.label = scope.name
	}
	pool := scope.pool
	scope.Unlock()
	if pool.api != api {
		return compareIdentityDeclarations
	}
	return pool.Compare
}
