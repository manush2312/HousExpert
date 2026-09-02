package services

import (
	"context"
	"os"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"housexpert/backend/internal/database"
)

// setupTestDB points database.DB at an isolated "housexpert_test" database on a
// local MongoDB. It skips (never fails) the test when Mongo isn't reachable, so
// the suite stays green in environments without a database. It deliberately does
// NOT use the real database name, so tests never touch production/dev data.
func setupTestDB(t *testing.T) {
	t.Helper()
	if database.DB != nil {
		return
	}
	uri := firstNonEmpty(os.Getenv("TEST_MONGO_URI"), os.Getenv("MONGO_URI"), "mongodb://localhost:27017")

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		t.Skipf("MongoDB not available (%v) — skipping integration test", err)
	}
	if err := client.Ping(ctx, nil); err != nil {
		t.Skipf("MongoDB not reachable at %s (%v) — skipping integration test", uri, err)
	}
	database.DB = client.Database("housexpert_test")
}

// newTestItem creates a throwaway inventory item and registers cleanup that
// removes it along with its movements and stock lots.
func newTestItem(t *testing.T, name string) string {
	t.Helper()
	item, err := CreateInventoryItem(CreateInventoryItemInput{Name: name, Unit: "pcs"})
	if err != nil {
		t.Fatalf("CreateInventoryItem: %v", err)
	}
	t.Cleanup(func() { _ = DeleteInventoryItem(item.ItemID) })
	return item.ItemID
}

// bucketQuantities returns remaining quantity per supplier bucket for an item.
func bucketQuantities(t *testing.T, itemID string) map[string]float64 {
	t.Helper()
	lots, err := ListInventoryStockLots(itemID)
	if err != nil {
		t.Fatalf("ListInventoryStockLots: %v", err)
	}
	out := map[string]float64{}
	for _, lot := range lots {
		out[lot.SupplierBucket] += lot.RemainingQuantity
	}
	return out
}

// TestStockInKeepsSuppliersSeparate is the regression test for the bifurcation
// bug: adding stock from a second supplier to an item that already has a lot must
// create a distinct supplier bucket — even when the request carries the existing
// lot's id (the old client behaviour). Before the fix the "in" movement inherited
// that lot's supplier and merged the two.
func TestStockInKeepsSuppliersSeparate(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, "ZZ-TEST-bifurcation-"+time.Now().Format("150405.000"))

	if _, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 10, SupplierBucket: "Alpha Test",
	}); err != nil {
		t.Fatalf("stock-in Alpha: %v", err)
	}

	lots, err := ListInventoryStockLots(itemID)
	if err != nil || len(lots) != 1 {
		t.Fatalf("expected 1 lot after first stock-in, got %d (err=%v)", len(lots), err)
	}
	alphaLotID := lots[0].LotID

	// Second supplier, but the payload also carries the Alpha lot id — the exact
	// shape the buggy client sent. The new stock must still land under "Beta".
	if _, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 5, SupplierBucket: "Beta Test", LotID: alphaLotID,
	}); err != nil {
		t.Fatalf("stock-in Beta: %v", err)
	}

	buckets := bucketQuantities(t, itemID)
	if len(buckets) != 2 {
		t.Fatalf("expected 2 supplier buckets, got %d: %v", len(buckets), buckets)
	}
	if buckets["Alpha Test"] != 10 {
		t.Errorf("Alpha Test bucket = %v, want 10", buckets["Alpha Test"])
	}
	if buckets["Beta Test"] != 5 {
		t.Errorf("Beta Test bucket = %v, want 5", buckets["Beta Test"])
	}
}

// TestAdjustmentTopsUpTargetedLot guards the other half of the fix: an
// adjustment that targets a specific lot should still add to that lot and keep
// its supplier, rather than opening a new bucket.
func TestAdjustmentTopsUpTargetedLot(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, "ZZ-TEST-adjustment-"+time.Now().Format("150405.000"))

	if _, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 10, SupplierBucket: "Alpha Test",
	}); err != nil {
		t.Fatalf("stock-in Alpha: %v", err)
	}
	lots, _ := ListInventoryStockLots(itemID)
	alphaLotID := lots[0].LotID

	// Adjustment targeting the Alpha lot — even with a different supplier label it
	// tops up the existing lot and inherits Alpha's supplier.
	if _, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "adjustment", Quantity: 5, SupplierBucket: "Beta Test", LotID: alphaLotID,
	}); err != nil {
		t.Fatalf("adjustment: %v", err)
	}

	buckets := bucketQuantities(t, itemID)
	if len(buckets) != 1 {
		t.Fatalf("expected 1 supplier bucket after top-up, got %d: %v", len(buckets), buckets)
	}
	if buckets["Alpha Test"] != 15 {
		t.Errorf("Alpha Test bucket = %v, want 15", buckets["Alpha Test"])
	}
}
