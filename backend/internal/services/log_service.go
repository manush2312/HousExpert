package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"housexpert/backend/internal/database"
	"housexpert/backend/internal/models"
)

// ── Input types ───────────────────────────────────────────────────────────────

type CreateLogTypeInput struct {
	Name        string               `json:"name" binding:"required"`
	Fields      []models.SchemaField `json:"fields"` // legacy fallback for item fields
	ItemFields  []models.SchemaField `json:"item_fields"`
	EntryFields []models.SchemaField `json:"entry_fields"`
	CostMode    models.LogCostMode   `json:"cost_mode"`
	CreatedBy   primitive.ObjectID   `json:"created_by"`
}

type UpdateLogTypeSchemaInput struct {
	Fields      []models.SchemaField `json:"fields"` // legacy fallback for item fields
	ItemFields  []models.SchemaField `json:"item_fields"`
	EntryFields []models.SchemaField `json:"entry_fields"`
	CostMode    models.LogCostMode   `json:"cost_mode"`
}

type CreateLogCategoryInput struct {
	LogTypeID   primitive.ObjectID `json:"log_type_id"` // set by handler from URL param
	Name        string             `json:"name"        binding:"required"`
	Description string             `json:"description"`
	CreatedBy   primitive.ObjectID `json:"created_by"`
}

type CreateLogItemInput struct {
	LogTypeID   primitive.ObjectID  `json:"log_type_id"`
	CategoryID  primitive.ObjectID  `json:"category_id"`
	Description string              `json:"description"`
	Fields      []models.FieldValue `json:"fields"`
	CreatedBy   primitive.ObjectID  `json:"created_by"`
}

type UpdateLogItemInput struct {
	Fields []models.FieldValue `json:"fields" binding:"required"`
}

type CreateLogEntryInput struct {
	LogTypeID  primitive.ObjectID  `json:"log_type_id"  binding:"required"`
	CategoryID primitive.ObjectID  `json:"category_id"  binding:"required"`
	ItemID     *primitive.ObjectID `json:"item_id,omitempty"`
	Quantity   *float64            `json:"quantity,omitempty"`
	LogDate    string              `json:"log_date"     binding:"required"` // "YYYY-MM-DD"
	Fields     []models.FieldValue `json:"fields"`
	Notes      string              `json:"notes"`
	CreatedBy  primitive.ObjectID  `json:"created_by"`
}

type UpdateLogEntryInput struct {
	Fields   []models.FieldValue `json:"fields"`
	Notes    *string             `json:"notes"`
	Quantity *float64            `json:"quantity"`
}

type LogEntryFilter struct {
	LogTypeID  string // ObjectID hex
	CategoryID string // ObjectID hex
	LogDate    string // "YYYY-MM-DD" — filters for the entire day
}

type LogListOptions struct {
	IncludeArchived bool
}

// ── Collection helpers ────────────────────────────────────────────────────────

func logTypeCol() *mongo.Collection     { return database.Collection("log_types") }
func logCategoryCol() *mongo.Collection { return database.Collection("log_categories") }
func logItemCol() *mongo.Collection     { return database.Collection("log_items") }
func logEntryCol() *mongo.Collection    { return database.Collection("log_entries") }
func pricingRuleCol() *mongo.Collection { return database.Collection("pricing_rules") }

// ── LogType ───────────────────────────────────────────────────────────────────

// CreateLogType creates a new log type with an initial schema (version 1).
// Example: name="Material", fields=[{label:"Quantity", type:"number"}, ...]
func CreateLogType(input CreateLogTypeInput) (*models.LogType, error) {
	itemFields := assignFieldIDs(resolveItemSchemaFields(input.Fields, input.ItemFields))
	entryFields := assignFieldIDs(input.EntryFields)
	costMode, err := normalizeCostMode(input.CostMode, itemFields, entryFields)
	if err != nil {
		return nil, err
	}
	if err := validateSchemaForCostMode(costMode, entryFields); err != nil {
		return nil, err
	}

	now := time.Now()
	initialVersion := models.SchemaVersion{
		Version:     1,
		Fields:      itemFields,
		EntryFields: entryFields,
		CreatedAt:   now,
	}

	lt := &models.LogType{
		ID:                 primitive.NewObjectID(),
		Name:               input.Name,
		CurrentVersion:     1,
		CurrentSchema:      itemFields,
		CurrentEntrySchema: entryFields,
		UsesSplitSchema:    true,
		CostMode:           costMode,
		SchemaHistory:      []models.SchemaVersion{initialVersion},
		Status:             models.LogTypeActive,
		CreatedBy:          input.CreatedBy,
		CreatedAt:          now,
		UpdatedAt:          now,
	}
	if lt.CurrentSchema == nil {
		lt.CurrentSchema = []models.SchemaField{}
	}
	if lt.CurrentEntrySchema == nil {
		lt.CurrentEntrySchema = []models.SchemaField{}
	}

	_, err = logTypeCol().InsertOne(context.Background(), lt)
	if err != nil {
		return nil, fmt.Errorf("insert log type failed: %w", err)
	}
	return lt, nil
}

