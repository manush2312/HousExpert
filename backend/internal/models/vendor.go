package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// Vendor represents a supplier/vendor in the system. It is the single source of
// truth for supplier names — inventory items, stock lots and log entries all
// reference a vendor by its canonical name so buckets never fragment on typos.
type Vendor struct {
	ID       primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	VendorID string             `bson:"vendor_id" json:"vendor_id"` // e.g. VND-001
	Name     string             `bson:"name" json:"name"`
	// NameKey is a lowercased, trimmed copy of Name used to enforce
	// case-insensitive uniqueness and to match free-text supplier strings.
	NameKey string `bson:"name_key" json:"-"`
	GSTIN   string `bson:"gstin,omitempty" json:"gstin,omitempty"`
	Mobile  string `bson:"mobile,omitempty" json:"mobile,omitempty"`
	Email   string `bson:"email,omitempty" json:"email,omitempty"`
	Address string `bson:"address,omitempty" json:"address,omitempty"`
	// CategoriesServed tags which inventory categories this supplier serves
	// (e.g. ["Plywood", "Laminate"]). Used to filter the supplier dropdown
	// when adding an inventory item under a given category.
	CategoriesServed []string           `bson:"categories_served,omitempty" json:"categories_served,omitempty"`
	Notes            string             `bson:"notes,omitempty" json:"notes,omitempty"`
	Status           string             `bson:"status" json:"status"` // "active" / "inactive"
	CreatedBy        primitive.ObjectID `bson:"created_by,omitempty" json:"created_by"`
	CreatedAt        time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt        time.Time          `bson:"updated_at" json:"updated_at"`
}

// CostType defines whether a product is fixed or per-sqft priced
type CostType string

const (
	CostTypeFixed   CostType = "fixed"
	CostTypePerSqft CostType = "per_sqft"
)

// VendorProduct represents an item in the product catalog linked to a vendor
type VendorProduct struct {
	ID           primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	ProductID    string             `bson:"product_id" json:"product_id"` // e.g. PRD-001
	VendorID     primitive.ObjectID `bson:"vendor_id" json:"vendor_id"`
	Name         string             `bson:"name" json:"name"`
	Category     string             `bson:"category" json:"category"` // e.g. "Plywood", "Tiles"
	Unit         string             `bson:"unit" json:"unit"`         // e.g. "sqft", "pcs", "kg"
	CostType     CostType           `bson:"cost_type" json:"cost_type"`
	BasePrice    float64            `bson:"base_price" json:"base_price"`       // vendor's actual cost (internal)
	SellingPrice float64            `bson:"selling_price" json:"selling_price"` // client-facing price
	Status       string             `bson:"status" json:"status"`
	CreatedBy    primitive.ObjectID `bson:"created_by" json:"created_by"`
	CreatedAt    time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt    time.Time          `bson:"updated_at" json:"updated_at"`
}
