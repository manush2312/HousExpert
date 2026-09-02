package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math"
	"testing"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"

	"housexpert/backend/internal/models"
)

// Tests for the "goods received, bill pending" flow.
//
// They run against the same throwaway housexpert_test database as the existing
// movement tests and skip when Mongo isn't reachable. Every test creates its own
// item so they stay independent and can run in any order.

// ── helpers ──────────────────────────────────────────────────────────────────

func uniqueName(prefix string) string {
	return fmt.Sprintf("ZZ-TEST-%s-%s", prefix, time.Now().Format("150405.000000"))
}

// newTestItemWithVendor creates an item carrying a vendor rate card, and cleans
// up the cost revisions the item's lots may accumulate.
func newTestItemWithVendor(t *testing.T, name, supplier string, buyPrice float64) string {
	t.Helper()
	item, err := CreateInventoryItem(CreateInventoryItemInput{
		Name: name,
		Unit: "pcs",
		VendorPricing: []InventoryVendorPricingInput{
			{SupplierName: supplier, DefaultBuyPrice: buyPrice, DefaultSellPrice: buyPrice * 1.3},
		},
	})
	if err != nil {
		t.Fatalf("CreateInventoryItem: %v", err)
	}
	t.Cleanup(func() {
		_ = DeleteInventoryItem(item.ItemID)
		_, _ = inventoryCostRevisionCol().DeleteMany(context.Background(), bson.M{"item_id": item.ItemID})
	})
	return item.ItemID
}

func cleanupRevisions(t *testing.T, itemID string) {
	t.Helper()
	t.Cleanup(func() {
		_, _ = inventoryCostRevisionCol().DeleteMany(context.Background(), bson.M{"item_id": itemID})
	})
}

func lotByID(t *testing.T, lotID string) models.InventoryStockLot {
	t.Helper()
	var lot models.InventoryStockLot
	if err := inventoryStockLotCol().FindOne(context.Background(), bson.M{"lot_id": lotID}).Decode(&lot); err != nil {
		t.Fatalf("load lot %s: %v", lotID, err)
	}
	return lot
}

func movementByID(t *testing.T, movementID string) models.InventoryMovement {
	t.Helper()
	var m models.InventoryMovement
	if err := inventoryMovementCol().FindOne(context.Background(), bson.M{"movement_id": movementID}).Decode(&m); err != nil {
		t.Fatalf("load movement %s: %v", movementID, err)
	}
	return m
}

func soleLotID(t *testing.T, itemID string) string {
	t.Helper()
	lots, err := ListInventoryStockLots(itemID)
	if err != nil {
		t.Fatalf("ListInventoryStockLots: %v", err)
	}
	if len(lots) != 1 {
		t.Fatalf("expected exactly 1 lot, got %d", len(lots))
	}
	return lots[0].LotID
}

func pendingRowFor(t *testing.T, lotID string) *models.PendingBillRow {
	t.Helper()
	rows, err := ListPendingBills()
	if err != nil {
		t.Fatalf("ListPendingBills: %v", err)
	}
	for i := range rows {
		if rows[i].LotID == lotID {
			return &rows[i]
		}
	}
	return nil
}

func approx(a, b float64) bool { return math.Abs(a-b) < 0.01 }

// ── receiving without a bill ─────────────────────────────────────────────────

// TestPricePendingReceiptIsMarkedProvisional covers the Day-1 half of the flow:
// stock is taken in at an estimate, flagged as awaiting a bill, and — crucially
// — the guess is NOT written to the item's last purchase cost, which is the
// fallback used to estimate the next receipt.
func TestPricePendingReceiptIsMarkedProvisional(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("pending-receipt"))
	cleanupRevisions(t, itemID)

	movement, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 40, UnitCost: 1150,
		SupplierBucket: "Suresh Laminates", PricePending: true,
	})
	if err != nil {
		t.Fatalf("price-pending stock in: %v", err)
	}

	if !movement.CostStatus.IsProvisional() {
		t.Errorf("movement cost status = %q, want provisional", movement.CostStatus)
	}

	lot := lotByID(t, movement.LotID)
	if !lot.CostStatus.IsProvisional() {
		t.Errorf("lot cost status = %q, want provisional", lot.CostStatus)
	}
	if lot.UnitCost != 1150 {
		t.Errorf("lot unit cost = %v, want 1150 (stock still carries the estimate)", lot.UnitCost)
	}
	if lot.EstimatedUnitCost != 1150 {
		t.Errorf("lot estimated unit cost = %v, want 1150", lot.EstimatedUnitCost)
	}
	if lot.CostSource != models.LotCostSourceManual {
		t.Errorf("cost source = %q, want manual", lot.CostSource)
	}

	item, err := GetInventoryItem(itemID)
	if err != nil {
		t.Fatalf("GetInventoryItem: %v", err)
	}
	if item.LastPurchaseCost != 0 {
		t.Errorf("last_purchase_cost = %v, want 0 — an unbilled guess must never "+
			"become the fallback used to estimate the next purchase", item.LastPurchaseCost)
	}
}