// ListLogTypes returns log types sorted alphabetically.
func ListLogTypes(opts LogListOptions) ([]models.LogType, error) {
	query := bson.M{}
	if !opts.IncludeArchived {
		query["status"] = models.LogTypeActive
	}
	cursor, err := logTypeCol().Find(
		context.Background(),
		query,
		options.Find().SetSort(bson.D{{Key: "name", Value: 1}}),
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(context.Background())

	var types []models.LogType
	if err := cursor.All(context.Background(), &types); err != nil {
		return nil, err
	}
	if types == nil {
		types = []models.LogType{}
	}
	return types, nil
}

// GetLogType fetches a log type by its MongoDB ObjectID hex string.
// Returns nil, nil when not found.
func GetLogType(id string) (*models.LogType, error) {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, fmt.Errorf("invalid id")
	}

	var lt models.LogType
	err = logTypeCol().FindOne(context.Background(), bson.M{"_id": oid}).Decode(&lt)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &lt, err
}

// UpdateLogTypeSchema saves a new schema version.
// The current schema is pushed into schema_history, and current_version is incremented.
// Existing fields should be sent with their original field_id to preserve continuity.
// New fields (no field_id) get a generated id.
func UpdateLogTypeSchema(id string, itemFields []models.SchemaField, entryFields []models.SchemaField, costMode models.LogCostMode) (*models.LogType, error) {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, fmt.Errorf("invalid id")
	}

	// Read the current log type to know the current version number.
	var current models.LogType
	err = logTypeCol().FindOne(context.Background(), bson.M{"_id": oid}).Decode(&current)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	newItemFields := assignFieldIDs(itemFields)
	newEntryFields := assignFieldIDs(entryFields)
	nextCostMode, err := normalizeCostMode(costMode, newItemFields, newEntryFields)
	if err != nil {
		return nil, err
	}
	if err := validateSchemaForCostMode(nextCostMode, newEntryFields); err != nil {
		return nil, err
	}
	newVersion := current.CurrentVersion + 1
	newSchemaVersion := models.SchemaVersion{
		Version:     newVersion,
		Fields:      newItemFields,
		EntryFields: newEntryFields,
		CreatedAt:   time.Now(),
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var updated models.LogType
	err = logTypeCol().FindOneAndUpdate(
		context.Background(),
		bson.M{"_id": oid},
		bson.M{
			"$set":  bson.M{"current_version": newVersion, "current_schema": newItemFields, "current_entry_schema": newEntryFields, "uses_split_schema": true, "cost_mode": nextCostMode, "updated_at": time.Now()},
			"$push": bson.M{"schema_history": newSchemaVersion},
		},
		opts,
	).Decode(&updated)

	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &updated, err
}

// ArchiveLogType soft-deletes a log type.
func ArchiveLogType(id string) error {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return fmt.Errorf("invalid id")
	}
	res, err := logTypeCol().UpdateOne(
		context.Background(),
		bson.M{"_id": oid},
		bson.M{"$set": bson.M{"status": models.LogTypeArchived, "updated_at": time.Now()}},
	)
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return fmt.Errorf("log type not found")
	}
	return nil
}

// RestoreLogType brings an archived log type back to active status.
func RestoreLogType(id string) error {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return fmt.Errorf("invalid id")
	}
	res, err := logTypeCol().UpdateOne(
		context.Background(),
		bson.M{"_id": oid, "status": models.LogTypeArchived},
		bson.M{"$set": bson.M{"status": models.LogTypeActive, "updated_at": time.Now()}},
	)
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return fmt.Errorf("log type not found")
	}
	return nil
}

// ── LogCategory ───────────────────────────────────────────────────────────────

// CreateLogCategory adds a category under a log type.
// Example: LogType "Material" → Category "Plywood"
func CreateLogCategory(input CreateLogCategoryInput) (*models.LogCategory, error) {
	var lt models.LogType
	if err := logTypeCol().FindOne(context.Background(), bson.M{
		"_id":    input.LogTypeID,
		"status": models.LogTypeActive,
	}).Decode(&lt); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, fmt.Errorf("log type not found")
		}
		return nil, err
	}

	now := time.Now()
	cat := &models.LogCategory{
		ID:          primitive.NewObjectID(),
		LogTypeID:   input.LogTypeID,
		Name:        input.Name,
		Description: input.Description,
		Status:      models.LogCategoryActive,
		EntryCount:  0,
		CreatedBy:   input.CreatedBy,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	_, err := logCategoryCol().InsertOne(context.Background(), cat)
	if err != nil {
		return nil, fmt.Errorf("insert log category failed: %w", err)
	}
	return cat, nil
}

// ListLogCategories returns categories for a given log type.
func ListLogCategories(logTypeID string, opts LogListOptions) ([]models.LogCategory, error) {
	oid, err := primitive.ObjectIDFromHex(logTypeID)
	if err != nil {
		return nil, fmt.Errorf("invalid log_type_id")
	}
	query := bson.M{"log_type_id": oid}
	if !opts.IncludeArchived {
		query["status"] = models.LogCategoryActive
	}
	cursor, err := logCategoryCol().Find(
		context.Background(),
		query,
		options.Find().SetSort(bson.D{{Key: "name", Value: 1}}),
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(context.Background())

	var cats []models.LogCategory
	if err := cursor.All(context.Background(), &cats); err != nil {
		return nil, err
	}
	if cats == nil {
		cats = []models.LogCategory{}
	}
	return cats, nil
}

// GetLogCategory fetches a category by MongoDB ObjectID hex string.
func GetLogCategory(id string) (*models.LogCategory, error) {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, fmt.Errorf("invalid id")
	}

	var cat models.LogCategory
	err = logCategoryCol().FindOne(context.Background(), bson.M{"_id": oid}).Decode(&cat)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &cat, err
}

