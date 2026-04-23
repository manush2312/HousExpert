package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// FieldType defines the data type of a schema field
type FieldType string

const (
	FieldTypeText     FieldType = "text"
	FieldTypeNumber   FieldType = "number"
	FieldTypeDropdown FieldType = "dropdown"
	FieldTypeDate     FieldType = "date"
	FieldTypeBoolean  FieldType = "boolean"
)

// SchemaField defines a single field in a log type's schema
type SchemaField struct {
	FieldID   string    `bson:"field_id" json:"field_id"`     // e.g. "field_001"
	Label     string    `bson:"label" json:"label"`           // e.g. "Quantity"
	FieldType FieldType `bson:"field_type" json:"field_type"` // text, number, dropdown, date, boolean
	Required  bool      `bson:"required" json:"required"`
	Options   []string  `bson:"options,omitempty" json:"options,omitempty"` // only for dropdown type
	AddedAt   time.Time `bson:"added_at" json:"added_at"`                   // for "Field added on [date]" indicator
}

// SchemaVersion stores a snapshot of the schema at a point in time
type SchemaVersion struct {
	Version     int           `bson:"version" json:"version"`                   // 1, 2, 3...
	Fields      []SchemaField `bson:"fields" json:"fields"`                     // item fields (legacy/current)
	EntryFields []SchemaField `bson:"entry_fields,omitempty" json:"entry_fields,omitempty"`
	CreatedAt   time.Time     `bson:"created_at" json:"created_at"` // when this version was created
}

// LogTypeStatus defines the status of a log type
type LogTypeStatus string

const (
	LogTypeActive   LogTypeStatus = "active"
	LogTypeArchived LogTypeStatus = "archived"
)

type LogCostMode string

const (
	LogCostModeQuantityXUnitCost LogCostMode = "quantity_x_unit_cost"
	LogCostModeDirectAmount      LogCostMode = "direct_amount"
	LogCostModeManualTotal       LogCostMode = "manual_total"
)

// LogType represents a company-level log type (e.g. Material, Labour, Transportation)
// Admin defines this once — shared across all projects
type LogType struct {
	ID                 primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Name               string             `bson:"name" json:"name"` // e.g. "Material"
	CurrentVersion     int                `bson:"current_version" json:"current_version"`
	CurrentSchema      []SchemaField      `bson:"current_schema" json:"current_schema"` // latest item schema fields
	CurrentEntrySchema []SchemaField      `bson:"current_entry_schema,omitempty" json:"current_entry_schema,omitempty"`
	UsesSplitSchema    bool               `bson:"uses_split_schema,omitempty" json:"uses_split_schema,omitempty"`
	CostMode           LogCostMode        `bson:"cost_mode,omitempty" json:"cost_mode,omitempty"`
	SchemaHistory      []SchemaVersion    `bson:"schema_history" json:"schema_history"` // all past versions
	Status             LogTypeStatus      `bson:"status" json:"status"`
	CreatedBy          primitive.ObjectID `bson:"created_by" json:"created_by"`
	CreatedAt          time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt          time.Time          `bson:"updated_at" json:"updated_at"`
}