// TestPricePendingReceiptEstimatesFromVendorRateCard checks the auto-fill: with
// no rate typed, the estimate comes from the supplier's own rate card.
func TestPricePendingReceiptEstimatesFromVendorRateCard(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItemWithVendor(t, uniqueName("vendor-estimate"), "Suresh Laminates", 1150)

	movement, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 10,
		SupplierBucket: "Suresh Laminates", PricePending: true,
	})
	if err != nil {
		t.Fatalf("price-pending stock in: %v", err)
	}

	lot := lotByID(t, movement.LotID)
	if lot.UnitCost != 1150 || lot.EstimatedUnitCost != 1150 {
		t.Errorf("lot cost = %v / estimate = %v, want 1150 from the vendor rate card",
			lot.UnitCost, lot.EstimatedUnitCost)
	}
	if lot.CostSource != models.LotCostSourceVendorDefault {
		t.Errorf("cost source = %q, want vendor_default", lot.CostSource)
	}
	if movement.TotalAmount != 11500 {
		t.Errorf("movement total = %v, want 11500", movement.TotalAmount)
	}
}

// TestPricePendingFallsBackToLastPurchaseCost checks the second rung of the
// estimate ladder — an item with no vendor rate card but a known last price.
func TestPricePendingFallsBackToLastPurchaseCost(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("lastcost-estimate"))

	// A normal, billed receipt establishes the last purchase cost.
	if _, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 5, UnitCost: 900, SupplierBucket: "Alpha",
	}); err != nil {
		t.Fatalf("billed stock in: %v", err)
	}

	movement, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 5, SupplierBucket: "Alpha", PricePending: true,
	})
	if err != nil {
		t.Fatalf("price-pending stock in: %v", err)
	}
	lot := lotByID(t, movement.LotID)
	if lot.EstimatedUnitCost != 900 {
		t.Errorf("estimate = %v, want 900 from last purchase cost", lot.EstimatedUnitCost)
	}
	if lot.CostSource != models.LotCostSourceLastPurchase {
		t.Errorf("cost source = %q, want last_purchase", lot.CostSource)
	}
}

// TestIssueFromProvisionalLotInheritsStatus is what makes the cascade possible:
// stock issued from an unbilled lot is itself unbilled, so the later repricing
// knows to correct it.
func TestIssueFromProvisionalLotInheritsStatus(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("issue-inherit"))

	in, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 40, UnitCost: 1150,
		SupplierBucket: "Suresh Laminates", PricePending: true,
	})
	if err != nil {
		t.Fatalf("stock in: %v", err)
	}

	out, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "out", Quantity: 12, LotID: in.LotID,
		Party: "Sharma Residence", DocumentNumber: "PRJ-TEST-1",
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if !out.CostStatus.IsProvisional() {
		t.Errorf("issue cost status = %q, want provisional (inherited from the lot)", out.CostStatus)
	}
	if !approx(out.TotalAmount, 13800) {
		t.Errorf("issue total = %v, want 13800 at the estimated rate", out.TotalAmount)
	}
}

// ── the pending queue ────────────────────────────────────────────────────────

// TestPendingBillsListsOnlyProvisionalLots guards the screen's contents from
// both directions, including the backward-compatibility rule: a lot written
// before this feature has no cost_status at all and is settled history, so it
// must never surface as pending.
func TestPendingBillsListsOnlyProvisionalLots(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("pending-list"))

	billed, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 5, UnitCost: 100, SupplierBucket: "Billed Co",
	})
	if err != nil {
		t.Fatalf("billed stock in: %v", err)
	}
	pending, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 7, UnitCost: 200,
		SupplierBucket: "Unbilled Co", PricePending: true,
	})
	if err != nil {
		t.Fatalf("pending stock in: %v", err)
	}

	// A legacy lot: inserted with no cost_status field, exactly as lots created
	// before this feature look on disk.
	legacyLotID := "LOT-LEGACY-" + time.Now().Format("150405.000000")
	if _, err := inventoryStockLotCol().InsertOne(context.Background(), bson.M{
		"lot_id": legacyLotID, "item_id": itemID, "item_name": "legacy", "item_unit": "pcs",
		"supplier_bucket": "Legacy Co", "received_quantity": 3.0, "remaining_quantity": 3.0,
		"unit_cost": 50.0, "received_date": time.Now().Add(-72 * time.Hour),
		"created_at": time.Now(), "updated_at": time.Now(),
	}); err != nil {
		t.Fatalf("insert legacy lot: %v", err)
	}

	if row := pendingRowFor(t, pending.LotID); row == nil {
		t.Error("price-pending lot is missing from the pending bills list")
	} else {
		if !approx(row.EstimatedValue, 1400) {
			t.Errorf("estimated value = %v, want 1400 (7 × 200)", row.EstimatedValue)
		}
		if row.SupplierBucket != "Unbilled Co" {
			t.Errorf("supplier = %q, want Unbilled Co", row.SupplierBucket)
		}
	}
	if row := pendingRowFor(t, billed.LotID); row != nil {
		t.Error("a normally billed lot must not appear in pending bills")
	}
	if row := pendingRowFor(t, legacyLotID); row != nil {
		t.Error("a legacy lot with no cost_status must not appear in pending bills — " +
			"absent status means settled history, not pending")
	}
}

