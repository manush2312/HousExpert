package services

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"housexpert/backend/internal/database"
	"housexpert/backend/internal/models"
	"housexpert/backend/internal/utils"
)

// This file implements the "goods received, bill pending" flow.
//
// Stock often arrives days before the supplier's invoice. Rather than force a
// guess to harden into fact, a receipt can be marked price-pending: the lot is
// valued at an estimate and flagged provisional, work carries on as normal, and
// when the bill turns up ConfirmLotBill rewrites the lot AND every movement
// that drew from it, so each project's cost becomes the real one.
//
// Backward compatibility rule observed throughout: a lot with no cost_status is
// settled history, so queries always look for the provisional value explicitly
// and never for equality with "confirmed".

func inventoryCostRevisionCol() *mongo.Collection {
	return database.Collection("inventory_cost_revisions")
}

// provisionalFilter matches only lots/movements explicitly flagged as awaiting
// a bill. Legacy documents, which carry no cost_status at all, never match.
func provisionalFilter() bson.M {
	return bson.M{"cost_status": string(models.LotCostProvisional)}
}

func daysSince(t time.Time) int {
	if t.IsZero() {
		return 0
	}
	d := int(math.Floor(time.Since(t).Hours() / 24))
	if d < 0 {
		return 0
	}
	return d
}

func roundMoney(v float64) float64 {
	return math.Round(v*100) / 100
}

// ── Reading the pending queue ────────────────────────────────────────────────

