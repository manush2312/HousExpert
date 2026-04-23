package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// QuotationStatus represents the lifecycle state of a quotation.
type QuotationStatus string

const (
	QuotationDraft    QuotationStatus = "draft"
	QuotationSent     QuotationStatus = "sent"
	QuotationAccepted QuotationStatus = "accepted"
	QuotationRejected QuotationStatus = "rejected"
	QuotationExpired  QuotationStatus = "expired"
)

// QuotationItem is a single line in a quotation section.
type QuotationItem struct {
	ItemID      primitive.ObjectID `bson:"item_id" json:"item_id"`
	ProductID   string             `bson:"product_id,omitempty" json:"product_id,omitempty"` // optional link to catalog
	Description string             `bson:"description" json:"description"`
	Size        string             `bson:"size,omitempty" json:"size,omitempty"`   // e.g. "6x6.5"
	Sqft        *float64           `bson:"sqft,omitempty" json:"sqft,omitempty"`   // nullable
	Qty         float64            `bson:"qty" json:"qty"`                          // default 1
	Rate        float64            `bson:"rate" json:"rate"`
	Amount      float64            `bson:"amount" json:"amount"`                    // qty * rate
	Note        string             `bson:"note,omitempty" json:"note,omitempty"`
}

// QuotationSection groups line items under a room/area label (e.g. "Bedroom", "Kitchen").
type QuotationSection struct {
	SectionID string          `bson:"section_id" json:"section_id"`
	RoomName  string          `bson:"room_name" json:"room_name"`
	Items     []QuotationItem `bson:"items" json:"items"`
}

// Quotation represents a price estimate prepared for a client.
type Quotation struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	QuotationID string             `bson:"quotation_id" json:"quotation_id"` // QT-001

	// Client info
	ClientName     string `bson:"client_name" json:"client_name"`
	ClientPhone    string `bson:"client_phone,omitempty" json:"client_phone,omitempty"`
	ClientLocation string `bson:"client_location,omitempty" json:"client_location,omitempty"`

	// Line items grouped by room/area
	Sections []QuotationSection `bson:"sections" json:"sections"`

	// Financials
	TotalAmount float64 `bson:"total_amount" json:"total_amount"` // sum of all item amounts

	// Meta
	Status             QuotationStatus `bson:"status" json:"status"`
	ConvertedProjectID string          `bson:"converted_project_id,omitempty" json:"converted_project_id,omitempty"`
	Notes              string          `bson:"notes,omitempty" json:"notes,omitempty"`

	CreatedAt time.Time `bson:"created_at" json:"created_at"`
	UpdatedAt time.Time `bson:"updated_at" json:"updated_at"`
}
