package services

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
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

type CreateInventoryItemInput struct {
	SKU                    string                        `json:"sku"`
	Name                   string                        `json:"name" binding:"required"`
	Category               string                        `json:"category"`
	Unit                   string                        `json:"unit"`
	UsageUnit              string                        `json:"usage_unit"`
	UsageUnitsPerStockUnit float64                       `json:"usage_units_per_stock_unit"`
	Supplier               string                        `json:"supplier"`
	Location               string                        `json:"location"`
	MinStockLevel          float64                       `json:"min_stock_level"`
	OpeningStock           float64                       `json:"opening_stock"`
	LastPurchaseCost       float64                       `json:"last_purchase_cost"`
	VendorPricing          []InventoryVendorPricingInput `json:"vendor_pricing"`
	Notes                  string                        `json:"notes"`
}

type UpdateInventoryItemInput struct {
	SKU                    *string                       `json:"sku"`
	Name                   *string                       `json:"name"`
	Category               *string                       `json:"category"`
	Unit                   *string                       `json:"unit"`
	UsageUnit              *string                       `json:"usage_unit"`
	UsageUnitsPerStockUnit *float64                      `json:"usage_units_per_stock_unit"`
	Supplier               *string                       `json:"supplier"`
	Location               *string                       `json:"location"`
	MinStockLevel          *float64                      `json:"min_stock_level"`
	LastPurchaseCost       *float64                      `json:"last_purchase_cost"`
	VendorPricing          []InventoryVendorPricingInput `json:"vendor_pricing"`
	Notes                  *string                       `json:"notes"`
}

type InventoryVendorPricingInput struct {
	SupplierName      string  `json:"supplier_name"`
	DefaultBuyPrice   float64 `json:"default_buy_price"`
	DefaultSellPrice  float64 `json:"default_sell_price"`
	LeadTimeDays      int     `json:"lead_time_days"`
	PreferredSupplier bool    `json:"preferred_supplier"`
	Notes             string  `json:"notes"`
}

type CreateInventoryMovementInput struct {
	ItemID          string  `json:"item_id" binding:"required"`
	Type            string  `json:"type" binding:"required"`
	Reason          string  `json:"reason"`
	Quantity        float64 `json:"quantity" binding:"required"`
	UnitCost        float64 `json:"unit_cost"`
	Party           string  `json:"party"`
	SupplierBucket  string  `json:"supplier_bucket"`
	LotID           string  `json:"lot_id"`
	DocumentNumber  string  `json:"document_number"`
	TransactionDate string  `json:"transaction_date"`
	Reference       string  `json:"reference"`
	Notes           string  `json:"notes"`
}

type InventoryMovementFilter struct {
	ItemID   string
	Type     string
	Reason   string
	DateFrom string
	DateTo   string
	Limit    int64
}

type InventorySummary struct {
	TotalItems      int     `json:"total_items"`
	TotalUnits      float64 `json:"total_units"`
	LowStockCount   int     `json:"low_stock_count"`
	OutOfStockCount int     `json:"out_of_stock_count"`
	InventoryValue  float64 `json:"inventory_value"`
}

func inventoryItemCol() *mongo.Collection {
	return database.Collection("inventory_items")
}

func inventoryMovementCol() *mongo.Collection {
	return database.Collection("inventory_movements")
}

func inventoryStockLotCol() *mongo.Collection {
	return database.Collection("inventory_stock_lots")
}

func projectSnapshotCol() *mongo.Collection {
	return database.Collection("projects")
}

func logEntrySnapshotCol() *mongo.Collection {
	return database.Collection("log_entries")
}

func normalizeUnit(unit string) string {
	unit = strings.TrimSpace(unit)
	if unit == "" {
		return "pcs"
	}
	return unit
}

func trimOrEmpty(v string) string {
	return strings.TrimSpace(v)
}

func supplierBucketLabel(value string) string {
	if trimOrEmpty(value) == "" {
		return "Unassigned stock"
	}
	return trimOrEmpty(value)
}

func stockLotLabel(lot *models.InventoryStockLot) string {
	if lot == nil {
		return ""
	}
	parts := []string{supplierBucketLabel(lot.SupplierBucket)}
	if !lot.ReceivedDate.IsZero() {
		parts = append(parts, lot.ReceivedDate.Format("02 Jan 2006"))
	}
	if trimOrEmpty(lot.DocumentNumber) != "" {
		parts = append(parts, trimOrEmpty(lot.DocumentNumber))
	} else {
		parts = append(parts, lot.LotID)
	}
	return strings.Join(parts, " · ")
}

func isNumericOnlyUnit(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return false
	}
	_, err := strconv.ParseFloat(trimmed, 64)
	return err == nil
}

