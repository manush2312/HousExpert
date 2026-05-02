package services

import (
	"context"
	"errors"
	"fmt"
	"math"
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
	SKU                    string  `json:"sku"`
	Name                   string  `json:"name" binding:"required"`
	Category               string  `json:"category"`
	Unit                   string  `json:"unit"`
	UsageUnit              string  `json:"usage_unit"`
	UsageUnitsPerStockUnit float64 `json:"usage_units_per_stock_unit"`
	Supplier               string  `json:"supplier"`
	Location               string  `json:"location"`
	MinStockLevel          float64 `json:"min_stock_level"`
	OpeningStock           float64 `json:"opening_stock"`
	LastPurchaseCost       float64 `json:"last_purchase_cost"`
	Notes                  string  `json:"notes"`
}

type UpdateInventoryItemInput struct {
	SKU                    *string  `json:"sku"`
	Name                   *string  `json:"name"`
	Category               *string  `json:"category"`
	Unit                   *string  `json:"unit"`
	UsageUnit              *string  `json:"usage_unit"`
	UsageUnitsPerStockUnit *float64 `json:"usage_units_per_stock_unit"`
	Supplier               *string  `json:"supplier"`
	Location               *string  `json:"location"`
	MinStockLevel          *float64 `json:"min_stock_level"`
	LastPurchaseCost       *float64 `json:"last_purchase_cost"`
	Notes                  *string  `json:"notes"`
}

type CreateInventoryMovementInput struct {
	ItemID          string  `json:"item_id" binding:"required"`
	Type            string  `json:"type" binding:"required"`
	Reason          string  `json:"reason"`
	Quantity        float64 `json:"quantity" binding:"required"`
	UnitCost        float64 `json:"unit_cost"`
	Party           string  `json:"party"`
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

func isNumericOnlyUnit(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return false
	}
	_, err := strconv.ParseFloat(trimmed, 64)
	return err == nil
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
	if item.CurrentStock < 0 {
		return nil, fmt.Errorf("opening stock cannot be negative")
	}

	if _, err := inventoryItemCol().InsertOne(context.Background(), item); err != nil {
		return nil, fmt.Errorf("insert failed: %w", err)
	}

	if item.CurrentStock > 0 {
		openingDate := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
		if _, err := createMovementRecord(item, models.InventoryMovementAdjustment, item.CurrentStock, inventoryMovementRecordOptions{
			Reason:          "opening_stock",
			TransactionDate: openingDate,
			Reference:       "opening-balance",
			Notes:           "Opening stock",
			UnitCost:        item.LastPurchaseCost,
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
	return nil
}

type inventoryMovementRecordOptions struct {
	Reason          string
	UnitCost        float64
	Party           string
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

func createMovementRecord(item *models.InventoryItem, t models.InventoryMovementType, quantity float64, opts inventoryMovementRecordOptions) (*models.InventoryMovement, error) {
	movementID, err := utils.NextID("inventory_movement")
	if err != nil {
		return nil, fmt.Errorf("id generation failed: %w", err)
	}

	transactionDate := opts.TransactionDate
	if transactionDate.IsZero() {
		transactionDate, _ = parseMovementDate("")
	}
	unitCost := resolvedMovementUnitCost(item, t, opts.UnitCost)
	movement := &models.InventoryMovement{
		MovementID:      movementID,
		ItemID:          item.ItemID,
		ItemName:        item.Name,
		ItemUnit:        item.Unit,
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

	return createMovementRecord(item, movementType, input.Quantity, inventoryMovementRecordOptions{
		Reason:          input.Reason,
		UnitCost:        input.UnitCost,
		Party:           input.Party,
		DocumentNumber:  input.DocumentNumber,
		TransactionDate: transactionDate,
		Reference:       input.Reference,
		Notes:           input.Notes,
	})
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
