package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// InventoryCostRevision is the audit trail for a lot repriced when its supplier
// bill finally arrived. One document per confirmation, recording what the cost
// was, what it became, and which projects moved as a result — so a project's
// cost changing days after the fact is always explainable.
type InventoryCostRevision struct {
	ID         primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	RevisionID string             `bson:"revision_id" json:"revision_id"`
	LotID      string             `bson:"lot_id" json:"lot_id"`
	ItemID     string             `bson:"item_id" json:"item_id"`
	ItemName   string             `bson:"item_name" json:"item_name"`
	ItemUnit   string             `bson:"item_unit,omitempty" json:"item_unit,omitempty"`
	Supplier   string             `bson:"supplier_bucket,omitempty" json:"supplier_bucket,omitempty"`

	PreviousUnitCost float64 `bson:"previous_unit_cost" json:"previous_unit_cost"`
	NewUnitCost      float64 `bson:"new_unit_cost" json:"new_unit_cost"`
	UnitCostDelta    float64 `bson:"unit_cost_delta" json:"unit_cost_delta"`

	// ReceivedQuantity is the lot size; ConsumedQuantity is how much had already
	// been issued to projects at confirmation time. Their split explains how the
	// total delta divides between project cost and remaining stock value.
	ReceivedQuantity float64 `bson:"received_quantity" json:"received_quantity"`
	ConsumedQuantity float64 `bson:"consumed_quantity" json:"consumed_quantity"`
	ConsumedDelta    float64 `bson:"consumed_delta" json:"consumed_delta"`
	StockDelta       float64 `bson:"stock_delta" json:"stock_delta"`
	TotalDelta       float64 `bson:"total_delta" json:"total_delta"`

	InvoiceNumber string     `bson:"invoice_number,omitempty" json:"invoice_number,omitempty"`
	InvoiceDate   *time.Time `bson:"invoice_date,omitempty" json:"invoice_date,omitempty"`

	AffectedMovementIDs []string                     `bson:"affected_movement_ids,omitempty" json:"affected_movement_ids,omitempty"`
	AffectedProjects    []InventoryCostRevisionSplit `bson:"affected_projects,omitempty" json:"affected_projects,omitempty"`

	ConfirmedBy string    `bson:"confirmed_by,omitempty" json:"confirmed_by,omitempty"`
	CreatedAt   time.Time `bson:"created_at" json:"created_at"`
}

// InventoryCostRevisionSplit is one project's share of a repricing.
type InventoryCostRevisionSplit struct {
	ProjectID       string  `bson:"project_id,omitempty" json:"project_id,omitempty"`
	ProjectRef      string  `bson:"project_ref,omitempty" json:"project_ref,omitempty"`
	ProjectName     string  `bson:"project_name,omitempty" json:"project_name,omitempty"`
	Quantity        float64 `bson:"quantity" json:"quantity"`
	PreviousAmount  float64 `bson:"previous_amount" json:"previous_amount"`
	NewAmount       float64 `bson:"new_amount" json:"new_amount"`
	Delta           float64 `bson:"delta" json:"delta"`
	MovementIDCount int     `bson:"movement_id_count,omitempty" json:"movement_id_count,omitempty"`
}

// PendingBillRow is one line on the Pending Bills screen: a lot received
// without a price, plus where its stock has already gone.
type PendingBillRow struct {
	LotID             string    `json:"lot_id"`
	ItemID            string    `json:"item_id"`
	ItemName          string    `json:"item_name"`
	ItemUnit          string    `json:"item_unit"`
	SupplierBucket    string    `json:"supplier_bucket"`
	ReceivedQuantity  float64   `json:"received_quantity"`
	RemainingQuantity float64   `json:"remaining_quantity"`
	ConsumedQuantity  float64   `json:"consumed_quantity"`
	EstimatedUnitCost float64   `json:"estimated_unit_cost"`
	EstimatedValue    float64   `json:"estimated_value"`
	CostSource        string    `json:"cost_source,omitempty"`
	ReceivedDate      time.Time `json:"received_date"`
	DaysPending       int       `json:"days_pending"`
	DocumentNumber    string    `json:"document_number,omitempty"`
	Notes             string    `json:"notes,omitempty"`
	Label             string    `json:"label"`
	// SuggestedUnitCost is the best current guess for the real rate, recomputed
	// at read time from vendor pricing — useful when the estimate was taken
	// before the vendor's rate card was filled in.
	SuggestedUnitCost float64                      `json:"suggested_unit_cost,omitempty"`
	UsedInProjects    []InventoryCostRevisionSplit `json:"used_in_projects,omitempty"`
}

// PendingBillsSummary drives the nav badge and the project-level warning.
type PendingBillsSummary struct {
	PendingLots    int     `json:"pending_lots"`
	EstimatedValue float64 `json:"estimated_value"`
	OldestDays     int     `json:"oldest_days"`
}

// ProjectCostConfidence splits a project's material spend into the part backed
// by a supplier bill and the part still resting on an estimate.
type ProjectCostConfidence struct {
	ProjectID         string  `json:"project_id"`
	ConfirmedCost     float64 `json:"confirmed_cost"`
	ProvisionalCost   float64 `json:"provisional_cost"`
	TotalCost         float64 `json:"total_cost"`
	PendingLots       int     `json:"pending_lots"`
	PendingItemsLabel string  `json:"pending_items_label,omitempty"`
}