// TestPendingBillsReportsProjectUsage checks the "Used in:" column that tells
// the user which projects a correction will move.
func TestPendingBillsReportsProjectUsage(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("pending-usage"))

	in, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 40, UnitCost: 1150,
		SupplierBucket: "Suresh Laminates", PricePending: true,
	})
	if err != nil {
		t.Fatalf("stock in: %v", err)
	}
	for _, issue := range []struct {
		qty     float64
		party   string
		project string
	}{
		{12, "Sharma Residence", "PRJ-TEST-A"},
		{8, "Patel Villa", "PRJ-TEST-B"},
	} {
		if _, err := CreateInventoryMovement(CreateInventoryMovementInput{
			ItemID: itemID, Type: "out", Quantity: issue.qty, LotID: in.LotID,
			Party: issue.party, DocumentNumber: issue.project,
		}); err != nil {
			t.Fatalf("issue to %s: %v", issue.project, err)
		}
	}

	row := pendingRowFor(t, in.LotID)
	if row == nil {
		t.Fatal("pending row missing")
	}
	if !approx(row.ConsumedQuantity, 20) {
		t.Errorf("consumed = %v, want 20", row.ConsumedQuantity)
	}
	if !approx(row.RemainingQuantity, 20) {
		t.Errorf("remaining = %v, want 20", row.RemainingQuantity)
	}
	if len(row.UsedInProjects) != 2 {
		t.Fatalf("used-in projects = %d, want 2: %+v", len(row.UsedInProjects), row.UsedInProjects)
	}
	// Sorted by quantity descending, so Sharma (12) leads.
	if row.UsedInProjects[0].ProjectRef != "PRJ-TEST-A" || !approx(row.UsedInProjects[0].Quantity, 12) {
		t.Errorf("first usage row = %+v, want PRJ-TEST-A × 12", row.UsedInProjects[0])
	}
}

// TestPendingBillsSummaryCountsOpenLots covers the nav badge.
func TestPendingBillsSummaryCountsOpenLots(t *testing.T) {
	setupTestDB(t)

	before, err := GetPendingBillsSummary()
	if err != nil {
		t.Fatalf("GetPendingBillsSummary: %v", err)
	}

	itemID := newTestItem(t, uniqueName("summary"))
	if _, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 4, UnitCost: 250,
		SupplierBucket: "Unbilled Co", PricePending: true,
	}); err != nil {
		t.Fatalf("stock in: %v", err)
	}

	after, err := GetPendingBillsSummary()
	if err != nil {
		t.Fatalf("GetPendingBillsSummary: %v", err)
	}
	if after.PendingLots != before.PendingLots+1 {
		t.Errorf("pending lots = %d, want %d", after.PendingLots, before.PendingLots+1)
	}
	if !approx(after.EstimatedValue, before.EstimatedValue+1000) {
		t.Errorf("estimated value = %v, want %v", after.EstimatedValue, before.EstimatedValue+1000)
	}
}

// ── confirming the bill ──────────────────────────────────────────────────────

