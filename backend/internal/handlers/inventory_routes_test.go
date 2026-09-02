package handlers

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
)

// TestRegisterInventoryRoutes guards route registration itself. gin panics at
// registration time on conflicting wildcards (two different param names on the
// same path segment), and that panic only surfaces on server boot — so a bad
// route would otherwise take production down rather than fail a test.
func TestRegisterInventoryRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()

	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("inventory route registration panicked: %v", r)
		}
	}()
	RegisterInventoryRoutes(router.Group("/api/v1"))

	registered := map[string]bool{}
	for _, route := range router.Routes() {
		registered[route.Method+" "+route.Path] = true
	}

	// The pending-bill endpoints, plus a sample of the pre-existing ones, so a
	// refactor cannot quietly drop either set.
	for _, want := range []string{
		http.MethodGet + " /api/v1/inventory/pending-bills",
		http.MethodGet + " /api/v1/inventory/pending-bills/summary",
		http.MethodPost + " /api/v1/inventory/stock-lots/:lotId/confirm-bill",
		http.MethodGet + " /api/v1/inventory/cost-revisions",
		http.MethodGet + " /api/v1/inventory/projects/:projectRef/cost-confidence",
		http.MethodGet + " /api/v1/inventory/items",
		http.MethodGet + " /api/v1/inventory/stock-lots",
		http.MethodGet + " /api/v1/inventory/items/:id/stock-lots",
		http.MethodPost + " /api/v1/inventory/movements",
		http.MethodGet + " /api/v1/inventory/overview",
	} {
		if !registered[want] {
			t.Errorf("route not registered: %s", want)
		}
	}
}
