package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

type InventoryItem struct {
	ID                     primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	ItemID                 string             `bson:"item_id" json:"item_id"`
	SKU                    string             `bson:"sku,omitempty" json:"sku,omitempty"`
	Name                   string             `bson:"name" json:"name"`
	Category               string             `bson:"category,omitempty" json:"category,omitempty"`
	Unit                   string             `bson:"unit" json:"unit"`
	UsageUnit              string             `bson:"usage_unit,omitempty" json:"usage_unit,omitempty"`
	UsageUnitsPerStockUnit float64            `bson:"usage_units_per_stock_unit,omitempty" json:"usage_units_per_stock_unit,omitempty"`
	Supplier               string             `bson:"supplier,omitempty" json:"supplier,omitempty"`
	Location               string             `bson:"location,omitempty" json:"location,omitempty"`
	MinStockLevel          float64            `bson:"min_stock_level" json:"min_stock_level"`
	CurrentStock           float64            `bson:"current_stock" json:"current_stock"`
	LastPurchaseCost       float64            `bson:"last_purchase_cost,omitempty" json:"last_purchase_cost,omitempty"`
	Notes                  string             `bson:"notes,omitempty" json:"notes,omitempty"`
	CreatedAt              time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt              time.Time          `bson:"updated_at" json:"updated_at"`
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