// TestConfirmLotBillCascadesToMovements is the heart of the feature, and walks
// the exact scenario the flow was designed for: 40 sheets received at an
// estimated ₹1,150, 12 issued to one project and 8 to another, then the real
// bill lands at ₹1,215.
func TestConfirmLotBillCascadesToMovements(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("cascade"))
	cleanupRevisions(t, itemID)

	in, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 40, UnitCost: 1150,
		SupplierBucket: "Suresh Laminates", PricePending: true,
	})
	if err != nil {
		t.Fatalf("stock in: %v", err)
	}
	sharma, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "out", Quantity: 12, LotID: in.LotID,
		Party: "Sharma Residence", DocumentNumber: "PRJ-TEST-A",
	})
	if err != nil {
		t.Fatalf("issue to Sharma: %v", err)
	}
	patel, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "out", Quantity: 8, LotID: in.LotID,
		Party: "Patel Villa", DocumentNumber: "PRJ-TEST-B",
	})
	if err != nil {
		t.Fatalf("issue to Patel: %v", err)
	}

	result, err := ConfirmLotBill(in.LotID, ConfirmLotBillInput{
		UnitCost: 1215, InvoiceNumber: "INV-4471", InvoiceDate: "2026-08-24",
	})
	if err != nil {
		t.Fatalf("ConfirmLotBill: %v", err)
	}

	// The lot now carries the invoiced rate and remembers the estimate it had.
	lot := lotByID(t, in.LotID)
	if lot.UnitCost != 1215 {
		t.Errorf("lot unit cost = %v, want 1215", lot.UnitCost)
	}
	if lot.CostStatus.IsProvisional() {
		t.Error("lot is still provisional after confirmation")
	}
	if lot.EstimatedUnitCost != 1150 {
		t.Errorf("estimate not preserved: got %v, want 1150", lot.EstimatedUnitCost)
	}
	if lot.InvoiceNumber != "INV-4471" {
		t.Errorf("invoice number = %q, want INV-4471", lot.InvoiceNumber)
	}

	// Every movement that carried the estimate is repriced.
	for _, tc := range []struct {
		name  string
		id    string
		qty   float64
		total float64
	}{
		{"receipt", in.MovementID, 40, 48600},
		{"Sharma issue", sharma.MovementID, 12, 14580},
		{"Patel issue", patel.MovementID, 8, 9720},
	} {
		m := movementByID(t, tc.id)
		if m.UnitCost != 1215 {
			t.Errorf("%s unit cost = %v, want 1215", tc.name, m.UnitCost)
		}
		if !approx(m.TotalAmount, tc.total) {
			t.Errorf("%s total = %v, want %v", tc.name, m.TotalAmount, tc.total)
		}
		if m.CostStatus.IsProvisional() {
			t.Errorf("%s is still provisional", tc.name)
		}
	}

	// The audit record explains the change.
	rev := result.Revision
	if rev.PreviousUnitCost != 1150 || rev.NewUnitCost != 1215 {
		t.Errorf("revision rates = %v → %v, want 1150 → 1215", rev.PreviousUnitCost, rev.NewUnitCost)
	}
	if !approx(rev.ConsumedQuantity, 20) {
		t.Errorf("revision consumed qty = %v, want 20", rev.ConsumedQuantity)
	}
	if !approx(rev.ConsumedDelta, 1300) { // 20 × 65
		t.Errorf("consumed delta = %v, want 1300", rev.ConsumedDelta)
	}
	if !approx(rev.StockDelta, 1300) { // remaining 20 × 65
		t.Errorf("stock delta = %v, want 1300", rev.StockDelta)
	}
	if !approx(rev.TotalDelta, 2600) {
		t.Errorf("total delta = %v, want 2600", rev.TotalDelta)
	}
	if len(rev.AffectedProjects) != 2 {
		t.Fatalf("affected projects = %d, want 2", len(rev.AffectedProjects))
	}
	for _, p := range rev.AffectedProjects {
		want := map[string]float64{"PRJ-TEST-A": 780, "PRJ-TEST-B": 520}[p.ProjectRef]
		if !approx(p.Delta, want) {
			t.Errorf("%s delta = %v, want %v", p.ProjectRef, p.Delta, want)
		}
	}

	// It leaves the pending queue, and the item's last purchase cost is now
	// seeded from a real invoice rather than a guess.
	if row := pendingRowFor(t, in.LotID); row != nil {
		t.Error("confirmed lot still appears in pending bills")
	}
	item, err := GetInventoryItem(itemID)
	if err != nil {
		t.Fatalf("GetInventoryItem: %v", err)
	}
	if item.LastPurchaseCost != 1215 {
		t.Errorf("last_purchase_cost = %v, want 1215 after confirmation", item.LastPurchaseCost)
	}

	// The revision is queryable as history.
	revisions, err := ListCostRevisions(itemID, 10)
	if err != nil {
		t.Fatalf("ListCostRevisions: %v", err)
	}
	if len(revisions) != 1 || revisions[0].LotID != in.LotID {
		t.Errorf("expected 1 stored revision for the lot, got %d", len(revisions))
	}
}