// ArchiveLogCategory soft-deletes a category.
func ArchiveLogCategory(id string) error {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return fmt.Errorf("invalid id")
	}
	now := time.Now()
	res, err := logCategoryCol().UpdateOne(
		context.Background(),
		bson.M{"_id": oid},
		bson.M{"$set": bson.M{"status": models.LogCategoryArchived, "updated_at": now, "archived_at": now}},
	)
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return fmt.Errorf("category not found")
	}
	return nil
}

// RestoreLogCategory brings an archived category back to active status.
func RestoreLogCategory(id string) error {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return fmt.Errorf("invalid id")
	}
	res, err := logCategoryCol().UpdateOne(
		context.Background(),
		bson.M{"_id": oid, "status": models.LogCategoryArchived},
		bson.M{"$set": bson.M{"status": models.LogCategoryActive, "updated_at": time.Now()}},
	)
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return fmt.Errorf("category not found")
	}
	return nil
}

// ── LogItem ───────────────────────────────────────────────────────────────────

// CreateLogItem adds an item under a category.
func CreateLogItem(input CreateLogItemInput) (*models.LogItem, error) {
	var lt models.LogType
	if err := logTypeCol().FindOne(context.Background(), bson.M{
		"_id":    input.LogTypeID,
		"status": models.LogTypeActive,
	}).Decode(&lt); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, fmt.Errorf("log type not found")
		}
		return nil, err
	}

	var cat models.LogCategory
	if err := logCategoryCol().FindOne(context.Background(), bson.M{
		"_id":         input.CategoryID,
		"log_type_id": input.LogTypeID,
		"status":      models.LogCategoryActive,
	}).Decode(&cat); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, fmt.Errorf("category not found")
		}
		return nil, err
	}

	normalizedFields, err := validateFieldValuesAgainstSchema(itemSchemaForLogType(lt), input.Fields)
	if err != nil {
		return nil, err
	}

	name := deriveItemName(itemSchemaForLogType(lt), normalizedFields)
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("item name could not be derived from the schema fields")
	}

	now := time.Now()
	item := &models.LogItem{
		ID:            primitive.NewObjectID(),
		LogTypeID:     input.LogTypeID,
		CategoryID:    input.CategoryID,
		Name:          name,
		Description:   input.Description,
		SchemaVersion: lt.CurrentVersion,
		Fields:        normalizedFields,
		Status:        models.LogItemActive,
		EntryCount:    0,
		CreatedBy:     input.CreatedBy,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	_, err = logItemCol().InsertOne(context.Background(), item)
	if err != nil {
		return nil, fmt.Errorf("insert log item failed: %w", err)
	}
	return item, nil
}

// ListLogItems returns items for a given category.
func ListLogItems(categoryID string, opts LogListOptions) ([]models.LogItem, error) {
	oid, err := primitive.ObjectIDFromHex(categoryID)
	if err != nil {
		return nil, fmt.Errorf("invalid category_id")
	}
	query := bson.M{"category_id": oid}
	if !opts.IncludeArchived {
		query["status"] = models.LogItemActive
	}
	cursor, err := logItemCol().Find(
		context.Background(),
		query,
		options.Find().SetSort(bson.D{{Key: "name", Value: 1}}),
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(context.Background())

	var items []models.LogItem
	if err := cursor.All(context.Background(), &items); err != nil {
		return nil, err
	}
	if items == nil {
		items = []models.LogItem{}
	}
	return items, nil
}

// ArchiveLogItem soft-deletes an item.
func ArchiveLogItem(id string) error {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return fmt.Errorf("invalid id")
	}
	now := time.Now()
	res, err := logItemCol().UpdateOne(
		context.Background(),
		bson.M{"_id": oid},
		bson.M{"$set": bson.M{"status": models.LogItemArchived, "updated_at": now, "archived_at": now}},
	)
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return fmt.Errorf("item not found")
	}
	return nil
}

// RestoreLogItem brings an archived item back to active status.
func RestoreLogItem(id string) error {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return fmt.Errorf("invalid id")
	}
	res, err := logItemCol().UpdateOne(
		context.Background(),
		bson.M{"_id": oid, "status": models.LogItemArchived},
		bson.M{"$set": bson.M{"status": models.LogItemActive, "updated_at": time.Now()}},
	)
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return fmt.Errorf("item not found")
	}
	return nil
}

