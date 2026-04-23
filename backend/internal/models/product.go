package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Product represents an item from the company's catalog (e.g. BED, WARDROBE, KITCHEN).
// Products are a flat list — room grouping only happens inside a Quotation's sections.
type Product struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	ProductID   string             `bson:"product_id" json:"product_id"` // PRD-001
	Name        string             `bson:"name" json:"name"`
	DefaultSize string             `bson:"default_size,omitempty" json:"default_size,omitempty"` // e.g. "6x6.5"
	CreatedAt   time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt   time.Time          `bson:"updated_at" json:"updated_at"`
}