func normalizeVendorPricing(inputs []InventoryVendorPricingInput) ([]models.InventoryVendorPricing, error) {
	if len(inputs) == 0 {
		return nil, nil
	}
	seen := map[string]struct{}{}
	result := make([]models.InventoryVendorPricing, 0, len(inputs))
	preferredCount := 0
	for _, input := range inputs {
		supplierName := trimOrEmpty(input.SupplierName)
		if supplierName == "" {
			continue
		}
		key := strings.ToLower(supplierName)
		if _, exists := seen[key]; exists {
			return nil, fmt.Errorf("vendor %q is added more than once", supplierName)
		}
		seen[key] = struct{}{}
		if input.DefaultBuyPrice < 0 {
			return nil, fmt.Errorf("default buy price cannot be negative for %s", supplierName)
		}
		if input.DefaultSellPrice < 0 {
			return nil, fmt.Errorf("default sell price cannot be negative for %s", supplierName)
		}
		if input.LeadTimeDays < 0 {
			return nil, fmt.Errorf("lead time cannot be negative for %s", supplierName)
		}
		if input.PreferredSupplier {
			preferredCount++
		}
		result = append(result, models.InventoryVendorPricing{
			SupplierName:      supplierName,
			DefaultBuyPrice:   input.DefaultBuyPrice,
			DefaultSellPrice:  input.DefaultSellPrice,
			LeadTimeDays:      input.LeadTimeDays,
			PreferredSupplier: input.PreferredSupplier,
			Notes:             trimOrEmpty(input.Notes),
		})
	}
	if preferredCount > 1 {
		return nil, fmt.Errorf("only one preferred vendor can be selected")
	}
	if len(result) == 0 {
		return nil, nil
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].PreferredSupplier != result[j].PreferredSupplier {
			return result[i].PreferredSupplier
		}
		return result[i].SupplierName < result[j].SupplierName
	})
	return result, nil
}

func findVendorPricingForSupplier(item *models.InventoryItem, supplierBucket string) *models.InventoryVendorPricing {
	if item == nil {
		return nil
	}
	normalizedSupplier := strings.ToLower(supplierBucketLabel(supplierBucket))
	for _, row := range item.VendorPricing {
		if strings.ToLower(supplierBucketLabel(row.SupplierName)) == normalizedSupplier {
			rowCopy := row
			return &rowCopy
		}
	}
	return nil
}

func normalizeUsageConversion(stockUnit, usageUnit string, usageUnitsPerStockUnit float64) (string, float64, error) {
	normalizedUsageUnit := trimOrEmpty(usageUnit)
	if normalizedUsageUnit == "" {
		if usageUnitsPerStockUnit != 0 {
			return "", 0, fmt.Errorf("usage unit is required when pack conversion is set")
		}
		return "", 0, nil
	}
	if isNumericOnlyUnit(normalizedUsageUnit) {
		return "", 0, fmt.Errorf("usage unit should be a unit name like piece, handle, or ft — not a number")
	}
	if strings.EqualFold(normalizedUsageUnit, trimOrEmpty(stockUnit)) {
		return normalizedUsageUnit, 1, nil
	}
	if usageUnitsPerStockUnit <= 0 {
		return "", 0, fmt.Errorf("usage units per stock unit must be greater than 0")
	}
	return normalizedUsageUnit, usageUnitsPerStockUnit, nil
}

func toMovementType(v string) (models.InventoryMovementType, error) {
	switch models.InventoryMovementType(strings.TrimSpace(v)) {
	case models.InventoryMovementIn:
		return models.InventoryMovementIn, nil
	case models.InventoryMovementOut:
		return models.InventoryMovementOut, nil
	case models.InventoryMovementAdjustment:
		return models.InventoryMovementAdjustment, nil
	default:
		return "", fmt.Errorf("invalid movement type")
	}
}

func movementDelta(t models.InventoryMovementType, quantity float64) (float64, error) {
	switch t {
	case models.InventoryMovementIn:
		if quantity <= 0 {
			return 0, fmt.Errorf("quantity must be greater than zero")
		}
		return quantity, nil
	case models.InventoryMovementOut:
		if quantity <= 0 {
			return 0, fmt.Errorf("quantity must be greater than zero")
		}
		return -quantity, nil
	case models.InventoryMovementAdjustment:
		if quantity == 0 {
			return 0, fmt.Errorf("quantity cannot be zero")
		}
		return quantity, nil
	default:
		return 0, fmt.Errorf("invalid movement type")
	}
}

func parseMovementDate(value string) (time.Time, error) {
	if strings.TrimSpace(value) == "" {
		now := time.Now().UTC()
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC), nil
	}
	t, err := time.Parse("2006-01-02", strings.TrimSpace(value))
	if err != nil {
		return time.Time{}, fmt.Errorf("transaction date must be in YYYY-MM-DD format")
	}
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC), nil
}

func normalizeMovementReason(movementType models.InventoryMovementType, reason string) string {
	normalized := trimOrEmpty(reason)
	if normalized != "" {
		return normalized
	}
	switch movementType {
	case models.InventoryMovementIn:
		return "purchase"
	case models.InventoryMovementOut:
		return "issue"
	default:
		return "adjustment"
	}
}