// TestConfirmLotBillDryRunWritesNothing covers the preview shown before the user
// commits: it must compute the full impact and leave the data untouched.
func TestConfirmLotBillDryRunWritesNothing(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("dryrun"))
	cleanupRevisions(t, itemID)

	in, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 40, UnitCost: 1150,
		SupplierBucket: "Suresh Laminates", PricePending: true,
	})
	if err != nil {
		t.Fatalf("stock in: %v", err)
	}
	out, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "out", Quantity: 12, LotID: in.LotID,
		Party: "Sharma Residence", DocumentNumber: "PRJ-TEST-A",
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}

	result, err := ConfirmLotBill(in.LotID, ConfirmLotBillInput{UnitCost: 1215, DryRun: true})
	if err != nil {
		t.Fatalf("dry-run ConfirmLotBill: %v", err)
	}
	if !result.DryRun {
		t.Error("result is not flagged as a dry run")
	}
	if !approx(result.Revision.TotalDelta, 2600) {
		t.Errorf("previewed total delta = %v, want 2600", result.Revision.TotalDelta)
	}

	if lot := lotByID(t, in.LotID); lot.UnitCost != 1150 || !lot.CostStatus.IsProvisional() {
		t.Errorf("dry run mutated the lot: cost=%v status=%q", lot.UnitCost, lot.CostStatus)
	}
	if m := movementByID(t, out.MovementID); m.UnitCost != 1150 {
		t.Errorf("dry run mutated a movement: unit cost = %v, want 1150", m.UnitCost)
	}
	if revisions, _ := ListCostRevisions(itemID, 10); len(revisions) != 0 {
		t.Errorf("dry run wrote %d revision(s), want 0", len(revisions))
	}
	if pendingRowFor(t, in.LotID) == nil {
		t.Error("dry run removed the lot from the pending queue")
	}
}

// TestConfirmLotBillRejectsNonPendingLots keeps the action honest: only a lot
// that is actually awaiting a bill can be confirmed, and only once.
func TestConfirmLotBillRejectsNonPendingLots(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("reject"))
	cleanupRevisions(t, itemID)

	billed, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 5, UnitCost: 100, SupplierBucket: "Billed Co",
	})
	if err != nil {
		t.Fatalf("billed stock in: %v", err)
	}
	if _, err := ConfirmLotBill(billed.LotID, ConfirmLotBillInput{UnitCost: 120}); err == nil {
		t.Error("confirming an already-billed lot should fail")
	}

	pending, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 5, UnitCost: 200,
		SupplierBucket: "Unbilled Co", PricePending: true,
	})
	if err != nil {
		t.Fatalf("pending stock in: %v", err)
	}
	if _, err := ConfirmLotBill(pending.LotID, ConfirmLotBillInput{UnitCost: 210}); err != nil {
		t.Fatalf("first confirmation: %v", err)
	}
	if _, err := ConfirmLotBill(pending.LotID, ConfirmLotBillInput{UnitCost: 999}); err == nil {
		t.Error("confirming the same lot twice should fail")
	}
	if _, err := ConfirmLotBill("LOT-DOES-NOT-EXIST", ConfirmLotBillInput{UnitCost: 10}); err == nil {
		t.Error("confirming an unknown lot should fail")
	}
	if _, err := ConfirmLotBill(pending.LotID, ConfirmLotBillInput{UnitCost: -1}); err == nil {
		t.Error("a negative invoice rate should be rejected")
	}
}

// TestConfirmLotBillLeavesOtherLotsAlone makes sure the cascade is scoped: a
// second supplier's stock of the same item must not move.
func TestConfirmLotBillLeavesOtherLotsAlone(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("scoped"))
	cleanupRevisions(t, itemID)

	pending, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 10, UnitCost: 1000,
		SupplierBucket: "Unbilled Co", PricePending: true,
	})
	if err != nil {
		t.Fatalf("pending stock in: %v", err)
	}
	other, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 10, UnitCost: 500, SupplierBucket: "Other Co",
	})
	if err != nil {
		t.Fatalf("other stock in: %v", err)
	}
	otherOut, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "out", Quantity: 4, LotID: other.LotID,
		Party: "Sharma Residence", DocumentNumber: "PRJ-TEST-A",
	})
	if err != nil {
		t.Fatalf("issue from other lot: %v", err)
	}

	if _, err := ConfirmLotBill(pending.LotID, ConfirmLotBillInput{UnitCost: 1200}); err != nil {
		t.Fatalf("ConfirmLotBill: %v", err)
	}

	if lot := lotByID(t, other.LotID); lot.UnitCost != 500 {
		t.Errorf("unrelated lot cost = %v, want 500", lot.UnitCost)
	}
	if m := movementByID(t, otherOut.MovementID); m.UnitCost != 500 || !approx(m.TotalAmount, 2000) {
		t.Errorf("unrelated issue moved: unit=%v total=%v, want 500 / 2000", m.UnitCost, m.TotalAmount)
	}
}

