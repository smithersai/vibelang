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
	// preflight is its own process, so the probe worker's bounded document
	// cache holds only what the probes parse.
	preflight *declarationIdentityProbePool
	stock     *stockDeclarationWorker
	tb        testing.TB
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
	scope := &declarationIdentityScope{ctx: tb.Context(), name: name, tb: tb}
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
	preflight := s.preflight
	stock := s.stock
	s.stock = nil
	s.pool = nil
	s.preflight = nil
	s.Unlock()
	if p != nil {
		p.Close()
	}
	if preflight != nil {
		preflight.Close()
	}
	if stock != nil {
		if err := stock.Close(); err != nil {
			s.tb.Errorf("stock declaration worker shutdown: %v", err)
		}
	}
}
func closeDeclarationIdentityUnitWorkers() {
	declarationIdentityScopes.Lock()
	scope := declarationIdentityScopes.unit
	declarationIdentityScopes.unit = nil
	declarationIdentityScopes.Unlock()
	scope.close()
}
func declarationIdentityScopeOf(tb testing.TB) *declarationIdentityScope {
	name, _, _ := strings.Cut(tb.Name(), "/")
	declarationIdentityScopes.Lock()
	defer declarationIdentityScopes.Unlock()
	scope := declarationIdentityScopes.fuzz[name]
	if scope == nil && !strings.HasPrefix(name, "Fuzz") {
		if declarationIdentityScopes.unit == nil {
			declarationIdentityScopes.unit = &declarationIdentityScope{ctx: context.Background(), name: "unit"}
		}
		scope = declarationIdentityScopes.unit
	}
	return scope
}

// declarationIdentityPreflightFor returns the stock API preflight of tb's
// scope, one long-lived worker; an unregistered fuzz oracle runs it cold.
func declarationIdentityPreflightFor(tb testing.TB, api string) stockAPIRecords {
	scope := declarationIdentityScopeOf(tb)
	if scope == nil {
		return coldStockAPIRecords
	}
	scope.Lock()
	if scope.preflight == nil {
		scope.preflight = newDeclarationIdentityPool(scope.ctx, api, 1)
		scope.preflight.label = scope.name + "/preflight"
	}
	pool := scope.preflight
	scope.Unlock()
	if pool.api != api {
		return coldStockAPIRecords
	}
	return pool.Preflight
}

func declarationIdentityProbeFor(tb testing.TB, api string) declarationIdentityProbe {
	scope := declarationIdentityScopeOf(tb)
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