func CreateInventoryItem(input CreateInventoryItemInput) (*models.InventoryItem, error) {
	itemID, err := utils.NextID("inventory_item")
	if err != nil {
		return nil, fmt.Errorf("id generation failed: %w", err)
	}

	now := time.Now()
	item := &models.InventoryItem{
		ItemID:                 itemID,
		SKU:                    trimOrEmpty(input.SKU),
		Name:                   strings.TrimSpace(input.Name),
		Category:               trimOrEmpty(input.Category),
		Unit:                   normalizeUnit(input.Unit),
		UsageUnit:              trimOrEmpty(input.UsageUnit),
		UsageUnitsPerStockUnit: input.UsageUnitsPerStockUnit,
		Supplier:               trimOrEmpty(input.Supplier),
		Location:               trimOrEmpty(input.Location),
		MinStockLevel:          input.MinStockLevel,
		CurrentStock:           input.OpeningStock,
		LastPurchaseCost:       input.LastPurchaseCost,
		VendorPricing:          nil,
		Notes:                  trimOrEmpty(input.Notes),
		CreatedAt:              now,
		UpdatedAt:              now,
	}

	if item.Name == "" {
		return nil, fmt.Errorf("name is required")
	}
	usageUnit, usageUnitsPerStockUnit, err := normalizeUsageConversion(item.Unit, item.UsageUnit, item.UsageUnitsPerStockUnit)
	if err != nil {
		return nil, err
	}
	item.UsageUnit = usageUnit
	item.UsageUnitsPerStockUnit = usageUnitsPerStockUnit
	vendorPricing, err := normalizeVendorPricing(input.VendorPricing)
	if err != nil {
		return nil, err
	}
	item.VendorPricing = vendorPricing
	if item.CurrentStock < 0 {
		return nil, fmt.Errorf("opening stock cannot be negative")
	}

	if _, err := inventoryItemCol().InsertOne(context.Background(), item); err != nil {
		return nil, fmt.Errorf("insert failed: %w", err)
	}

	if item.CurrentStock > 0 {
		openingDate := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		lot, err := createInventoryStockLot(item, item.CurrentStock, inventoryMovementRecordOptions{
			Reason:          "opening_stock",
			TransactionDate: openingDate,
			Reference:       "opening-balance",
			Notes:           "Opening stock",
			UnitCost:        item.LastPurchaseCost,
			Party:           item.Supplier,
			SupplierBucket:  item.Supplier,
		})
		if err != nil {
			return nil, err
		}
		if _, err := createMovementRecord(item, models.InventoryMovementAdjustment, item.CurrentStock, inventoryMovementRecordOptions{
			Reason:          "opening_stock",
			TransactionDate: openingDate,
			Reference:       "opening-balance",
			Notes:           "Opening stock",
			UnitCost:        item.LastPurchaseCost,
			Party:           item.Supplier,
			SupplierBucket:  lot.SupplierBucket,
			LotID:           lot.LotID,
			LotLabel:        stockLotLabel(lot),
		}); err != nil {
			return nil, err
		}
	}

	return item, nil
}

func ListInventoryItems() ([]models.InventoryItem, error) {
	ctx := context.Background()
	cursor, err := inventoryItemCol().Find(ctx, bson.M{}, &options.FindOptions{
		Sort: bson.D{{Key: "updated_at", Value: -1}, {Key: "name", Value: 1}},
	})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var items []models.InventoryItem
	if err := cursor.All(ctx, &items); err != nil {
		return nil, err
	}
	if items == nil {
		items = []models.InventoryItem{}
	}
	return items, nil
}

func GetInventoryItem(itemID string) (*models.InventoryItem, error) {
	var item models.InventoryItem
	err := inventoryItemCol().FindOne(context.Background(), bson.M{"item_id": itemID}).Decode(&item)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err == nil {
		_, _ = inventoryStockLotCol().UpdateMany(
			context.Background(),
			bson.M{"item_id": itemID},
			bson.M{"$set": bson.M{
				"item_name": item.Name,
				"item_unit": item.Unit,
			}},
		)
	}
	return &item, err
}

func UpdateInventoryItem(itemID string, input UpdateInventoryItemInput) (*models.InventoryItem, error) {
	set := bson.M{"updated_at": time.Now()}
	if input.SKU != nil {
		set["sku"] = trimOrEmpty(*input.SKU)
	}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			return nil, fmt.Errorf("name is required")
		}
		set["name"] = name
	}
	if input.Category != nil {
		set["category"] = trimOrEmpty(*input.Category)
	}
	if input.Unit != nil {
		set["unit"] = normalizeUnit(*input.Unit)
	}
	nextUnit := ""
	if input.Unit != nil {
		nextUnit = normalizeUnit(*input.Unit)
	}
	if input.Supplier != nil {
		set["supplier"] = trimOrEmpty(*input.Supplier)
	}
	if input.Location != nil {
		set["location"] = trimOrEmpty(*input.Location)
	}
	if input.MinStockLevel != nil {
		set["min_stock_level"] = *input.MinStockLevel
	}
	if input.LastPurchaseCost != nil {
		set["last_purchase_cost"] = *input.LastPurchaseCost
	}
	if input.VendorPricing != nil {
		vendorPricing, err := normalizeVendorPricing(input.VendorPricing)
		if err != nil {
			return nil, err
		}
		set["vendor_pricing"] = vendorPricing
	}
	if input.Notes != nil {
		set["notes"] = trimOrEmpty(*input.Notes)
	}
	if input.Unit != nil || input.UsageUnit != nil || input.UsageUnitsPerStockUnit != nil {
		current, err := GetInventoryItem(itemID)
		if err != nil {
			return nil, err
		}
		if current == nil {
			return nil, nil
		}
		stockUnit := current.Unit
		if nextUnit != "" {
			stockUnit = nextUnit
		}
		usageUnit := current.UsageUnit
		if input.UsageUnit != nil {
			usageUnit = *input.UsageUnit
		}
		usageUnitsPerStockUnit := current.UsageUnitsPerStockUnit
		if input.UsageUnitsPerStockUnit != nil {
			usageUnitsPerStockUnit = *input.UsageUnitsPerStockUnit
		}
		normalizedUsageUnit, normalizedUsageUnitsPerStockUnit, err := normalizeUsageConversion(stockUnit, usageUnit, usageUnitsPerStockUnit)
		if err != nil {
			return nil, err
		}
		set["usage_unit"] = normalizedUsageUnit
		set["usage_units_per_stock_unit"] = normalizedUsageUnitsPerStockUnit
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var item models.InventoryItem
	err := inventoryItemCol().FindOneAndUpdate(
		context.Background(),
		bson.M{"item_id": itemID},
		bson.M{"$set": set},
		opts,
	).Decode(&item)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &item, err
}