// TestConfirmLotBillSkipsExplicitlyCostedMovements: an issue given a cost of its
// own was never resting on the estimate, so the repricing must leave it alone.
func TestConfirmLotBillSkipsExplicitlyCostedMovements(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("explicit-cost"))
	cleanupRevisions(t, itemID)

	in, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 40, UnitCost: 1150,
		SupplierBucket: "Suresh Laminates", PricePending: true,
	})
	if err != nil {
		t.Fatalf("stock in: %v", err)
	}
	// Force this movement out of the provisional set the way a manual override
	// would, then confirm and check it did not move.
	out, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "out", Quantity: 10, LotID: in.LotID,
		Party: "Manual Job", DocumentNumber: "PRJ-TEST-M",
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if _, err := inventoryMovementCol().UpdateOne(context.Background(),
		bson.M{"movement_id": out.MovementID},
		bson.M{"$set": bson.M{"cost_status": string(models.LotCostConfirmed), "unit_cost": 800.0, "total_amount": 8000.0}},
	); err != nil {
		t.Fatalf("override movement cost: %v", err)
	}

	if _, err := ConfirmLotBill(in.LotID, ConfirmLotBillInput{UnitCost: 1215}); err != nil {
		t.Fatalf("ConfirmLotBill: %v", err)
	}
	if m := movementByID(t, out.MovementID); m.UnitCost != 800 || !approx(m.TotalAmount, 8000) {
		t.Errorf("explicitly costed movement was repriced: unit=%v total=%v, want 800 / 8000",
			m.UnitCost, m.TotalAmount)
	}
}

// TestConfirmLotBillDoesNotTouchLogEntries is a deliberate boundary test. A log
// entry's total_cost is the client-facing charge — driven by pricing rules and
// vendor sell prices — not the purchase cost. Repricing a purchase must leave
// the revenue side exactly as it was, or confirming a bill would silently
// rewrite what a client is charged.
func TestConfirmLotBillDoesNotTouchLogEntries(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("logentry-boundary"))
	cleanupRevisions(t, itemID)

	in, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 40, UnitCost: 1150,
		SupplierBucket: "Suresh Laminates", PricePending: true,
	})
	if err != nil {
		t.Fatalf("stock in: %v", err)
	}
	if _, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "out", Quantity: 12, LotID: in.LotID,
		Party: "Sharma Residence", DocumentNumber: "PRJ-TEST-A",
	}); err != nil {
		t.Fatalf("issue: %v", err)
	}

	entryID := primitive.NewObjectID()
	if _, err := logEntrySnapshotCol().InsertOne(context.Background(), bson.M{
		"_id": entryID, "project_id": primitive.NewObjectID(),
		"log_type_name": "Material", "category_name": "Laminate",
		"total_cost": 18000.0, "schema_version": 1, "fields": bson.A{},
		"log_date": time.Now(), "created_at": time.Now(), "updated_at": time.Now(),
		"inventory_consumption": bson.M{
			"inventory_item_id": itemID, "inventory_item_name": "laminate",
			"inventory_unit": "pcs", "consumed_quantity": 12.0, "usage_per_quantity": 1.0,
			"inventory_lot_id": in.LotID,
			"allocations": bson.A{bson.M{
				"inventory_lot_id": in.LotID, "allocated_quantity": 12.0,
			}},
		},
	}); err != nil {
		t.Fatalf("insert log entry: %v", err)
	}
	t.Cleanup(func() {
		_, _ = logEntrySnapshotCol().DeleteOne(context.Background(), bson.M{"_id": entryID})
	})

	if _, err := ConfirmLotBill(in.LotID, ConfirmLotBillInput{UnitCost: 1215}); err != nil {
		t.Fatalf("ConfirmLotBill: %v", err)
	}

	var entry struct {
		TotalCost float64 `bson:"total_cost"`
	}
	if err := logEntrySnapshotCol().FindOne(context.Background(), bson.M{"_id": entryID}).Decode(&entry); err != nil {
		t.Fatalf("reload log entry: %v", err)
	}
	if !approx(entry.TotalCost, 18000) {
		t.Errorf("log entry total_cost = %v, want 18000 — confirming a purchase bill "+
			"must not rewrite the client-facing charge", entry.TotalCost)
	}
}

// ── project confidence ───────────────────────────────────────────────────────