// UpdateLogItem updates an item's schema-driven fields and refreshes its derived name.
func UpdateLogItem(id string, input UpdateLogItemInput) (*models.LogItem, error) {
	oid, err := primitive.ObjectIDFromHex(id)
	if err != nil {
		return nil, fmt.Errorf("invalid id")
	}

	var current models.LogItem
	if err := logItemCol().FindOne(context.Background(), bson.M{
		"_id":    oid,
		"status": models.LogItemActive,
	}).Decode(&current); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, nil
		}
		return nil, err
	}

	var lt models.LogType
	if err := logTypeCol().FindOne(context.Background(), bson.M{
		"_id":    current.LogTypeID,
		"status": models.LogTypeActive,
	}).Decode(&lt); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, fmt.Errorf("log type not found")
		}
		return nil, err
	}

	normalizedFields, err := validateFieldValuesAgainstSchema(itemSchemaForLogType(lt), input.Fields)
	if err != nil {
		return nil, err
	}

	name := deriveItemName(itemSchemaForLogType(lt), normalizedFields)
	if strings.TrimSpace(name) == "" {
		return nil, fmt.Errorf("item name could not be derived from the schema fields")
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var updated models.LogItem
	err = logItemCol().FindOneAndUpdate(
		context.Background(),
		bson.M{"_id": oid, "status": models.LogItemActive},
		bson.M{"$set": bson.M{
			"name":           name,
			"fields":         normalizedFields,
			"schema_version": lt.CurrentVersion,
			"updated_at":     time.Now(),
		}},
		opts,
	).Decode(&updated)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &updated, err
}

// ── LogEntry ──────────────────────────────────────────────────────────────────

// CreateLogEntry saves a daily log entry for a project.
// It snapshots the log type name, category name, and schema version number
// so historical entries are always accurate even after schema changes.
func CreateLogEntry(projectOID primitive.ObjectID, input CreateLogEntryInput) (*models.LogEntry, error) {
	// Parse the log date (client sends "YYYY-MM-DD")
	logDate, err := time.Parse("2006-01-02", input.LogDate)
	if err != nil {
		return nil, fmt.Errorf("invalid log_date — use YYYY-MM-DD format")
	}

	// Fetch log type for name snapshot + current schema version
	var lt models.LogType
	if err := logTypeCol().FindOne(context.Background(), bson.M{"_id": input.LogTypeID}).Decode(&lt); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, fmt.Errorf("log type not found")
		}
		return nil, err
	}

	entrySchema := entrySchemaForLogType(lt)
	normalizedFields, err := validateFieldValuesAgainstSchema(entrySchema, input.Fields)
	if err != nil {
		return nil, err
	}
	quantity, err := normalizeQuantity(input.Quantity)
	if err != nil {
		return nil, err
	}
	// Fetch category for name snapshot
	var cat models.LogCategory
	if err := logCategoryCol().FindOne(context.Background(), bson.M{"_id": input.CategoryID}).Decode(&cat); err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			return nil, fmt.Errorf("category not found")
		}
		return nil, err
	}

	var itemID *primitive.ObjectID
	var itemName string
	var itemFields []models.FieldValue
	if input.ItemID != nil && !input.ItemID.IsZero() {
		var item models.LogItem
		if err := logItemCol().FindOne(context.Background(), bson.M{
			"_id":         *input.ItemID,
			"category_id": input.CategoryID,
			"status":      models.LogItemActive,
		}).Decode(&item); err != nil {
			if errors.Is(err, mongo.ErrNoDocuments) {
				return nil, fmt.Errorf("item not found")
			}
			return nil, err
		}
		itemID = &item.ID
		itemName = item.Name
		itemFields = item.Fields
	}
	totalCost := computeEntryTotalCostForLogType(lt, normalizedFields, itemFields, quantity)

	now := time.Now()
	entry := &models.LogEntry{
		ID:            primitive.NewObjectID(),
		ProjectID:     projectOID,
		LogTypeID:     input.LogTypeID,
		LogTypeName:   lt.Name,
		CategoryID:    input.CategoryID,
		CategoryName:  cat.Name,
		ItemID:        itemID,
		ItemName:      itemName,
		SchemaVersion: lt.CurrentVersion,
		Quantity:      quantity,
		TotalCost:     totalCost,
		Fields:        normalizedFields,
		LogDate:       logDate,
		Notes:         input.Notes,
		CreatedBy:     input.CreatedBy,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if entry.Fields == nil {
		entry.Fields = []models.FieldValue{}
	}

	if _, err = logEntryCol().InsertOne(context.Background(), entry); err != nil {
		return nil, fmt.Errorf("insert log entry failed: %w", err)
	}

	// Keep category entry_count in sync (best-effort, non-fatal)
	logCategoryCol().UpdateOne(
		context.Background(),
		bson.M{"_id": input.CategoryID},
		bson.M{"$inc": bson.M{"entry_count": 1}},
	)
	if itemID != nil {
		logItemCol().UpdateOne(
			context.Background(),
			bson.M{"_id": *itemID},
			bson.M{"$inc": bson.M{"entry_count": 1}},
		)
	}

	return entry, nil
}