func DeleteInventoryItem(itemID string) error {
	res, err := inventoryItemCol().DeleteOne(context.Background(), bson.M{"item_id": itemID})
	if err != nil {
		return err
	}
	if res.DeletedCount == 0 {
		return fmt.Errorf("inventory item not found")
	}
	_, _ = inventoryMovementCol().DeleteMany(context.Background(), bson.M{"item_id": itemID})
	_, _ = inventoryStockLotCol().DeleteMany(context.Background(), bson.M{"item_id": itemID})
	return nil
}

type inventoryMovementRecordOptions struct {
	Reason          string
	UnitCost        float64
	Party           string
	SupplierBucket  string
	LotID           string
	LotLabel        string
	DocumentNumber  string
	TransactionDate time.Time
	Reference       string
	Notes           string
}

func resolvedMovementUnitCost(item *models.InventoryItem, movementType models.InventoryMovementType, provided float64) float64 {
	if provided > 0 {
		return provided
	}
	if item == nil {
		return 0
	}
	switch movementType {
	case models.InventoryMovementOut, models.InventoryMovementAdjustment:
		if item.LastPurchaseCost > 0 {
			return item.LastPurchaseCost
		}
	}
	return 0
}

func findInventoryStockLot(itemID, lotID string) (*models.InventoryStockLot, error) {
	if trimOrEmpty(itemID) == "" || trimOrEmpty(lotID) == "" {
		return nil, nil
	}
	var lot models.InventoryStockLot
	err := inventoryStockLotCol().FindOne(context.Background(), bson.M{
		"item_id": itemID,
		"lot_id":  lotID,
	}).Decode(&lot)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &lot, nil
}

func createInventoryStockLot(item *models.InventoryItem, quantity float64, opts inventoryMovementRecordOptions) (*models.InventoryStockLot, error) {
	lotID, err := utils.NextID("inventory_stock_lot")
	if err != nil {
		return nil, fmt.Errorf("stock lot id generation failed: %w", err)
	}
	now := time.Now()
	lot := &models.InventoryStockLot{
		LotID:             lotID,
		ItemID:            item.ItemID,
		ItemName:          item.Name,
		ItemUnit:          item.Unit,
		SupplierBucket:    supplierBucketLabel(firstNonEmpty(opts.SupplierBucket, opts.Party)),
		ReceivedQuantity:  quantity,
		RemainingQuantity: quantity,
		UnitCost:          resolvedMovementUnitCost(item, models.InventoryMovementIn, opts.UnitCost),
		ReceivedDate:      opts.TransactionDate,
		DocumentNumber:    trimOrEmpty(opts.DocumentNumber),
		Reference:         trimOrEmpty(opts.Reference),
		Notes:             trimOrEmpty(opts.Notes),
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if lot.ReceivedDate.IsZero() {
		lot.ReceivedDate, _ = parseMovementDate("")
	}
	if _, err := inventoryStockLotCol().InsertOne(context.Background(), lot); err != nil {
		return nil, fmt.Errorf("stock lot insert failed: %w", err)
	}
	return lot, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimOrEmpty(value) != "" {
			return trimOrEmpty(value)
		}
	}
	return ""
}

func applyLotQuantityDelta(lot *models.InventoryStockLot, delta float64) (*models.InventoryStockLot, error) {
	if lot == nil || delta == 0 {
		return lot, nil
	}
	nextQty := lot.RemainingQuantity + delta
	if nextQty < -0.000001 {
		return nil, fmt.Errorf("stock lot cannot go below zero")
	}
	lot.RemainingQuantity = math.Max(0, nextQty)
	lot.UpdatedAt = time.Now()
	_, err := inventoryStockLotCol().UpdateOne(
		context.Background(),
		bson.M{"item_id": lot.ItemID, "lot_id": lot.LotID},
		bson.M{"$set": bson.M{
			"remaining_quantity": lot.RemainingQuantity,
			"updated_at":         lot.UpdatedAt,
		}},
	)
	if err != nil {
		return nil, err
	}
	return lot, nil
}