func listProvisionalLots(itemID string) ([]models.InventoryStockLot, error) {
	filter := provisionalFilter()
	if trimOrEmpty(itemID) != "" {
		filter["item_id"] = trimOrEmpty(itemID)
	}
	ctx := context.Background()
	cursor, err := inventoryStockLotCol().Find(ctx, filter,
		&options.FindOptions{Sort: bson.D{{Key: "received_date", Value: 1}, {Key: "created_at", Value: 1}}},
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var lots []models.InventoryStockLot
	if err := cursor.All(ctx, &lots); err != nil {
		return nil, err
	}
	return lots, nil
}

// projectUsageForLots reports, per lot, how much of it has been issued to each
// project. It reads the out-movements once for the whole set rather than per
// lot, and resolves project object ids in a single follow-up query.
func projectUsageForLots(lotIDs []string) (map[string][]models.InventoryCostRevisionSplit, map[string]float64, error) {
	usage := map[string][]models.InventoryCostRevisionSplit{}
	consumed := map[string]float64{}
	if len(lotIDs) == 0 {
		return usage, consumed, nil
	}

	ctx := context.Background()
	cursor, err := inventoryMovementCol().Find(ctx, bson.M{
		"lot_id": bson.M{"$in": lotIDs},
		"type":   string(models.InventoryMovementOut),
	})
	if err != nil {
		return nil, nil, err
	}
	defer cursor.Close(ctx)

	var movements []models.InventoryMovement
	if err := cursor.All(ctx, &movements); err != nil {
		return nil, nil, err
	}

	// lot id → project ref → running split
	grouped := map[string]map[string]*models.InventoryCostRevisionSplit{}
	projectRefs := map[string]bool{}
	for _, m := range movements {
		qty := math.Abs(m.Quantity)
		consumed[m.LotID] += qty

		ref := trimOrEmpty(m.DocumentNumber)
		name := trimOrEmpty(m.Party)
		key := firstNonEmpty(ref, name, "Unassigned")
		if ref != "" {
			projectRefs[ref] = true
		}
		if grouped[m.LotID] == nil {
			grouped[m.LotID] = map[string]*models.InventoryCostRevisionSplit{}
		}
		split, ok := grouped[m.LotID][key]
		if !ok {
			split = &models.InventoryCostRevisionSplit{ProjectRef: ref, ProjectName: name}
			grouped[m.LotID][key] = split
		}
		split.Quantity += qty
		split.PreviousAmount += m.TotalAmount
		split.MovementIDCount++
	}

	// Resolve human project refs (PRJ-001) to object ids so the UI can link out.
	projectOIDByRef := map[string]string{}
	projectNameByRef := map[string]string{}
	if len(projectRefs) > 0 {
		refs := make([]string, 0, len(projectRefs))
		for ref := range projectRefs {
			refs = append(refs, ref)
		}
		pCursor, err := projectSnapshotCol().Find(ctx, bson.M{"project_id": bson.M{"$in": refs}})
		if err == nil {
			var projects []struct {
				ID        primitive.ObjectID `bson:"_id"`
				ProjectID string             `bson:"project_id"`
				Name      string             `bson:"name"`
			}
			if err := pCursor.All(ctx, &projects); err == nil {
				for _, p := range projects {
					projectOIDByRef[p.ProjectID] = p.ID.Hex()
					projectNameByRef[p.ProjectID] = p.Name
				}
			}
			pCursor.Close(ctx)
		}
	}

	for lotID, byProject := range grouped {
		rows := make([]models.InventoryCostRevisionSplit, 0, len(byProject))
		for _, split := range byProject {
			split.ProjectID = projectOIDByRef[split.ProjectRef]
			if split.ProjectName == "" {
				split.ProjectName = projectNameByRef[split.ProjectRef]
			}
			split.PreviousAmount = roundMoney(split.PreviousAmount)
			rows = append(rows, *split)
		}
		sort.Slice(rows, func(i, j int) bool { return rows[i].Quantity > rows[j].Quantity })
		usage[lotID] = rows
	}
	return usage, consumed, nil
}

// ListPendingBills returns every lot still awaiting a supplier bill, oldest
// first, with the projects that have already consumed from it.
func ListPendingBills() ([]models.PendingBillRow, error) {
	lots, err := listProvisionalLots("")
	if err != nil {
		return nil, err
	}
	if len(lots) == 0 {
		return []models.PendingBillRow{}, nil
	}

	lotIDs := make([]string, 0, len(lots))
	itemIDs := make([]string, 0, len(lots))
	for i := range lots {
		lotIDs = append(lotIDs, lots[i].LotID)
		itemIDs = append(itemIDs, lots[i].ItemID)
	}

	usage, consumed, err := projectUsageForLots(lotIDs)
	if err != nil {
		return nil, err
	}

	// Items are loaded to recompute a suggested rate — the vendor rate card may
	// have been filled in after the stock was received.
	itemByID := map[string]*models.InventoryItem{}
	ctx := context.Background()
	cursor, err := inventoryItemCol().Find(ctx, bson.M{"item_id": bson.M{"$in": itemIDs}})
	if err == nil {
		var items []models.InventoryItem
		if err := cursor.All(ctx, &items); err == nil {
			for i := range items {
				itemByID[items[i].ItemID] = &items[i]
			}
		}
		cursor.Close(ctx)
	}

	rows := make([]models.PendingBillRow, 0, len(lots))
	for i := range lots {
		lot := lots[i]
		estimate := costFallback(lot.EstimatedUnitCost, lot.UnitCost)
		suggested := estimate
		if item := itemByID[lot.ItemID]; item != nil {
			if guess, _ := estimateUnitCostForReceipt(item, lot.SupplierBucket); guess > 0 {
				suggested = guess
			}
		}
		rows = append(rows, models.PendingBillRow{
			LotID:             lot.LotID,
			ItemID:            lot.ItemID,
			ItemName:          lot.ItemName,
			ItemUnit:          lot.ItemUnit,
			SupplierBucket:    lot.SupplierBucket,
			ReceivedQuantity:  lot.ReceivedQuantity,
			RemainingQuantity: lot.RemainingQuantity,
			ConsumedQuantity:  roundMoney(consumed[lot.LotID]),
			EstimatedUnitCost: estimate,
			EstimatedValue:    roundMoney(lot.ReceivedQuantity * estimate),
			CostSource:        lot.CostSource,
			ReceivedDate:      lot.ReceivedDate,
			DaysPending:       daysSince(lot.ReceivedDate),
			DocumentNumber:    lot.DocumentNumber,
			Notes:             lot.Notes,
			Label:             stockLotLabel(&lot),
			SuggestedUnitCost: suggested,
			UsedInProjects:    usage[lot.LotID],
		})
	}
	return rows, nil
}

// GetPendingBillsSummary powers the nav badge.
func GetPendingBillsSummary() (*models.PendingBillsSummary, error) {
	lots, err := listProvisionalLots("")
	if err != nil {
		return nil, err
	}
	summary := &models.PendingBillsSummary{PendingLots: len(lots)}
	for i := range lots {
		estimate := costFallback(lots[i].EstimatedUnitCost, lots[i].UnitCost)
		summary.EstimatedValue += lots[i].ReceivedQuantity * estimate
		if d := daysSince(lots[i].ReceivedDate); d > summary.OldestDays {
			summary.OldestDays = d
		}
	}
	summary.EstimatedValue = roundMoney(summary.EstimatedValue)
	return summary, nil
}

// ── Confirming a bill ────────────────────────────────────────────────────────

type ConfirmLotBillInput struct {
	ItemID        string  `json:"item_id"`
	UnitCost      float64 `json:"unit_cost"`
	InvoiceNumber string  `json:"invoice_number"`
	InvoiceDate   string  `json:"invoice_date"`
	Notes         string  `json:"notes"`
	ConfirmedBy   string  `json:"confirmed_by"`
	// DryRun computes the full impact and returns it without writing anything,
	// which is what the confirmation preview renders.
	DryRun bool `json:"dry_run"`
}

type ConfirmLotBillResult struct {
	DryRun   bool                                `json:"dry_run"`
	Lot      models.InventoryStockLotView        `json:"lot"`
	Revision models.InventoryCostRevision        `json:"revision"`
	Projects []models.InventoryCostRevisionSplit `json:"projects"`
}

// ConfirmLotBill applies a supplier's real invoice rate to a provisional lot and
// cascades it to every movement that still carries the estimate — the original
// receipt, and each issue to a project. Log entries are deliberately untouched:
// their TotalCost is the client-facing charge (driven by pricing rules and
// vendor sell prices), not the purchase cost, so repricing a lot must not move
// it. The purchase side lives entirely in movements and the lot.
func ConfirmLotBill(lotID string, input ConfirmLotBillInput) (*ConfirmLotBillResult, error) {
	lotID = trimOrEmpty(lotID)
	if lotID == "" {
		return nil, fmt.Errorf("lot id is required")
	}
	if input.UnitCost < 0 {
		return nil, fmt.Errorf("invoice rate cannot be negative")
	}

	ctx := context.Background()
	filter := bson.M{"lot_id": lotID}
	if trimOrEmpty(input.ItemID) != "" {
		filter["item_id"] = trimOrEmpty(input.ItemID)
	}
	var lot models.InventoryStockLot
	if err := inventoryStockLotCol().FindOne(ctx, filter).Decode(&lot); err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, fmt.Errorf("stock lot not found")
		}
		return nil, err
	}
	if !lot.CostStatus.IsProvisional() {
		return nil, fmt.Errorf("this stock lot is not awaiting a bill")
	}

	var invoiceDate *time.Time
	if trimOrEmpty(input.InvoiceDate) != "" {
		parsed, err := parseMovementDate(input.InvoiceDate)
		if err != nil {
			return nil, fmt.Errorf("invalid invoice date: %w", err)
		}
		invoiceDate = &parsed
	}

	previousUnitCost := costFallback(lot.UnitCost, lot.EstimatedUnitCost)
	newUnitCost := input.UnitCost
	delta := newUnitCost - previousUnitCost

	// Only movements still carrying the estimate are repriced. A movement that
	// was given an explicit cost of its own is left alone.
	movementFilter := bson.M{"lot_id": lotID}
	for k, v := range provisionalFilter() {
		movementFilter[k] = v
	}
	cursor, err := inventoryMovementCol().Find(ctx, movementFilter)
	if err != nil {
		return nil, err
	}
	var movements []models.InventoryMovement
	if err := cursor.All(ctx, &movements); err != nil {
		cursor.Close(ctx)
		return nil, err
	}
	cursor.Close(ctx)

	movementIDs := make([]string, 0, len(movements))
	consumedQty := 0.0
	for _, m := range movements {
		movementIDs = append(movementIDs, m.MovementID)
		if m.Type == models.InventoryMovementOut {
			consumedQty += math.Abs(m.Quantity)
		}
	}

	usage, _, err := projectUsageForLots([]string{lotID})
	if err != nil {
		return nil, err
	}
	// A lot that has not been issued to any project yet has no usage rows. This
	// must serialise as [] rather than null — the confirmation preview maps over
	// it directly, and a null crashes the dialog. That is the ordinary case:
	// stock received, bill arrives, nothing logged against it yet.
	projects := usage[lotID]
	if projects == nil {
		projects = []models.InventoryCostRevisionSplit{}
	}
	for i := range projects {
		projects[i].NewAmount = roundMoney(projects[i].Quantity * newUnitCost)
		projects[i].PreviousAmount = roundMoney(projects[i].Quantity * previousUnitCost)
		projects[i].Delta = roundMoney(projects[i].NewAmount - projects[i].PreviousAmount)
	}

	stockDelta := roundMoney(lot.RemainingQuantity * delta)
	consumedDelta := roundMoney(consumedQty * delta)

	revisionID := "preview"
	if !input.DryRun {
		revisionID, err = utils.NextID("inventory_cost_revision")
		if err != nil {
			return nil, fmt.Errorf("revision id generation failed: %w", err)
		}
	}
	now := time.Now()
	revision := models.InventoryCostRevision{
		RevisionID:          revisionID,
		LotID:               lot.LotID,
		ItemID:              lot.ItemID,
		ItemName:            lot.ItemName,
		ItemUnit:            lot.ItemUnit,
		Supplier:            lot.SupplierBucket,
		PreviousUnitCost:    previousUnitCost,
		NewUnitCost:         newUnitCost,
		UnitCostDelta:       roundMoney(delta),
		ReceivedQuantity:    lot.ReceivedQuantity,
		ConsumedQuantity:    roundMoney(consumedQty),
		ConsumedDelta:       consumedDelta,
		StockDelta:          stockDelta,
		TotalDelta:          roundMoney(consumedDelta + stockDelta),
		InvoiceNumber:       trimOrEmpty(input.InvoiceNumber),
		InvoiceDate:         invoiceDate,
		AffectedMovementIDs: movementIDs,
		AffectedProjects:    projects,
		ConfirmedBy:         trimOrEmpty(input.ConfirmedBy),
		CreatedAt:           now,
	}

	if input.DryRun {
		lot.UnitCost = newUnitCost
		lot.CostStatus = models.LotCostConfirmed
		return &ConfirmLotBillResult{DryRun: true, Lot: toStockLotView(lot, nil), Revision: revision, Projects: projects}, nil
	}

	// ── Writes ───────────────────────────────────────────────────────────────
	lotSet := bson.M{
		"unit_cost":           newUnitCost,
		"cost_status":         string(models.LotCostConfirmed),
		"cost_source":         models.LotCostSourceInvoice,
		"estimated_unit_cost": costFallback(lot.EstimatedUnitCost, previousUnitCost),
		"confirmed_at":        now,
		"updated_at":          now,
	}
	if revision.InvoiceNumber != "" {
		lotSet["invoice_number"] = revision.InvoiceNumber
		// The lot's document number is what the movements list shows; keep it in
		// step with the invoice when the lot was received without one.
		if trimOrEmpty(lot.DocumentNumber) == "" {
			lotSet["document_number"] = revision.InvoiceNumber
		}
	}
	if invoiceDate != nil {
		lotSet["invoice_date"] = *invoiceDate
	}
	if revision.ConfirmedBy != "" {
		lotSet["confirmed_by"] = revision.ConfirmedBy
	}
	if trimOrEmpty(input.Notes) != "" {
		lotSet["notes"] = trimOrEmpty(input.Notes)
	}
	if _, err := inventoryStockLotCol().UpdateOne(ctx, bson.M{"lot_id": lot.LotID}, bson.M{"$set": lotSet}); err != nil {
		return nil, err
	}

	// Reprice each affected movement. Quantities differ per movement, so this
	// cannot be a single blanket update.
	for _, m := range movements {
		set := bson.M{
			"unit_cost":    newUnitCost,
			"total_amount": roundMoney(math.Abs(m.Quantity) * newUnitCost),
			"cost_status":  string(models.LotCostConfirmed),
		}
		if revision.InvoiceNumber != "" && trimOrEmpty(m.DocumentNumber) == "" {
			set["document_number"] = revision.InvoiceNumber
		}
		if _, err := inventoryMovementCol().UpdateOne(ctx, bson.M{"movement_id": m.MovementID}, bson.M{"$set": set}); err != nil {
			return nil, err
		}
	}

	// The item's last purchase cost is the fallback for estimating future
	// receipts, so it should hold the newest *invoiced* rate. Only advance it
	// when no later receipt has already been billed.
	if newUnitCost > 0 {
		newer, err := inventoryStockLotCol().CountDocuments(ctx, bson.M{
			"item_id":       lot.ItemID,
			"lot_id":        bson.M{"$ne": lot.LotID},
			"cost_status":   bson.M{"$ne": string(models.LotCostProvisional)},
			"received_date": bson.M{"$gt": lot.ReceivedDate},
		})
		if err == nil && newer == 0 {
			_, _ = inventoryItemCol().UpdateOne(ctx,
				bson.M{"item_id": lot.ItemID},
				bson.M{"$set": bson.M{"last_purchase_cost": newUnitCost, "updated_at": now}},
			)
		}
	}

	if _, err := inventoryCostRevisionCol().InsertOne(ctx, revision); err != nil {
		return nil, err
	}

	lot.UnitCost = newUnitCost
	lot.CostStatus = models.LotCostConfirmed
	lot.CostSource = models.LotCostSourceInvoice
	lot.InvoiceNumber = revision.InvoiceNumber
	item, _ := GetInventoryItem(lot.ItemID)
	return &ConfirmLotBillResult{Lot: toStockLotView(lot, item), Revision: revision, Projects: projects}, nil
}