// TestProjectCostConfidenceSplitsBilledFromEstimated covers the project P&L
// panel: the profit figure is only as firm as the bills behind it.
func TestProjectCostConfidenceSplitsBilledFromEstimated(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("confidence"))
	cleanupRevisions(t, itemID)

	projectRef := "PRJ-CONF-" + time.Now().Format("150405.000000")
	projectOID := primitive.NewObjectID()
	if _, err := projectSnapshotCol().InsertOne(context.Background(), bson.M{
		"_id": projectOID, "project_id": projectRef, "name": "Confidence Test Project",
	}); err != nil {
		t.Fatalf("insert project: %v", err)
	}
	t.Cleanup(func() {
		_, _ = projectSnapshotCol().DeleteOne(context.Background(), bson.M{"_id": projectOID})
	})

	billed, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 10, UnitCost: 100, SupplierBucket: "Billed Co",
	})
	if err != nil {
		t.Fatalf("billed stock in: %v", err)
	}
	pending, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 10, UnitCost: 200,
		SupplierBucket: "Unbilled Co", PricePending: true,
	})
	if err != nil {
		t.Fatalf("pending stock in: %v", err)
	}
	for _, issue := range []struct {
		lotID string
		qty   float64
	}{{billed.LotID, 5}, {pending.LotID, 4}} {
		if _, err := CreateInventoryMovement(CreateInventoryMovementInput{
			ItemID: itemID, Type: "out", Quantity: issue.qty, LotID: issue.lotID,
			Party: "Confidence Test Project", DocumentNumber: projectRef,
		}); err != nil {
			t.Fatalf("issue: %v", err)
		}
	}

	// Look up by human ref and by object id — both must resolve.
	for _, ref := range []string{projectRef, projectOID.Hex()} {
		confidence, err := GetProjectCostConfidence(ref)
		if err != nil {
			t.Fatalf("GetProjectCostConfidence(%s): %v", ref, err)
		}
		if !approx(confidence.ConfirmedCost, 500) {
			t.Errorf("[%s] confirmed cost = %v, want 500", ref, confidence.ConfirmedCost)
		}
		if !approx(confidence.ProvisionalCost, 800) {
			t.Errorf("[%s] provisional cost = %v, want 800", ref, confidence.ProvisionalCost)
		}
		if !approx(confidence.TotalCost, 1300) {
			t.Errorf("[%s] total cost = %v, want 1300", ref, confidence.TotalCost)
		}
		if confidence.PendingLots != 1 {
			t.Errorf("[%s] pending lots = %d, want 1", ref, confidence.PendingLots)
		}
	}

	// After the bill lands, the whole project cost becomes firm.
	if _, err := ConfirmLotBill(pending.LotID, ConfirmLotBillInput{UnitCost: 250}); err != nil {
		t.Fatalf("ConfirmLotBill: %v", err)
	}
	confidence, err := GetProjectCostConfidence(projectRef)
	if err != nil {
		t.Fatalf("GetProjectCostConfidence: %v", err)
	}
	if confidence.ProvisionalCost != 0 {
		t.Errorf("provisional cost = %v, want 0 after confirmation", confidence.ProvisionalCost)
	}
	if !approx(confidence.ConfirmedCost, 1500) { // 500 + 4 × 250
		t.Errorf("confirmed cost = %v, want 1500", confidence.ConfirmedCost)
	}
	if confidence.PendingLots != 0 {
		t.Errorf("pending lots = %d, want 0", confidence.PendingLots)
	}
}

// ── regression: the ordinary path is unchanged ───────────────────────────────

// TestNormalReceiptFlowIsUnchanged pins the behaviour of a plain, fully-billed
// receipt — the path every existing user is on — so the new flag cannot alter
// it by default.
func TestNormalReceiptFlowIsUnchanged(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("unchanged"))

	in, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 10, UnitCost: 450, SupplierBucket: "Alpha",
	})
	if err != nil {
		t.Fatalf("stock in: %v", err)
	}
	if in.CostStatus.IsProvisional() {
		t.Error("a normal receipt must not be provisional")
	}
	if in.UnitCost != 450 || !approx(in.TotalAmount, 4500) {
		t.Errorf("movement cost = %v / %v, want 450 / 4500", in.UnitCost, in.TotalAmount)
	}

	item, err := GetInventoryItem(itemID)
	if err != nil {
		t.Fatalf("GetInventoryItem: %v", err)
	}
	if item.LastPurchaseCost != 450 {
		t.Errorf("last_purchase_cost = %v, want 450 — normal receipts still seed it", item.LastPurchaseCost)
	}
	if item.CurrentStock != 10 {
		t.Errorf("current stock = %v, want 10", item.CurrentStock)
	}

	out, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "out", Quantity: 4, LotID: in.LotID, Party: "Site A",
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if out.CostStatus.IsProvisional() {
		t.Error("an issue from a billed lot must not be provisional")
	}
	if out.UnitCost != 450 || !approx(out.TotalAmount, 1800) {
		t.Errorf("issue cost = %v / %v, want 450 / 1800", out.UnitCost, out.TotalAmount)
	}
	if lotID := soleLotID(t, itemID); lotID != in.LotID {
		t.Errorf("lot id changed: %s vs %s", lotID, in.LotID)
	}
	if lot := lotByID(t, in.LotID); lot.RemainingQuantity != 6 {
		t.Errorf("remaining = %v, want 6", lot.RemainingQuantity)
	}
}

// TestPricePendingIgnoredOnIssues guards against the flag leaking onto outgoing
// stock, where it has no meaning: an issue always inherits its lot's status.
func TestPricePendingIgnoredOnIssues(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("flag-on-issue"))

	in, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 10, UnitCost: 300, SupplierBucket: "Alpha",
	})
	if err != nil {
		t.Fatalf("stock in: %v", err)
	}
	out, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "out", Quantity: 3, LotID: in.LotID,
		Party: "Site A", PricePending: true,
	})
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if out.CostStatus.IsProvisional() {
		t.Error("price_pending on an issue must be ignored — it inherits the lot's status")
	}
}