func ensureInventoryStockLots(item *models.InventoryItem) error {
	if item == nil {
		return nil
	}
	count, err := inventoryStockLotCol().CountDocuments(context.Background(), bson.M{"item_id": item.ItemID})
	if err != nil || count > 0 {
		return err
	}
	cursor, err := inventoryMovementCol().Find(
		context.Background(),
		bson.M{"item_id": item.ItemID},
		&options.FindOptions{Sort: bson.D{{Key: "transaction_date", Value: 1}, {Key: "created_at", Value: 1}}},
	)
	if err != nil {
		return err
	}
	defer cursor.Close(context.Background())

	var movements []models.InventoryMovement
	if err := cursor.All(context.Background(), &movements); err != nil {
		return err
	}
	if len(movements) == 0 {
		return nil
	}

	lots := make([]*models.InventoryStockLot, 0)
	for _, movement := range movements {
		delta, err := movementDelta(movement.Type, movement.Quantity)
		if err != nil {
			continue
		}
		if delta > 0 {
			lotID, err := utils.NextID("inventory_stock_lot")
			if err != nil {
				return fmt.Errorf("stock lot id generation failed: %w", err)
			}
			bucket := firstNonEmpty(movement.SupplierBucket, movement.Party)
			lot := &models.InventoryStockLot{
				LotID:             lotID,
				ItemID:            item.ItemID,
				ItemName:          item.Name,
				ItemUnit:          item.Unit,
				SupplierBucket:    supplierBucketLabel(bucket),
				ReceivedQuantity:  delta,
				RemainingQuantity: delta,
				UnitCost:          movement.UnitCost,
				ReceivedDate:      movement.TransactionDate,
				DocumentNumber:    trimOrEmpty(movement.DocumentNumber),
				Reference:         trimOrEmpty(movement.Reference),
				Notes:             trimOrEmpty(movement.Notes),
				CreatedAt:         movement.CreatedAt,
				UpdatedAt:         movement.CreatedAt,
			}
			lots = append(lots, lot)
			continue
		}

		remaining := math.Abs(delta)
		if remaining == 0 {
			continue
		}
		for _, lot := range lots {
			if remaining <= 0 {
				break
			}
			if movement.LotID != "" && lot.LotID != movement.LotID {
				continue
			}
			if movement.LotID == "" && trimOrEmpty(movement.SupplierBucket) != "" && lot.SupplierBucket != supplierBucketLabel(movement.SupplierBucket) {
				continue
			}
			if lot.RemainingQuantity <= 0 {
				continue
			}
			consumed := math.Min(lot.RemainingQuantity, remaining)
			lot.RemainingQuantity -= consumed
			remaining -= consumed
		}
		if remaining > 0 && trimOrEmpty(movement.SupplierBucket) != "" {
			for _, lot := range lots {
				if remaining <= 0 {
					break
				}
				if lot.RemainingQuantity <= 0 {
					continue
				}
				consumed := math.Min(lot.RemainingQuantity, remaining)
				lot.RemainingQuantity -= consumed
				remaining -= consumed
			}
		}
	}

	docs := make([]interface{}, 0, len(lots))
	for _, lot := range lots {
		if lot.ReceivedQuantity <= 0 {
			continue
		}
		docs = append(docs, lot)
	}
	if len(docs) == 0 {
		return nil
	}
	_, err = inventoryStockLotCol().InsertMany(context.Background(), docs)
	return err
}

func listInventoryStockLotsInternal(itemID string, availableOnly bool) ([]models.InventoryStockLot, error) {
	item, err := GetInventoryItem(itemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, fmt.Errorf("inventory item not found")
	}
	if err := ensureInventoryStockLots(item); err != nil {
		return nil, err
	}
	filter := bson.M{"item_id": itemID}
	if availableOnly {
		filter["remaining_quantity"] = bson.M{"$gt": 0}
	}
	cursor, err := inventoryStockLotCol().Find(
		context.Background(),
		filter,
		&options.FindOptions{Sort: bson.D{{Key: "received_date", Value: 1}, {Key: "created_at", Value: 1}}},
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(context.Background())

	var lots []models.InventoryStockLot
	if err := cursor.All(context.Background(), &lots); err != nil {
		return nil, err
	}
	if lots == nil {
		lots = []models.InventoryStockLot{}
	}
	return lots, nil
}

func GetInventoryStockLot(itemID, lotID string) (*models.InventoryStockLot, error) {
	item, err := GetInventoryItem(itemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, fmt.Errorf("inventory item not found")
	}
	if err := ensureInventoryStockLots(item); err != nil {
		return nil, err
	}
	return findInventoryStockLot(itemID, lotID)
}

func ListInventoryStockLots(itemID string) ([]models.InventoryStockLotView, error) {
	lots, err := listInventoryStockLotsInternal(itemID, true)
	if err != nil {
		return nil, err
	}
	item, err := GetInventoryItem(itemID)
	if err != nil {
		return nil, err
	}
	result := make([]models.InventoryStockLotView, 0, len(lots))
	for _, lot := range lots {
		lotCopy := lot
		vendorPricing := findVendorPricingForSupplier(item, lot.SupplierBucket)
		result = append(result, models.InventoryStockLotView{
			LotID:             lot.LotID,
			ItemID:            lot.ItemID,
			ItemName:          lot.ItemName,
			ItemUnit:          lot.ItemUnit,
			SupplierBucket:    lot.SupplierBucket,
			ReceivedQuantity:  lot.ReceivedQuantity,
			RemainingQuantity: lot.RemainingQuantity,
			UnitCost:          lot.UnitCost,
			DefaultSellPrice:  func() float64 {
				if vendorPricing == nil {
					return 0
				}
				return vendorPricing.DefaultSellPrice
			}(),
			ReceivedDate:      lot.ReceivedDate,
			DocumentNumber:    lot.DocumentNumber,
			Reference:         lot.Reference,
			Notes:             lot.Notes,
			Label:             stockLotLabel(&lotCopy),
		})
	}
	return result, nil
}

func ListAllInventoryStockLots() ([]models.InventoryStockLotView, error) {
	items, err := ListInventoryItems()
	if err != nil {
		return nil, err
	}
	result := make([]models.InventoryStockLotView, 0)
	for _, item := range items {
		rows, err := ListInventoryStockLots(item.ItemID)
		if err != nil {
			return nil, err
		}
		result = append(result, rows...)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].ItemName != result[j].ItemName {
			return result[i].ItemName < result[j].ItemName
		}
		if result[i].SupplierBucket != result[j].SupplierBucket {
			return result[i].SupplierBucket < result[j].SupplierBucket
		}
		return result[i].ReceivedDate.Before(result[j].ReceivedDate)
	})
	return result, nil
}