// ── History & project confidence ─────────────────────────────────────────────

// ListCostRevisions returns the repricing history, newest first.
func ListCostRevisions(itemID string, limit int64) ([]models.InventoryCostRevision, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	filter := bson.M{}
	if trimOrEmpty(itemID) != "" {
		filter["item_id"] = trimOrEmpty(itemID)
	}
	ctx := context.Background()
	cursor, err := inventoryCostRevisionCol().Find(ctx, filter, &options.FindOptions{
		Sort:  bson.D{{Key: "created_at", Value: -1}},
		Limit: &limit,
	})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var revisions []models.InventoryCostRevision
	if err := cursor.All(ctx, &revisions); err != nil {
		return nil, err
	}
	if revisions == nil {
		revisions = []models.InventoryCostRevision{}
	}
	return revisions, nil
}

// GetProjectCostConfidence splits a project's material spend into billed and
// still-estimated, so its profit can be shown with the size of what is unknown
// rather than as a single falsely precise number. The reference may be either
// the project's object id or its human PRJ-xxx id.
func GetProjectCostConfidence(projectRef string) (*models.ProjectCostConfidence, error) {
	projectRef = trimOrEmpty(projectRef)
	if projectRef == "" {
		return nil, fmt.Errorf("project reference is required")
	}

	ctx := context.Background()
	var project struct {
		ID        primitive.ObjectID `bson:"_id"`
		ProjectID string             `bson:"project_id"`
		Name      string             `bson:"name"`
	}
	query := bson.M{"project_id": projectRef}
	if oid, err := primitive.ObjectIDFromHex(projectRef); err == nil {
		query = bson.M{"_id": oid}
	}
	if err := projectSnapshotCol().FindOne(ctx, query).Decode(&project); err != nil {
		if err == mongo.ErrNoDocuments {
			return nil, fmt.Errorf("project not found")
		}
		return nil, err
	}

	cursor, err := inventoryMovementCol().Find(ctx, bson.M{
		"type":            string(models.InventoryMovementOut),
		"document_number": project.ProjectID,
	})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var movements []models.InventoryMovement
	if err := cursor.All(ctx, &movements); err != nil {
		return nil, err
	}

	out := &models.ProjectCostConfidence{ProjectID: project.ProjectID}
	pendingLots := map[string]bool{}
	pendingItems := map[string]bool{}
	for _, m := range movements {
		if m.CostStatus.IsProvisional() {
			out.ProvisionalCost += m.TotalAmount
			if m.LotID != "" {
				pendingLots[m.LotID] = true
			}
			if m.ItemName != "" {
				pendingItems[m.ItemName] = true
			}
			continue
		}
		out.ConfirmedCost += m.TotalAmount
	}
	out.ConfirmedCost = roundMoney(out.ConfirmedCost)
	out.ProvisionalCost = roundMoney(out.ProvisionalCost)
	out.TotalCost = roundMoney(out.ConfirmedCost + out.ProvisionalCost)
	out.PendingLots = len(pendingLots)

	names := make([]string, 0, len(pendingItems))
	for name := range pendingItems {
		names = append(names, name)
	}
	sort.Strings(names)
	if len(names) > 3 {
		out.PendingItemsLabel = strings.Join(names[:3], ", ") + fmt.Sprintf(" +%d more", len(names)-3)
	} else {
		out.PendingItemsLabel = strings.Join(names, ", ")
	}
	return out, nil
}
