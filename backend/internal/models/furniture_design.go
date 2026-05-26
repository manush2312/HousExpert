package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// FurnitureType identifies the broad template/category for a saved design.
type FurnitureType string

const (
	FurnitureWardrobe    FurnitureType = "wardrobe"
	FurnitureCabinet     FurnitureType = "cabinet"
	FurnitureTVUnit      FurnitureType = "tv_unit"
	FurnitureBookshelf   FurnitureType = "bookshelf"
	FurnitureKitchenBase FurnitureType = "kitchen_base"
)

// FurnitureDoorType identifies the door style configured for a section.
type FurnitureDoorType string

const (
	FurnitureDoorNone   FurnitureDoorType = "none"
	FurnitureDoorSingle FurnitureDoorType = "single"
	FurnitureDoorDouble FurnitureDoorType = "double"
)

// FurnitureOuterBox stores the main carcass dimensions in millimetres.
type FurnitureOuterBox struct {
	Width  float64 `bson:"width" json:"width"`
	Height float64 `bson:"height" json:"height"`
	Depth  float64 `bson:"depth" json:"depth"`
}

// FurnitureMaterial stores the board/sheet settings used by the designer.
type FurnitureMaterial struct {
	Thickness          float64 `bson:"thickness" json:"thickness"`
	BackPanelThickness float64 `bson:"back_panel_thickness" json:"back_panel_thickness"`
	Color              string  `bson:"color" json:"color"`
}

// FurnitureShelf is a horizontal shelf placed inside one section.
type FurnitureShelf struct {
	ElementID    string  `bson:"element_id" json:"element_id"`
	FromBottom   float64 `bson:"from_bottom" json:"from_bottom"`
	SectionIndex int     `bson:"section_index" json:"section_index"`
}

// FurniturePartition is a full-height vertical divider.
type FurniturePartition struct {
	ElementID string  `bson:"element_id" json:"element_id"`
	FromLeft  float64 `bson:"from_left" json:"from_left"`
}

// FurnitureShelfPartition is a vertical divider spanning between shelves.
type FurnitureShelfPartition struct {
	ElementID    string  `bson:"element_id" json:"element_id"`
	SectionIndex int     `bson:"section_index" json:"section_index"`
	FromLeft     float64 `bson:"from_left" json:"from_left"`
	FromBottom   float64 `bson:"from_bottom" json:"from_bottom"`
	ToBottom     float64 `bson:"to_bottom" json:"to_bottom"`
}

// FurnitureDrawer stores drawer placement and depth/front settings.
type FurnitureDrawer struct {
	ElementID    string  `bson:"element_id" json:"element_id"`
	SectionIndex int     `bson:"section_index" json:"section_index"`
	FromBottom   float64 `bson:"from_bottom" json:"from_bottom"`
	Height       float64 `bson:"height" json:"height"`
	FrontSetback float64 `bson:"front_setback" json:"front_setback"`
}

// FurnitureCustomPanel stores free-form panels such as toe kicks, cornices or rails.
type FurnitureCustomPanel struct {
	ElementID  string  `bson:"element_id" json:"element_id"`
	Name       string  `bson:"name" json:"name"`
	FromLeft   float64 `bson:"from_left" json:"from_left"`
	FromBottom float64 `bson:"from_bottom" json:"from_bottom"`
	Width      float64 `bson:"width" json:"width"`
	Height     float64 `bson:"height" json:"height"`
	Thickness  float64 `bson:"thickness" json:"thickness"`
}

// FurnitureSectionConfig stores per-section finishing options.
type FurnitureSectionConfig struct {
	Door        FurnitureDoorType `bson:"door" json:"door"`
	HangingRail bool              `bson:"hanging_rail" json:"hanging_rail"`
}

// FurnitureDesign represents a saved furniture designer document.
type FurnitureDesign struct {
	ID              primitive.ObjectID                `bson:"_id,omitempty" json:"id"`
	DesignID        string                            `bson:"design_id" json:"design_id"` // FUR-001
	Name            string                            `bson:"name" json:"name"`
	FurnitureType   FurnitureType                     `bson:"furniture_type" json:"furniture_type"`
	OuterBox        *FurnitureOuterBox                `bson:"outer_box,omitempty" json:"outer_box,omitempty"`
	Material        FurnitureMaterial                 `bson:"material" json:"material"`
	Shelves         []FurnitureShelf                  `bson:"shelves" json:"shelves"`
	Partitions      []FurniturePartition              `bson:"partitions" json:"partitions"`
	Drawers         []FurnitureDrawer                 `bson:"drawers" json:"drawers"`
	CustomPanels    []FurnitureCustomPanel            `bson:"custom_panels" json:"custom_panels"`
	ShelfPartitions []FurnitureShelfPartition         `bson:"shelf_partitions" json:"shelf_partitions"`
	SectionConfigs  map[string]FurnitureSectionConfig `bson:"section_configs" json:"section_configs"`
	CreatedAt       time.Time                         `bson:"created_at" json:"created_at"`
	UpdatedAt       time.Time                         `bson:"updated_at" json:"updated_at"`
}