func resolveOutgoingStockLot(item *models.InventoryItem, lotID, supplierBucket string) (*models.InventoryStockLot, error) {
	if item == nil {
		return nil, fmt.Errorf("inventory item not found")
	}
	lots, err := listInventoryStockLotsInternal(item.ItemID, true)
	if err != nil {
		return nil, err
	}
	if len(lots) == 0 {
		return nil, fmt.Errorf("no stock lots available for this item")
	}
	if trimOrEmpty(lotID) != "" {
		lot, err := findInventoryStockLot(item.ItemID, lotID)
		if err != nil {
			return nil, err
		}
		if lot == nil || lot.RemainingQuantity <= 0 {
			return nil, fmt.Errorf("selected stock lot is not available")
		}
		return lot, nil
	}
	if trimOrEmpty(supplierBucket) != "" {
		filtered := make([]models.InventoryStockLot, 0, len(lots))
		for _, lot := range lots {
			if lot.SupplierBucket == supplierBucketLabel(supplierBucket) {
				filtered = append(filtered, lot)
			}
		}
		if len(filtered) == 1 {
			lotCopy := filtered[0]
			return &lotCopy, nil
		}
		if len(filtered) > 1 {
			return nil, fmt.Errorf("select a specific stock lot for %s", supplierBucketLabel(supplierBucket))
		}
		return nil, fmt.Errorf("no stock lot found for %s", supplierBucketLabel(supplierBucket))
	}
	if len(lots) == 1 {
		lotCopy := lots[0]
		return &lotCopy, nil
	}
	return nil, fmt.Errorf("select a specific stock lot")
}

func createMovementRecord(item *models.InventoryItem, t models.InventoryMovementType, quantity float64, opts inventoryMovementRecordOptions) (*models.InventoryMovement, error) {
	movementID, err := utils.NextID("inventory_movement")
	if err != nil {
		return nil, fmt.Errorf("id generation failed: %w", err)
	}

	transactionDate := opts.TransactionDate
	if transactionDate.IsZero() {
		transactionDate, _ = parseMovementDate("")
	}
	supplierBucket := trimOrEmpty(opts.SupplierBucket)
	if supplierBucket == "" && t == models.InventoryMovementIn {
		normalizedReason := normalizeMovementReason(t, opts.Reason)
		if normalizedReason == "purchase" || normalizedReason == "opening_stock" {
			supplierBucket = trimOrEmpty(opts.Party)
		}
	}
	unitCost := resolvedMovementUnitCost(item, t, opts.UnitCost)
	movement := &models.InventoryMovement{
		MovementID:      movementID,
		ItemID:          item.ItemID,
		ItemName:        item.Name,
		ItemUnit:        item.Unit,
		LotID:           trimOrEmpty(opts.LotID),
		LotLabel:        trimOrEmpty(opts.LotLabel),
		SupplierBucket:  supplierBucket,
		Type:            t,
		Reason:          normalizeMovementReason(t, opts.Reason),
		Quantity:        quantity,
		UnitCost:        unitCost,
		TotalAmount:     math.Abs(quantity) * unitCost,
		BalanceAfter:    item.CurrentStock,
		Party:           trimOrEmpty(opts.Party),
		DocumentNumber:  trimOrEmpty(opts.DocumentNumber),
		TransactionDate: transactionDate,
		Reference:       trimOrEmpty(opts.Reference),
		Notes:           trimOrEmpty(opts.Notes),
		CreatedAt:       time.Now(),
	}
	if _, err := inventoryMovementCol().InsertOne(context.Background(), movement); err != nil {
		return nil, fmt.Errorf("movement insert failed: %w", err)
	}
	return movement, nil
}