// ListLogEntries returns log entries for a project, optionally filtered.
func ListLogEntries(projectOID primitive.ObjectID, filter LogEntryFilter) ([]models.LogEntry, error) {
	query := bson.M{"project_id": projectOID}

	if filter.LogTypeID != "" {
		if oid, err := primitive.ObjectIDFromHex(filter.LogTypeID); err == nil {
			query["log_type_id"] = oid
		}
	}
	if filter.CategoryID != "" {
		if oid, err := primitive.ObjectIDFromHex(filter.CategoryID); err == nil {
			query["category_id"] = oid
		}
	}
	if filter.LogDate != "" {
		if t, err := time.Parse("2006-01-02", filter.LogDate); err == nil {
			start := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
			query["log_date"] = bson.M{"$gte": start, "$lt": start.Add(24 * time.Hour)}
		}
	}

	cursor, err := logEntryCol().Find(
		context.Background(),
		query,
		options.Find().SetSort(bson.D{{Key: "log_date", Value: -1}, {Key: "created_at", Value: -1}}),
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(context.Background())

	var entries []models.LogEntry
	if err := cursor.All(context.Background(), &entries); err != nil {
		return nil, err
	}
	if entries == nil {
		entries = []models.LogEntry{}
	}
	return entries, nil
}

// UpdateLogEntry updates the fields and/or notes of a log entry.
func UpdateLogEntry(entryOID primitive.ObjectID, input UpdateLogEntryInput) (*models.LogEntry, error) {
	set := bson.M{"updated_at": time.Now()}
	var normalizedFields []models.FieldValue
	var currentQuantity *float64
	if input.Fields != nil {
		var current models.LogEntry
		if err := logEntryCol().FindOne(context.Background(), bson.M{"_id": entryOID}).Decode(&current); err != nil {
			if errors.Is(err, mongo.ErrNoDocuments) {
				return nil, nil
			}
			return nil, err
		}

		var logType models.LogType
		if err := logTypeCol().FindOne(context.Background(), bson.M{"_id": current.LogTypeID}).Decode(&logType); err != nil {
			return nil, err
		}

		var err error
		normalizedFields, err = validateFieldValuesAgainstSchema(entrySchemaForLogType(logType), input.Fields)
		if err != nil {
			return nil, err
		}
		currentQuantity = current.Quantity
		set["fields"] = normalizedFields
		if current.ItemID != nil {
			var item models.LogItem
			if err := logItemCol().FindOne(context.Background(), bson.M{"_id": *current.ItemID}).Decode(&item); err == nil {
				set["total_cost"] = computeEntryTotalCostForLogType(logType, normalizedFields, item.Fields, currentQuantity)
			} else {
				set["total_cost"] = computeEntryTotalCostForLogType(logType, normalizedFields, nil, currentQuantity)
			}
		} else {
			set["total_cost"] = computeEntryTotalCostForLogType(logType, normalizedFields, nil, currentQuantity)
		}
	}
	if input.Notes != nil {
		set["notes"] = *input.Notes
	}
	if input.Quantity != nil {
		quantity, err := normalizeQuantity(input.Quantity)
		if err != nil {
			return nil, err
		}
		currentQuantity = quantity
		set["quantity"] = quantity
	}
	if input.Quantity != nil && normalizedFields == nil {
		var current models.LogEntry
		if err := logEntryCol().FindOne(context.Background(), bson.M{"_id": entryOID}).Decode(&current); err != nil {
			if errors.Is(err, mongo.ErrNoDocuments) {
				return nil, nil
			}
			return nil, err
		}
		var itemFields []models.FieldValue
		if current.ItemID != nil {
			var item models.LogItem
			if err := logItemCol().FindOne(context.Background(), bson.M{"_id": *current.ItemID}).Decode(&item); err == nil {
				itemFields = item.Fields
			}
		}
		var logType models.LogType
		if err := logTypeCol().FindOne(context.Background(), bson.M{"_id": current.LogTypeID}).Decode(&logType); err == nil {
			set["total_cost"] = computeEntryTotalCostForLogType(logType, current.Fields, itemFields, currentQuantity)
		} else {
			set["total_cost"] = computeEntryTotalCost(current.Fields, itemFields, currentQuantity, models.LogCostModeQuantityXUnitCost)
		}
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var entry models.LogEntry
	err := logEntryCol().FindOneAndUpdate(
		context.Background(),
		bson.M{"_id": entryOID},
		bson.M{"$set": set},
		opts,
	).Decode(&entry)

	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &entry, err
}

// DeleteLogEntry hard-deletes a log entry (LogEntry has no status field).
// Also decrements the category's entry_count.
func DeleteLogEntry(entryOID primitive.ObjectID) error {
	var entry models.LogEntry
	err := logEntryCol().FindOne(context.Background(), bson.M{"_id": entryOID}).Decode(&entry)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return fmt.Errorf("entry not found")
	}
	if err != nil {
		return err
	}

	if _, err = logEntryCol().DeleteOne(context.Background(), bson.M{"_id": entryOID}); err != nil {
		return err
	}

	// Keep category entry_count in sync (best-effort)
	logCategoryCol().UpdateOne(
		context.Background(),
		bson.M{"_id": entry.CategoryID},
		bson.M{"$inc": bson.M{"entry_count": -1}},
	)
	if entry.ItemID != nil {
		logItemCol().UpdateOne(
			context.Background(),
			bson.M{"_id": *entry.ItemID},
			bson.M{"$inc": bson.M{"entry_count": -1}},
		)
	}
	return nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// assignFieldIDs ensures every SchemaField has a stable field_id.
// Fields coming in without a field_id (new fields) get a generated one.
// Fields with an existing field_id (from a previous schema version) keep theirs.
func assignFieldIDs(fields []models.SchemaField) []models.SchemaField {
	now := time.Now()
	result := make([]models.SchemaField, len(fields))
	for i, f := range fields {
		if f.FieldID == "" {
			f.FieldID = primitive.NewObjectID().Hex() // full 24-char hex — guaranteed unique per call
		}
		if f.AddedAt.IsZero() {
			f.AddedAt = now
		}
		result[i] = f
	}
	return result
}

func resolveItemSchemaFields(legacyFields []models.SchemaField, itemFields []models.SchemaField) []models.SchemaField {
	if len(itemFields) > 0 {
		return itemFields
	}
	return legacyFields
}

func itemSchemaForLogType(logType models.LogType) []models.SchemaField {
	if logType.CurrentSchema == nil {
		return []models.SchemaField{}
	}
	return logType.CurrentSchema
}

func entrySchemaForLogType(logType models.LogType) []models.SchemaField {
	if logType.UsesSplitSchema {
		if logType.CurrentEntrySchema == nil {
			return []models.SchemaField{}
		}
		return logType.CurrentEntrySchema
	}
	return itemSchemaForLogType(logType)
}

func effectiveCostMode(logType models.LogType) models.LogCostMode {
	if logType.CostMode != "" {
		return logType.CostMode
	}
	return inferCostModeFromSchemas(itemSchemaForLogType(logType), entrySchemaForLogType(logType))
}

func normalizeCostMode(costMode models.LogCostMode, itemFields []models.SchemaField, entryFields []models.SchemaField) (models.LogCostMode, error) {
	if costMode == "" {
		return inferCostModeFromSchemas(itemFields, entryFields), nil
	}
	switch costMode {
	case models.LogCostModeQuantityXUnitCost, models.LogCostModeDirectAmount, models.LogCostModeManualTotal:
		return costMode, nil
	default:
		return "", fmt.Errorf("invalid cost mode")
	}
}

func inferCostModeFromSchemas(itemFields []models.SchemaField, entryFields []models.SchemaField) models.LogCostMode {
	if hasUnitCostField(itemFields) || hasUnitCostField(entryFields) {
		return models.LogCostModeQuantityXUnitCost
	}
	if hasDirectAmountField(entryFields) {
		return models.LogCostModeDirectAmount
	}
	if hasTotalCostField(entryFields) {
		return models.LogCostModeManualTotal
	}
	return models.LogCostModeManualTotal
}

func validateSchemaForCostMode(costMode models.LogCostMode, entryFields []models.SchemaField) error {
	switch costMode {
	case models.LogCostModeQuantityXUnitCost:
		for _, field := range entryFields {
			if isQuantityLabel(field.Label) {
				return fmt.Errorf("quantity is already handled by this cost mode, so it should not be added as a daily entry field")
			}
			if hasTotalCostLabel(field.Label) {
				return fmt.Errorf("total cost is already handled by this cost mode, so it should not be added as a daily entry field")
			}
		}
	case models.LogCostModeDirectAmount:
		for _, field := range entryFields {
			if hasTotalCostLabel(field.Label) {
				return fmt.Errorf("total cost is computed from the direct amount field in this cost mode, so it should not be added as a daily entry field")
			}
		}
	}
	return nil
}

func validateFieldValuesAgainstSchema(schema []models.SchemaField, values []models.FieldValue) ([]models.FieldValue, error) {
	byFieldID := make(map[string]models.FieldValue, len(values))
	for _, value := range values {
		byFieldID[value.FieldID] = value
	}

	result := make([]models.FieldValue, 0, len(schema))
	for _, field := range schema {
		value, ok := byFieldID[field.FieldID]
		if !ok {
			value = models.FieldValue{FieldID: field.FieldID, Label: field.Label, Value: nil}
		}

		normalized, err := normalizeFieldValue(field, value.Value)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", field.Label, err)
		}
		if field.Required && isEmptyFieldValue(field, normalized) {
			return nil, fmt.Errorf("%s is required", field.Label)
		}

		result = append(result, models.FieldValue{
			FieldID: field.FieldID,
			Label:   field.Label,
			Value:   normalized,
		})
	}

	return result, nil
}

func normalizeFieldValue(field models.SchemaField, value interface{}) (interface{}, error) {
	switch field.FieldType {
	case models.FieldTypeText:
		if value == nil {
			return nil, nil
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text == "" {
			return nil, nil
		}
		return text, nil
	case models.FieldTypeNumber:
		if value == nil || value == "" {
			return nil, nil
		}
		switch value.(type) {
		case float64, float32, int, int32, int64:
			return value, nil
		default:
			text := strings.TrimSpace(fmt.Sprint(value))
			if text == "" {
				return nil, nil
			}
			var parsed float64
			if _, err := fmt.Sscanf(text, "%f", &parsed); err != nil {
				return nil, fmt.Errorf("must be a number")
			}
			return parsed, nil
		}
	case models.FieldTypeDropdown:
		if value == nil {
			return nil, nil
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text == "" {
			return nil, nil
		}
		for _, option := range field.Options {
			if option == text {
				return text, nil
			}
		}
		return nil, fmt.Errorf("must be one of the defined options")
	case models.FieldTypeDate:
		if value == nil {
			return nil, nil
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text == "" {
			return nil, nil
		}
		if _, err := time.Parse("2006-01-02", text); err != nil {
			return nil, fmt.Errorf("must use YYYY-MM-DD format")
		}
		return text, nil
	case models.FieldTypeBoolean:
		if value == nil {
			return false, nil
		}
		boolean, ok := value.(bool)
		if !ok {
			return nil, fmt.Errorf("must be true or false")
		}
		return boolean, nil
	default:
		return value, nil
	}
}

func isEmptyFieldValue(field models.SchemaField, value interface{}) bool {
	switch field.FieldType {
	default:
		return value == nil || strings.TrimSpace(fmt.Sprint(value)) == ""
	}
}

func deriveItemName(schema []models.SchemaField, values []models.FieldValue) string {
	valueByFieldID := make(map[string]interface{}, len(values))
	for _, value := range values {
		valueByFieldID[value.FieldID] = value.Value
	}

	for _, field := range schema {
		label := strings.ToLower(strings.TrimSpace(field.Label))
		if label == "name" || strings.Contains(label, "name") || strings.Contains(label, "item") || strings.Contains(label, "material") {
			if value := strings.TrimSpace(fmt.Sprint(valueByFieldID[field.FieldID])); value != "" && value != "<nil>" {
				return value
			}
		}
	}

	for _, field := range schema {
		if value := strings.TrimSpace(fmt.Sprint(valueByFieldID[field.FieldID])); value != "" && value != "<nil>" {
			return value
		}
	}

	return ""
}

func normalizeQuantity(quantity *float64) (*float64, error) {
	if quantity == nil {
		return nil, nil
	}
	if *quantity <= 0 {
		return nil, fmt.Errorf("quantity must be greater than 0")
	}
	value := *quantity
	return &value, nil
}

func computeEntryTotalCost(fields []models.FieldValue, itemFields []models.FieldValue, quantity *float64, costMode models.LogCostMode) *float64 {
	switch costMode {
	case models.LogCostModeDirectAmount:
		return extractDirectAmount(fields)
	case models.LogCostModeManualTotal:
		return extractTotalCost(fields)
	default:
		if quantity == nil {
			return nil
		}
		unitCost := extractUnitCost(fields)
		if unitCost == nil {
			unitCost = extractUnitCost(itemFields)
		}
		if unitCost == nil {
			return nil
		}
		totalUnits := *quantity
		if sizeMultiplier := extractSizeMultiplier(fields, itemFields); sizeMultiplier != nil {
			totalUnits *= *sizeMultiplier
		}
		total := totalUnits * *unitCost
		return &total
	}
}

func computeEntryTotalCostForLogType(logType models.LogType, fields []models.FieldValue, itemFields []models.FieldValue, quantity *float64) *float64 {
	costMode := effectiveCostMode(logType)
	totalCost := computeEntryTotalCost(fields, itemFields, quantity, costMode)
	if totalCost != nil || costMode != models.LogCostModeQuantityXUnitCost || quantity == nil {
		return totalCost
	}

	ruleRate := extractPricingRuleUnitCost(logType.ID, fields, itemFields)
	if ruleRate == nil {
		return nil
	}
	totalUnits := *quantity
	if sizeMultiplier := extractSizeMultiplier(fields, itemFields); sizeMultiplier != nil {
		totalUnits *= *sizeMultiplier
	}
	total := totalUnits * *ruleRate
	return &total
}

func extractSizeMultiplier(fields []models.FieldValue, itemFields []models.FieldValue) *float64 {
	if value := extractSizeMultiplierFromFields(fields); value != nil {
		return value
	}
	return extractSizeMultiplierFromFields(itemFields)
}

func extractSizeMultiplierFromFields(fields []models.FieldValue) *float64 {
	for _, field := range fields {
		if !hasSizeLabel(field.Label) {
			continue
		}
		value := toSizeMultiplier(field.Value)
		if value != nil {
			return value
		}
	}
	return nil
}

func extractPricingRuleUnitCost(logTypeID primitive.ObjectID, fields []models.FieldValue, itemFields []models.FieldValue) *float64 {
	var rule models.PricingRule
	err := pricingRuleCol().FindOne(context.Background(), bson.M{"log_type_id": logTypeID}).Decode(&rule)
	if err != nil || len(rule.DimensionFields) == 0 || len(rule.Rates) == 0 {
		return nil
	}

	selectedKeys := make(map[string]string, len(rule.DimensionFields))
	for _, fieldID := range rule.DimensionFields {
		value := findFieldStringValue(fieldID, fields)
		if value == "" {
			value = findFieldStringValue(fieldID, itemFields)
		}
		if value == "" {
			return nil
		}
		selectedKeys[fieldID] = value
	}

	for _, rate := range rule.Rates {
		if pricingRateMatches(rule.DimensionFields, selectedKeys, rate.Keys) {
			value := rate.Rate
			return &value
		}
	}

	return nil
}

func findFieldStringValue(fieldID string, fields []models.FieldValue) string {
	for _, field := range fields {
		if field.FieldID != fieldID {
			continue
		}
		value := strings.TrimSpace(fmt.Sprint(field.Value))
		if value == "" || value == "<nil>" {
			return ""
		}
		return value
	}
	return ""
}

func pricingRateMatches(dimensionFields []string, selectedKeys map[string]string, candidate map[string]string) bool {
	if len(candidate) == 0 {
		return false
	}
	for _, fieldID := range dimensionFields {
		if candidate[fieldID] != selectedKeys[fieldID] {
			return false
		}
	}
	return true
}

func extractUnitCost(fields []models.FieldValue) *float64 {
	for _, field := range fields {
		if !hasUnitCostLabel(field.Label) {
			continue
		}
		value := toFloat64(field.Value)
		if value == nil {
			continue
		}
		return value
	}
	return nil
}

func extractDirectAmount(fields []models.FieldValue) *float64 {
	for _, field := range fields {
		if !hasDirectAmountLabel(field.Label) {
			continue
		}
		value := toFloat64(field.Value)
		if value != nil {
			return value
		}
	}
	return extractTotalCost(fields)
}

func extractTotalCost(fields []models.FieldValue) *float64 {
	for _, field := range fields {
		if !hasTotalCostLabel(field.Label) {
			continue
		}
		value := toFloat64(field.Value)
		if value != nil {
			return value
		}
	}
	return nil
}

func hasUnitCostField(fields []models.SchemaField) bool {
	for _, field := range fields {
		if hasUnitCostLabel(field.Label) {
			return true
		}
	}
	return false
}

func hasDirectAmountField(fields []models.SchemaField) bool {
	for _, field := range fields {
		if hasDirectAmountLabel(field.Label) {
			return true
		}
	}
	return false
}

func hasTotalCostField(fields []models.SchemaField) bool {
	for _, field := range fields {
		if hasTotalCostLabel(field.Label) {
			return true
		}
	}
	return false
}

func hasUnitCostLabel(label string) bool {
	value := strings.ToLower(strings.TrimSpace(label))
	return value == "cost" || strings.Contains(value, "unit cost") || strings.Contains(value, "cost per unit") || strings.Contains(value, "rate") || strings.Contains(value, "price")
}

func hasDirectAmountLabel(label string) bool {
	value := strings.ToLower(strings.TrimSpace(label))
	return strings.Contains(value, "daily cost") || strings.Contains(value, "daily payment") || strings.Contains(value, "payment") || strings.Contains(value, "amount paid") || strings.Contains(value, "wage") || strings.Contains(value, "charges")
}

func hasTotalCostLabel(label string) bool {
	value := strings.ToLower(strings.TrimSpace(label))
	return value == "total cost" || value == "total" || strings.Contains(value, "total cost")
}

func hasSizeLabel(label string) bool {
	value := strings.ToLower(strings.TrimSpace(label))
	return strings.Contains(value, "size") || strings.Contains(value, "dimension") || strings.Contains(value, "measurement")
}

func isQuantityLabel(label string) bool {
	value := strings.ToLower(strings.TrimSpace(label))
	return value == "quantity" || value == "qty" || strings.Contains(value, "quantity") || strings.Contains(value, "qty")
}

func toSizeMultiplier(value interface{}) *float64 {
	switch typed := value.(type) {
	case float64:
		if typed > 0 {
			return &typed
		}
		return nil
	case float32:
		converted := float64(typed)
		if converted > 0 {
			return &converted
		}
		return nil
	case int:
		converted := float64(typed)
		if converted > 0 {
			return &converted
		}
		return nil
	case int32:
		converted := float64(typed)
		if converted > 0 {
			return &converted
		}
		return nil
	case int64:
		converted := float64(typed)
		if converted > 0 {
			return &converted
		}
		return nil
	}

	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return nil
	}
	if strict := parseStrictPositiveNumber(text); strict != nil {
		return strict
	}
	normalized := strings.ToLower(text)
	normalized = strings.ReplaceAll(normalized, "×", "x")
	normalized = strings.ReplaceAll(normalized, "*", "x")
	normalized = strings.ReplaceAll(normalized, " by ", " x ")
	parts := strings.Split(normalized, "x")
	if len(parts) == 0 {
		return nil
	}

	product := 1.0
	foundNumericPart := false
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		numberText := firstNumericToken(part)
		if numberText == "" {
			return nil
		}
		var parsed float64
		if _, err := fmt.Sscanf(numberText, "%f", &parsed); err != nil || parsed <= 0 {
			return nil
		}
		product *= parsed
		foundNumericPart = true
	}
	if !foundNumericPart {
		return nil
	}
	return &product
}

func parseStrictPositiveNumber(value string) *float64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	for _, ch := range value {
		if (ch < '0' || ch > '9') && ch != '.' {
			return nil
		}
	}
	var parsed float64
	if _, err := fmt.Sscanf(value, "%f", &parsed); err != nil || parsed <= 0 {
		return nil
	}
	return &parsed
}

func firstNumericToken(value string) string {
	start := -1
	dotSeen := false
	for idx, ch := range value {
		if ch >= '0' && ch <= '9' {
			if start == -1 {
				start = idx
			}
			continue
		}
		if ch == '.' && start != -1 && !dotSeen {
			dotSeen = true
			continue
		}
		if start != -1 {
			return value[start:idx]
		}
	}
	if start == -1 {
		return ""
	}
	return value[start:]
}

func toFloat64(value interface{}) *float64 {
	switch v := value.(type) {
	case float64:
		return &v
	case float32:
		result := float64(v)
		return &result
	case int:
		result := float64(v)
		return &result
	case int32:
		result := float64(v)
		return &result
	case int64:
		result := float64(v)
		return &result
	default:
		text := strings.TrimSpace(fmt.Sprint(value))
		if text == "" || text == "<nil>" {
			return nil
		}
		var result float64
		if _, err := fmt.Sscanf(text, "%f", &result); err != nil {
			return nil
		}
		return &result
	}
}
