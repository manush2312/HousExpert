package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// FieldValue stores the actual value entered for a schema field
type FieldValue struct {
	FieldID string      `bson:"field_id" json:"field_id"` // matches SchemaField.FieldID
	Label   string      `bson:"label" json:"label"`       // snapshot of label at time of entry
	Value   interface{} `bson:"value" json:"value"`       // actual entered value
}

// LogEntry represents a single daily log entry in a project
// Each entry stores the schema version it was created with
// so historical entries remain accurate even if schema changes later
type LogEntry struct {
	ID            primitive.ObjectID  `bson:"_id,omitempty" json:"id"`
	ProjectID     primitive.ObjectID  `bson:"project_id" json:"project_id"`                   // which project
	LogTypeID     primitive.ObjectID  `bson:"log_type_id" json:"log_type_id"`                 // e.g. Material
	LogTypeName   string              `bson:"log_type_name" json:"log_type_name"`             // snapshot name
	CategoryID    primitive.ObjectID  `bson:"category_id" json:"category_id"`                 // e.g. Plywood
	CategoryName  string              `bson:"category_name" json:"category_name"`             // snapshot name
	ItemID        *primitive.ObjectID `bson:"item_id,omitempty" json:"item_id,omitempty"`     // e.g. Plywood-01
	ItemName      string              `bson:"item_name,omitempty" json:"item_name,omitempty"` // snapshot name
	SchemaVersion int                 `bson:"schema_version" json:"schema_version"`           // version used at time of entry
	Quantity      *float64            `bson:"quantity,omitempty" json:"quantity,omitempty"`
	TotalCost     *float64            `bson:"total_cost,omitempty" json:"total_cost,omitempty"`
	Fields        []FieldValue        `bson:"fields" json:"fields"`     // actual data entered
	LogDate       time.Time           `bson:"log_date" json:"log_date"` // the date this log is for
	Notes         string              `bson:"notes,omitempty" json:"notes,omitempty"`
	CreatedBy     primitive.ObjectID  `bson:"created_by" json:"created_by"`
	CreatedAt     time.Time           `bson:"created_at" json:"created_at"`
	UpdatedAt     time.Time           `bson:"updated_at" json:"updated_at"`
}

// DailyLogSummary is a helper struct for grouping entries by date (used in reports)
type DailyLogSummary struct {
	LogDate   time.Time          `bson:"log_date" json:"log_date"`
	ProjectID primitive.ObjectID `bson:"project_id" json:"project_id"`
	Entries   []LogEntry         `bson:"entries" json:"entries"`
	TotalCost float64            `bson:"total_cost" json:"total_cost"` // computed from number fields
}
