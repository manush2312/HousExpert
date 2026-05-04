package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type InventoryItem struct {
	ID                     primitive.ObjectID       `bson:"_id,omitempty" json:"id"`
	ItemID                 string                   `bson:"item_id" json:"item_id"`
	SKU                    string                   `bson:"sku,omitempty" json:"sku,omitempty"`
	Name                   string                   `bson:"name" json:"name"`
	Category               string                   `bson:"category,omitempty" json:"category,omitempty"`
	Unit                   string                   `bson:"unit" json:"unit"`
	UsageUnit              string                   `bson:"usage_unit,omitempty" json:"usage_unit,omitempty"`
	UsageUnitsPerStockUnit float64                  `bson:"usage_units_per_stock_unit,omitempty" json:"usage_units_per_stock_unit,omitempty"`
	Supplier               string                   `bson:"supplier,omitempty" json:"supplier,omitempty"`
	Location               string                   `bson:"location,omitempty" json:"location,omitempty"`
	MinStockLevel          float64                  `bson:"min_stock_level" json:"min_stock_level"`
	CurrentStock           float64                  `bson:"current_stock" json:"current_stock"`
	LastPurchaseCost       float64                  `bson:"last_purchase_cost,omitempty" json:"last_purchase_cost,omitempty"`
	VendorPricing          []InventoryVendorPricing `bson:"vendor_pricing,omitempty" json:"vendor_pricing,omitempty"`
	Notes                  string                   `bson:"notes,omitempty" json:"notes,omitempty"`
	CreatedAt              time.Time                `bson:"created_at" json:"created_at"`
	UpdatedAt              time.Time                `bson:"updated_at" json:"updated_at"`
}

type InventoryVendorPricing struct {
	SupplierName      string  `bson:"supplier_name" json:"supplier_name"`
	DefaultBuyPrice   float64 `bson:"default_buy_price,omitempty" json:"default_buy_price,omitempty"`
	DefaultSellPrice  float64 `bson:"default_sell_price,omitempty" json:"default_sell_price,omitempty"`
	LeadTimeDays      int     `bson:"lead_time_days,omitempty" json:"lead_time_days,omitempty"`
	PreferredSupplier bool    `bson:"preferred_supplier,omitempty" json:"preferred_supplier,omitempty"`
	Notes             string  `bson:"notes,omitempty" json:"notes,omitempty"`
}

type InventoryMovementType string

const (
	InventoryMovementIn         InventoryMovementType = "in"
	InventoryMovementOut        InventoryMovementType = "out"
	InventoryMovementAdjustment InventoryMovementType = "adjustment"
)

type InventoryMovement struct {
	ID              primitive.ObjectID    `bson:"_id,omitempty" json:"id"`
	MovementID      string                `bson:"movement_id" json:"movement_id"`
	ItemID          string                `bson:"item_id" json:"item_id"`
	ItemName        string                `bson:"item_name" json:"item_name"`
	ItemUnit        string                `bson:"item_unit" json:"item_unit"`
	LotID           string                `bson:"lot_id,omitempty" json:"lot_id,omitempty"`
	LotLabel        string                `bson:"lot_label,omitempty" json:"lot_label,omitempty"`
	SupplierBucket  string                `bson:"supplier_bucket,omitempty" json:"supplier_bucket,omitempty"`
	Type            InventoryMovementType `bson:"type" json:"type"`
	Reason          string                `bson:"reason,omitempty" json:"reason,omitempty"`
	Quantity        float64               `bson:"quantity" json:"quantity"`
	UnitCost        float64               `bson:"unit_cost,omitempty" json:"unit_cost,omitempty"`
	TotalAmount     float64               `bson:"total_amount,omitempty" json:"total_amount,omitempty"`
	BalanceAfter    float64               `bson:"balance_after" json:"balance_after"`
	Party           string                `bson:"party,omitempty" json:"party,omitempty"`
	DocumentNumber  string                `bson:"document_number,omitempty" json:"document_number,omitempty"`
	Reference       string                `bson:"reference,omitempty" json:"reference,omitempty"`
	Notes           string                `bson:"notes,omitempty" json:"notes,omitempty"`
	TransactionDate time.Time             `bson:"transaction_date" json:"transaction_date"`
	CreatedAt       time.Time             `bson:"created_at" json:"created_at"`
}

type InventoryStockLot struct {
	ID                primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	LotID             string             `bson:"lot_id" json:"lot_id"`
	ItemID            string             `bson:"item_id" json:"item_id"`
	ItemName          string             `bson:"item_name" json:"item_name"`
	ItemUnit          string             `bson:"item_unit" json:"item_unit"`
	SupplierBucket    string             `bson:"supplier_bucket,omitempty" json:"supplier_bucket,omitempty"`
	ReceivedQuantity  float64            `bson:"received_quantity" json:"received_quantity"`
	RemainingQuantity float64            `bson:"remaining_quantity" json:"remaining_quantity"`
	UnitCost          float64            `bson:"unit_cost,omitempty" json:"unit_cost,omitempty"`
	ReceivedDate      time.Time          `bson:"received_date" json:"received_date"`
	DocumentNumber    string             `bson:"document_number,omitempty" json:"document_number,omitempty"`
	Reference         string             `bson:"reference,omitempty" json:"reference,omitempty"`
	Notes             string             `bson:"notes,omitempty" json:"notes,omitempty"`
	CreatedAt         time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt         time.Time          `bson:"updated_at" json:"updated_at"`
}

type InventorySupplierStock struct {
	ItemID         string  `json:"item_id"`
	ItemName       string  `json:"item_name"`
	ItemUnit       string  `json:"item_unit"`
	SupplierBucket string  `json:"supplier_bucket"`
	AvailableQty   float64 `json:"available_qty"`
	UnitCost       float64 `json:"unit_cost,omitempty"`
}

type InventoryStockLotView struct {
	LotID             string    `json:"lot_id"`
	ItemID            string    `json:"item_id"`
	ItemName          string    `json:"item_name"`
	ItemUnit          string    `json:"item_unit"`
	SupplierBucket    string    `json:"supplier_bucket"`
	ReceivedQuantity  float64   `json:"received_quantity"`
	RemainingQuantity float64   `json:"remaining_quantity"`
	UnitCost          float64   `json:"unit_cost,omitempty"`
	DefaultSellPrice  float64   `json:"default_sell_price,omitempty"`
	ReceivedDate      time.Time `json:"received_date"`
	DocumentNumber    string    `json:"document_number,omitempty"`
	Reference         string    `json:"reference,omitempty"`
	Notes             string    `json:"notes,omitempty"`
	Label             string    `json:"label"`
}