// TestPricePendingIgnoredWhenToppingUpExistingLot closes the stranding hole: an
// adjustment onto an existing billed lot must inherit that lot's status even if
// the flag is set, because ConfirmLotBill operates on lots — a provisional
// movement under a confirmed lot could never be corrected.
func TestPricePendingIgnoredWhenToppingUpExistingLot(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("topup-flag"))

	in, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 10, UnitCost: 300, SupplierBucket: "Alpha",
	})
	if err != nil {
		t.Fatalf("stock in: %v", err)
	}

	topUp, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "adjustment", Quantity: 5, LotID: in.LotID,
		SupplierBucket: "Alpha", PricePending: true,
	})
	if err != nil {
		t.Fatalf("adjustment top-up: %v", err)
	}
	if topUp.CostStatus.IsProvisional() {
		t.Error("a top-up onto a billed lot must inherit the lot's confirmed status")
	}
	if lot := lotByID(t, in.LotID); lot.CostStatus.IsProvisional() {
		t.Error("the existing lot must not be flipped to provisional by a top-up")
	}
	if pendingRowFor(t, in.LotID) != nil {
		t.Error("a billed lot topped up with the flag set must not enter the pending queue")
	}
}

// TestAdjustmentOntoProvisionalLotStaysProvisional is the mirror case: topping
// up an unbilled lot keeps the new stock unbilled too, so the eventual bill
// corrects all of it.
func TestAdjustmentOntoProvisionalLotStaysProvisional(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("topup-provisional"))
	cleanupRevisions(t, itemID)

	in, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 10, UnitCost: 1000,
		SupplierBucket: "Unbilled Co", PricePending: true,
	})
	if err != nil {
		t.Fatalf("stock in: %v", err)
	}
	topUp, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "adjustment", Quantity: 5, LotID: in.LotID, SupplierBucket: "Unbilled Co",
	})
	if err != nil {
		t.Fatalf("adjustment: %v", err)
	}
	if !topUp.CostStatus.IsProvisional() {
		t.Error("a top-up onto an unbilled lot should itself be unbilled")
	}

	// Confirming reprices the top-up along with the original receipt.
	if _, err := ConfirmLotBill(in.LotID, ConfirmLotBillInput{UnitCost: 1200}); err != nil {
		t.Fatalf("ConfirmLotBill: %v", err)
	}
	if m := movementByID(t, topUp.MovementID); m.UnitCost != 1200 || !approx(m.TotalAmount, 6000) {
		t.Errorf("top-up not repriced: unit=%v total=%v, want 1200 / 6000", m.UnitCost, m.TotalAmount)
	}
}

// TestConfirmLotBillPreviewSerialisesEmptyProjects is a regression test for a
// crash in the confirmation dialog.
//
// A lot that has not been issued to any project yet produces no usage rows, and
// a nil Go slice marshals to JSON null. The dialog maps over that list directly,
// so null took the whole modal down — on the most ordinary path there is:
// stock received, bill arrives, nothing logged against it yet.
//
// The assertion is deliberately made against the marshalled JSON rather than the
// Go value, because the Go value (nil slice) is harmless and ranges fine; only
// the wire format broke the client.
func TestConfirmLotBillPreviewSerialisesEmptyProjects(t *testing.T) {
	setupTestDB(t)
	itemID := newTestItem(t, uniqueName("empty-projects"))
	cleanupRevisions(t, itemID)

	in, err := CreateInventoryMovement(CreateInventoryMovementInput{
		ItemID: itemID, Type: "in", Quantity: 40, UnitCost: 1150,
		SupplierBucket: "Suresh Laminates", PricePending: true,
	})
	if err != nil {
		t.Fatalf("stock in: %v", err)
	}

	for _, dryRun := range []bool{true, false} {
		result, err := ConfirmLotBill(in.LotID, ConfirmLotBillInput{UnitCost: 1215, DryRun: dryRun})
		if err != nil {
			t.Fatalf("ConfirmLotBill(dry_run=%v): %v", dryRun, err)
		}
		if result.Projects == nil {
			t.Errorf("dry_run=%v: Projects is nil", dryRun)
		}
		raw, err := json.Marshal(result)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		if bytes.Contains(raw, []byte(`"projects":null`)) {
			t.Errorf("dry_run=%v: projects serialised as null — the confirmation "+
				"dialog maps over this list and null crashes it", dryRun)
		}
		if !bytes.Contains(raw, []byte(`"projects":[]`)) {
			t.Errorf("dry_run=%v: expected an empty projects array in %s", dryRun, raw)
		}
	}
}
