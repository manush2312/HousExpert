package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// LogItemStatus defines the status of an item under a log category.
type LogItemStatus string

const (
	LogItemActive   LogItemStatus = "active"
	LogItemArchived LogItemStatus = "archived"
)

type LogItemInventoryLink struct {
	InventoryItemID   string  `bson:"inventory_item_id" json:"inventory_item_id"`
	InventoryItemName string  `bson:"inventory_item_name" json:"inventory_item_name"`
	InventoryUnit     string  `bson:"inventory_unit" json:"inventory_unit"`
	QuantityUnit      string  `bson:"quantity_unit" json:"quantity_unit"`
	UsagePerQuantity  float64 `bson:"usage_per_quantity" json:"usage_per_quantity"`
}

type LogItemInventoryMapping struct {
	Conditions map[string]string    `bson:"conditions" json:"conditions"`
	Link       LogItemInventoryLink `bson:"link" json:"link"`
}

// LogItem represents a selectable item under a category.
// e.g. LogType: Material -> Category: Plywood -> Items: Plywood-01, Plywood-02
type LogItem struct {
	ID                primitive.ObjectID        `bson:"_id,omitempty" json:"id"`
	LogTypeID         primitive.ObjectID        `bson:"log_type_id" json:"log_type_id"`
	CategoryID        primitive.ObjectID        `bson:"category_id" json:"category_id"`
	Name              string                    `bson:"name" json:"name"`
	Description       string                    `bson:"description,omitempty" json:"description,omitempty"`
	InventoryLink     *LogItemInventoryLink     `bson:"inventory_link,omitempty" json:"inventory_link,omitempty"`
	InventoryMappings []LogItemInventoryMapping `bson:"inventory_mappings,omitempty" json:"inventory_mappings,omitempty"`
	SchemaVersion     int                       `bson:"schema_version" json:"schema_version"`
	Fields            []FieldValue              `bson:"fields" json:"fields"`
	Status            LogItemStatus             `bson:"status" json:"status"`
	EntryCount        int64                     `bson:"entry_count" json:"entry_count"`
	CreatedBy         primitive.ObjectID        `bson:"created_by" json:"created_by"`
	CreatedAt         time.Time                 `bson:"created_at" json:"created_at"`
	UpdatedAt         time.Time                 `bson:"updated_at" json:"updated_at"`
	ArchivedAt        *time.Time                `bson:"archived_at,omitempty" json:"archived_at,omitempty"`
	ArchivedBy        *primitive.ObjectID       `bson:"archived_by,omitempty" json:"archived_by,omitempty"`
}