func CreateInventoryMovement(input CreateInventoryMovementInput) (*models.InventoryMovement, error) {
	item, err := GetInventoryItem(input.ItemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, fmt.Errorf("inventory item not found")
	}

	movementType, err := toMovementType(input.Type)
	if err != nil {
		return nil, err
	}
	if input.UnitCost < 0 {
		return nil, fmt.Errorf("unit cost cannot be negative")
	}
	if err := ensureInventoryStockLots(item); err != nil {
		return nil, err
	}
	delta, err := movementDelta(movementType, input.Quantity)
	if err != nil {
		return nil, err
	}
	transactionDate, err := parseMovementDate(input.TransactionDate)
	if err != nil {
		return nil, err
	}

	nextStock := item.CurrentStock + delta
	if nextStock < 0 {
		return nil, fmt.Errorf("stock cannot go below zero")
	}

	var lot *models.InventoryStockLot
	normalizedLotID := trimOrEmpty(input.LotID)
	normalizedSupplierBucket := trimOrEmpty(input.SupplierBucket)
	if delta < 0 {
		lot, err = resolveOutgoingStockLot(item, normalizedLotID, normalizedSupplierBucket)
		if err != nil {
			return nil, err
		}
		if lot.RemainingQuantity+delta < -0.000001 {
			return nil, fmt.Errorf("selected stock lot cannot go below zero")
		}
		normalizedLotID = lot.LotID
		normalizedSupplierBucket = lot.SupplierBucket
	} else if delta > 0 && normalizedLotID != "" {
		lot, err = findInventoryStockLot(item.ItemID, normalizedLotID)
		if err != nil {
			return nil, err
		}
		if lot == nil {
			return nil, fmt.Errorf("selected stock lot is not available")
		}
		normalizedSupplierBucket = lot.SupplierBucket
	}

	item.CurrentStock = nextStock
	item.UpdatedAt = time.Now()
	updateSet := bson.M{
		"current_stock": item.CurrentStock,
		"updated_at":    item.UpdatedAt,
	}
	if input.UnitCost > 0 && movementType == models.InventoryMovementIn {
		updateSet["last_purchase_cost"] = input.UnitCost
		item.LastPurchaseCost = input.UnitCost
	}
	_, err = inventoryItemCol().UpdateOne(
		context.Background(),
		bson.M{"item_id": item.ItemID},
		bson.M{
			"$set": updateSet,
		},
	)
	if err != nil {
		return nil, err
	}

	var lotLabel string
	switch {
	case delta > 0 && movementType == models.InventoryMovementIn:
		lot, err = createInventoryStockLot(item, delta, inventoryMovementRecordOptions{
			Reason:          input.Reason,
			UnitCost:        input.UnitCost,
			Party:           input.Party,
			SupplierBucket:  normalizedSupplierBucket,
			DocumentNumber:  input.DocumentNumber,
			TransactionDate: transactionDate,
			Reference:       input.Reference,
			Notes:           input.Notes,
		})
		if err != nil {
			return nil, err
		}
		normalizedLotID = lot.LotID
		normalizedSupplierBucket = lot.SupplierBucket
		lotLabel = stockLotLabel(lot)
	case delta > 0 && movementType == models.InventoryMovementAdjustment:
		if lot != nil {
			lot, err = applyLotQuantityDelta(lot, delta)
			if err != nil {
				return nil, err
			}
		} else {
			lot, err = createInventoryStockLot(item, delta, inventoryMovementRecordOptions{
				Reason:          input.Reason,
				UnitCost:        input.UnitCost,
				Party:           input.Party,
				SupplierBucket:  normalizedSupplierBucket,
				DocumentNumber:  input.DocumentNumber,
				TransactionDate: transactionDate,
				Reference:       input.Reference,
				Notes:           input.Notes,
			})
			if err != nil {
				return nil, err
			}
		}
		normalizedLotID = lot.LotID
		normalizedSupplierBucket = lot.SupplierBucket
		lotLabel = stockLotLabel(lot)
	case delta < 0:
		lot, err = applyLotQuantityDelta(lot, delta)
		if err != nil {
			return nil, err
		}
		lotLabel = stockLotLabel(lot)
	}

	return createMovementRecord(item, movementType, input.Quantity, inventoryMovementRecordOptions{
		Reason:          input.Reason,
		UnitCost:        input.UnitCost,
		Party:           input.Party,
		SupplierBucket:  normalizedSupplierBucket,
		LotID:           normalizedLotID,
		LotLabel:        lotLabel,
		DocumentNumber:  input.DocumentNumber,
		TransactionDate: transactionDate,
		Reference:       input.Reference,
		Notes:           input.Notes,
	})
}

func ListInventorySupplierStock(itemID string) ([]models.InventorySupplierStock, error) {
	lots, err := ListInventoryStockLots(itemID)
	if err != nil {
		return nil, err
	}
	if len(lots) == 0 {
		return []models.InventorySupplierStock{}, nil
	}
	type bucketAggregate struct {
		qty      float64
		unitCost float64
	}
	aggregates := map[string]bucketAggregate{}
	for _, lot := range lots {
		aggregate := aggregates[lot.SupplierBucket]
		aggregate.qty += lot.RemainingQuantity
		if lot.UnitCost > 0 {
			aggregate.unitCost = lot.UnitCost
		}
		aggregates[lot.SupplierBucket] = aggregate
	}

	result := make([]models.InventorySupplierStock, 0, len(aggregates))
	for bucket, aggregate := range aggregates {
		result = append(result, models.InventorySupplierStock{
			ItemID:         lots[0].ItemID,
			ItemName:       lots[0].ItemName,
			ItemUnit:       lots[0].ItemUnit,
			SupplierBucket: bucket,
			AvailableQty:   aggregate.qty,
			UnitCost:       aggregate.unitCost,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].AvailableQty != result[j].AvailableQty {
			return result[i].AvailableQty > result[j].AvailableQty
		}
		return result[i].SupplierBucket < result[j].SupplierBucket
	})
	return result, nil
}

