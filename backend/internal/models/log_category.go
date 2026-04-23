package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// LogCategoryStatus defines the status of a log category
type LogCategoryStatus string

const (
	LogCategoryActive   LogCategoryStatus = "active"
	LogCategoryArchived LogCategoryStatus = "archived"
)

// LogCategory represents a category under a LogType
// e.g. LogType: Material → Categories: Plywood, Tiles, Paint
// Company-level — shared across all projects
type LogCategory struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	LogTypeID   primitive.ObjectID `bson:"log_type_id" json:"log_type_id"` // reference to LogType
	Name        string             `bson:"name" json:"name"`               // e.g. "Plywood"
	Description string             `bson:"description,omitempty" json:"description,omitempty"`
	Status      LogCategoryStatus  `bson:"status" json:"status"`
	EntryCount  int64              `bson:"entry_count" json:"entry_count"` // cached count for delete warning
	CreatedBy   primitive.ObjectID `bson:"created_by" json:"created_by"`
	CreatedAt   time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt   time.Time          `bson:"updated_at" json:"updated_at"`
	ArchivedAt  *time.Time         `bson:"archived_at,omitempty" json:"archived_at,omitempty"`
	ArchivedBy  *primitive.ObjectID `bson:"archived_by,omitempty" json:"archived_by,omitempty"`
}
