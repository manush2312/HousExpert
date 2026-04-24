package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// PricingRateEntry holds the rate for a specific combination of dimension field values.
// Keys maps field_id → selected value (e.g. {"thickness_id": "4mm", "quality_id": "premium"}).
type PricingRateEntry struct {
	Keys map[string]string `bson:"keys" json:"keys"`
	Rate float64           `bson:"rate" json:"rate"`
}

type PricingRuleVersion struct {
	Version         int                `bson:"version" json:"version"`
	Name            string             `bson:"name" json:"name"`
	DimensionFields []string           `bson:"dimension_fields" json:"dimension_fields"`
	Rates           []PricingRateEntry `bson:"rates" json:"rates"`
	CreatedAt       time.Time          `bson:"created_at" json:"created_at"`
}

// PricingRule defines a dynamic rate table for a log type.
// When the user fills in the dimension fields and quantity, total cost is
// computed as: rate(dim1_value, dim2_value, ...) × quantity.
type PricingRule struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	LogTypeID primitive.ObjectID `bson:"log_type_id"   json:"log_type_id"`
	// Human-readable name (e.g. "Plywood rates")
	Name string `bson:"name"              json:"name"`
	// DimensionFields lists field_ids (must be dropdown fields) that together
	// determine the rate. Typically 1–2 fields.
	DimensionFields []string `bson:"dimension_fields"  json:"dimension_fields"`
	// Rates is the flat rate table. Each entry has a Keys map (field_id → value)
	// and the corresponding price per unit of quantity.
	Rates          []PricingRateEntry   `bson:"rates"             json:"rates"`
	CurrentVersion int                  `bson:"current_version"   json:"current_version"`
	VersionHistory []PricingRuleVersion `bson:"version_history" json:"version_history"`
	CreatedAt      time.Time            `bson:"created_at"        json:"created_at"`
	UpdatedAt      time.Time            `bson:"updated_at"        json:"updated_at"`
}