func ListInventoryMovements(filter InventoryMovementFilter) ([]models.InventoryMovement, error) {
	ctx := context.Background()
	query := bson.M{}
	if strings.TrimSpace(filter.ItemID) != "" {
		query["item_id"] = strings.TrimSpace(filter.ItemID)
	}
	if strings.TrimSpace(filter.Type) != "" {
		query["type"] = strings.TrimSpace(filter.Type)
	}
	if strings.TrimSpace(filter.Reason) != "" {
		query["reason"] = strings.TrimSpace(filter.Reason)
	}
	if strings.TrimSpace(filter.DateFrom) != "" || strings.TrimSpace(filter.DateTo) != "" {
		dateQuery := bson.M{}
		if strings.TrimSpace(filter.DateFrom) != "" {
			start, err := parseMovementDate(filter.DateFrom)
			if err != nil {
				return nil, err
			}
			dateQuery["$gte"] = start
		}
		if strings.TrimSpace(filter.DateTo) != "" {
			end, err := parseMovementDate(filter.DateTo)
			if err != nil {
				return nil, err
			}
			dateQuery["$lt"] = end.Add(24 * time.Hour)
		}
		query["transaction_date"] = dateQuery
	}
	limit := filter.Limit
	if limit <= 0 {
		limit = 50
	}
	cursor, err := inventoryMovementCol().Find(ctx, query, &options.FindOptions{
		Sort:  bson.D{{Key: "transaction_date", Value: -1}, {Key: "created_at", Value: -1}},
		Limit: &limit,
	})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var movements []models.InventoryMovement
	if err := cursor.All(ctx, &movements); err != nil {
		return nil, err
	}
	if movements == nil {
		movements = []models.InventoryMovement{}
	}
	if err := enrichInventoryMovements(movements); err != nil {
		return nil, err
	}
	return movements, nil
}

func enrichInventoryMovements(movements []models.InventoryMovement) error {
	type logEntrySnapshot struct {
		ID           primitive.ObjectID `bson:"_id"`
		ProjectID    primitive.ObjectID `bson:"project_id"`
		LogTypeName  string             `bson:"log_type_name"`
		CategoryName string             `bson:"category_name"`
		ItemName     string             `bson:"item_name"`
	}
	type projectSnapshot struct {
		ID        primitive.ObjectID `bson:"_id"`
		ProjectID string             `bson:"project_id"`
		Name      string             `bson:"name"`
	}

	logCache := map[string]*logEntrySnapshot{}
	projectCache := map[string]*projectSnapshot{}
	itemCache := map[string]*models.InventoryItem{}

	for index := range movements {
		movement := &movements[index]
		if movement.LotID != "" && trimOrEmpty(movement.LotLabel) == "" && trimOrEmpty(movement.ItemID) != "" {
			lot, err := findInventoryStockLot(movement.ItemID, movement.LotID)
			if err == nil && lot != nil {
				movement.LotLabel = stockLotLabel(lot)
				if movement.SupplierBucket == "" {
					movement.SupplierBucket = lot.SupplierBucket
				}
			}
		}
		if movement.UnitCost <= 0 && movement.TotalAmount <= 0 && strings.TrimSpace(movement.ItemID) != "" {
			item, cached := itemCache[movement.ItemID]
			if !cached {
				loaded, err := GetInventoryItem(movement.ItemID)
				if err != nil {
					return err
				}
				item = loaded
				itemCache[movement.ItemID] = item
			}
			if item != nil {
				unitCost := resolvedMovementUnitCost(item, movement.Type, 0)
				if unitCost > 0 {
					movement.UnitCost = unitCost
					movement.TotalAmount = math.Abs(movement.Quantity) * unitCost
				}
			}
		}
		if !strings.HasPrefix(movement.Reference, "log-entry:") {
			continue
		}
		entryHex := strings.TrimSpace(strings.TrimPrefix(movement.Reference, "log-entry:"))
		if entryHex == "" {
			continue
		}
		entry, cached := logCache[entryHex]
		if !cached {
			entryOID, err := primitive.ObjectIDFromHex(entryHex)
			if err != nil {
				continue
			}
			var loaded logEntrySnapshot
			err = logEntrySnapshotCol().FindOne(context.Background(), bson.M{"_id": entryOID}).Decode(&loaded)
			if errors.Is(err, mongo.ErrNoDocuments) {
				logCache[entryHex] = nil
				continue
			}
			if err != nil {
				return err
			}
			entry = &loaded
			logCache[entryHex] = entry
		}
		if entry == nil {
			continue
		}

		projectKey := entry.ProjectID.Hex()
		project, cached := projectCache[projectKey]
		if !cached {
			var loaded projectSnapshot
			err := projectSnapshotCol().FindOne(context.Background(), bson.M{"_id": entry.ProjectID}).Decode(&loaded)
			if errors.Is(err, mongo.ErrNoDocuments) {
				projectCache[projectKey] = nil
			} else if err != nil {
				return err
			} else {
				project = &loaded
				projectCache[projectKey] = project
			}
		}
		if project != nil {
			if movement.Party == "" {
				movement.Party = project.Name
			}
			if movement.DocumentNumber == "" {
				movement.DocumentNumber = project.ProjectID
			}
		}
		if strings.TrimSpace(movement.Notes) == "" {
			parts := []string{entry.LogTypeName, entry.CategoryName, entry.ItemName}
			description := make([]string, 0, len(parts))
			for _, part := range parts {
				if strings.TrimSpace(part) != "" {
					description = append(description, strings.TrimSpace(part))
				}
			}
			if len(description) > 0 {
				movement.Notes = strings.Join(description, " · ")
			}
		}
	}

	return nil
}

func GetInventorySummary() (*InventorySummary, error) {
	items, err := ListInventoryItems()
	if err != nil {
		return nil, err
	}

	summary := &InventorySummary{TotalItems: len(items)}
	for _, item := range items {
		summary.TotalUnits += item.CurrentStock
		summary.InventoryValue += item.CurrentStock * item.LastPurchaseCost
		if item.CurrentStock <= 0 {
			summary.OutOfStockCount++
		}
		if item.MinStockLevel > 0 && item.CurrentStock <= item.MinStockLevel {
			summary.LowStockCount++
		}
	}
	return summary, nil
}
