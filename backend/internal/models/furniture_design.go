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

// FurnitureMaterialTextureRepeat stores texture tiling controls for 3D preview materials.
type FurnitureMaterialTextureRepeat struct {
	X float64 `bson:"x" json:"x"`
	Y float64 `bson:"y" json:"y"`
}

// FurnitureMaterialTextureImage stores an uploaded or remote texture preview image.
type FurnitureMaterialTextureImage struct {
	ID        string  `bson:"id" json:"id"`
	Name      string  `bson:"name" json:"name"`
	Source    string  `bson:"source" json:"source"`
	Src       string  `bson:"src" json:"src"`
	MimeType  string  `bson:"mime_type,omitempty" json:"mime_type,omitempty"`
	FileName  string  `bson:"file_name,omitempty" json:"file_name,omitempty"`
	SizeBytes int64   `bson:"size_bytes,omitempty" json:"size_bytes,omitempty"`
	Width     float64 `bson:"width,omitempty" json:"width,omitempty"`
	Height    float64 `bson:"height,omitempty" json:"height,omitempty"`
}

// FurnitureCustomMaterial stores user-defined 3D preview material data.
type FurnitureCustomMaterial struct {
	ID             string                         `bson:"id" json:"id"`
	Name           string                         `bson:"name" json:"name"`
	BaseColor      string                         `bson:"base_color" json:"base_color"`
	Finish         string                         `bson:"finish" json:"finish"`
	GrainDirection string                         `bson:"grain_direction" json:"grain_direction"`
	Texture        *FurnitureMaterialTextureImage `bson:"texture" json:"texture"`
	TextureScale   float64                        `bson:"texture_scale" json:"texture_scale"`
	TextureRepeat  FurnitureMaterialTextureRepeat `bson:"texture_repeat" json:"texture_repeat"`
	CreatedAt      string                         `bson:"created_at" json:"created_at"`
	UpdatedAt      string                         `bson:"updated_at" json:"updated_at"`
}

// FurniturePreviewMaterialAssignment stores the material applied to one 3D preview area.
type FurniturePreviewMaterialAssignment struct {
	MaterialSource           string  `bson:"material_source" json:"material_source"`
	SelectedMaterialID       string  `bson:"selected_material_id" json:"selected_material_id"`
	SelectedCustomMaterialID *string `bson:"selected_custom_material_id" json:"selected_custom_material_id"`
	CustomColor              string  `bson:"custom_color" json:"custom_color"`
}

// FurniturePreviewSettings stores non-structural 3D preview state with a design.
type FurniturePreviewSettings struct {
	ShowDoors                bool                                          `bson:"show_doors" json:"show_doors"`
	ExplodedView             bool                                          `bson:"exploded_view" json:"exploded_view"`
	ExplodedAmount           float64                                       `bson:"exploded_amount" json:"exploded_amount"`
	ShowDimensions           bool                                          `bson:"show_dimensions" json:"show_dimensions"`
	ActiveView               string                                        `bson:"active_view" json:"active_view"`
	MeasurementHorizontalRef string                                        `bson:"measurement_horizontal_reference,omitempty" json:"measurement_horizontal_reference,omitempty"`
	MeasurementVerticalRef   string                                        `bson:"measurement_vertical_reference,omitempty" json:"measurement_vertical_reference,omitempty"`
	MeasurementDepthRef      string                                        `bson:"measurement_depth_reference,omitempty" json:"measurement_depth_reference,omitempty"`
	MeasurementPanelRef      string                                        `bson:"measurement_panel_reference,omitempty" json:"measurement_panel_reference,omitempty"`
	BackgroundMode           string                                        `bson:"background_mode" json:"background_mode"`
	MaterialSource           string                                        `bson:"material_source" json:"material_source"`
	SelectedMaterialID       string                                        `bson:"selected_material_id" json:"selected_material_id"`
	SelectedCustomMaterialID *string                                       `bson:"selected_custom_material_id" json:"selected_custom_material_id"`
	CustomColor              string                                        `bson:"custom_color" json:"custom_color"`
	CustomMaterials          []FurnitureCustomMaterial                     `bson:"custom_materials" json:"custom_materials"`
	MaterialApplyTarget      string                                        `bson:"material_apply_target,omitempty" json:"material_apply_target,omitempty"`
	MaterialAssignments      map[string]FurniturePreviewMaterialAssignment `bson:"material_assignments,omitempty" json:"material_assignments,omitempty"`
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

// FurnitureFreehandPath stores freehand pencil annotations on the 2D drawing.
type FurnitureFreehandPath struct {
	ElementID   string    `bson:"element_id" json:"element_id"`
	Points      []float64 `bson:"points" json:"points"`
	Stroke      string    `bson:"stroke" json:"stroke"`
	StrokeWidth float64   `bson:"stroke_width" json:"stroke_width"`
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
	FreehandPaths   []FurnitureFreehandPath           `bson:"freehand_paths" json:"freehand_paths"`
	SectionConfigs  map[string]FurnitureSectionConfig `bson:"section_configs" json:"section_configs"`
	PreviewSettings *FurniturePreviewSettings         `bson:"preview_settings,omitempty" json:"preview_settings,omitempty"`
	CreatedAt       time.Time                         `bson:"created_at" json:"created_at"`
	UpdatedAt       time.Time                         `bson:"updated_at" json:"updated_at"`
}
