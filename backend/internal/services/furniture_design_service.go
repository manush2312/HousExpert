package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"housexpert/backend/internal/database"
	"housexpert/backend/internal/models"
	"housexpert/backend/internal/utils"
)

const (
	defaultFurnitureDesignName    = "Untitled Design"
	defaultFurnitureMaterialColor = "#c8a96e"
	defaultFurnitureThickness     = 18
	defaultFurnitureBackPanel     = 6
)

// ── Input types ──────────────────────────────────────────────────────────────

type CreateFurnitureDesignInput struct {
	Name            string                                   `json:"name"`
	FurnitureType   models.FurnitureType                     `json:"furniture_type"`
	OuterBox        *models.FurnitureOuterBox                `json:"outer_box"`
	Material        models.FurnitureMaterial                 `json:"material"`
	Shelves         []models.FurnitureShelf                  `json:"shelves"`
	Partitions      []models.FurniturePartition              `json:"partitions"`
	Drawers         []models.FurnitureDrawer                 `json:"drawers"`
	CustomPanels    []models.FurnitureCustomPanel            `json:"custom_panels"`
	ShelfPartitions []models.FurnitureShelfPartition         `json:"shelf_partitions"`
	SectionConfigs  map[string]models.FurnitureSectionConfig `json:"section_configs"`
}

type UpdateFurnitureDesignInput struct {
	Name            *string                                  `json:"name"`
	FurnitureType   *models.FurnitureType                    `json:"furniture_type"`
	OuterBox        *models.FurnitureOuterBox                `json:"outer_box"`
	Material        *models.FurnitureMaterial                `json:"material"`
	Shelves         []models.FurnitureShelf                  `json:"shelves"`
	Partitions      []models.FurniturePartition              `json:"partitions"`
	Drawers         []models.FurnitureDrawer                 `json:"drawers"`
	CustomPanels    []models.FurnitureCustomPanel            `json:"custom_panels"`
	ShelfPartitions []models.FurnitureShelfPartition         `json:"shelf_partitions"`
	SectionConfigs  map[string]models.FurnitureSectionConfig `json:"section_configs"`
}

type FurnitureDesignListFilter struct {
	FurnitureType string
	Page          int64
	Limit         int64
}

type FurnitureDesignListResult struct {
	Designs []models.FurnitureDesign `json:"designs"`
	Total   int64                    `json:"total"`
	Page    int64                    `json:"page"`
	Limit   int64                    `json:"limit"`
}

// ── Collection helper ─────────────────────────────────────────────────────────

func furnitureDesignCol() *mongo.Collection {
	return database.Collection("furniture_designs")
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func normalizeFurnitureDesignName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return defaultFurnitureDesignName
	}
	return name
}

func normalizeFurnitureType(value models.FurnitureType) (models.FurnitureType, error) {
	if value == "" {
		return models.FurnitureWardrobe, nil
	}
	switch value {
	case models.FurnitureWardrobe,
		models.FurnitureCabinet,
		models.FurnitureTVUnit,
		models.FurnitureBookshelf,
		models.FurnitureKitchenBase:
		return value, nil
	default:
		return "", fmt.Errorf("invalid furniture_type: %s", value)
	}
}

func normalizeFurnitureMaterial(material models.FurnitureMaterial) models.FurnitureMaterial {
	if material.Thickness <= 0 {
		material.Thickness = defaultFurnitureThickness
	}
	if material.BackPanelThickness <= 0 {
		material.BackPanelThickness = defaultFurnitureBackPanel
	}
	if strings.TrimSpace(material.Color) == "" {
		material.Color = defaultFurnitureMaterialColor
	}
	return material
}

func validateFurnitureOuterBox(box *models.FurnitureOuterBox) error {
	if box == nil {
		return nil
	}
	if box.Width <= 0 || box.Height <= 0 || box.Depth <= 0 {
		return fmt.Errorf("outer box dimensions must be greater than 0")
	}
	return nil
}

func normalizeFurnitureDoorType(value models.FurnitureDoorType) models.FurnitureDoorType {
	switch value {
	case models.FurnitureDoorSingle, models.FurnitureDoorDouble:
		return value
	default:
		return models.FurnitureDoorNone
	}
}

func normalizeFurnitureSectionConfigs(configs map[string]models.FurnitureSectionConfig) map[string]models.FurnitureSectionConfig {
	if configs == nil {
		return map[string]models.FurnitureSectionConfig{}
	}
	normalized := make(map[string]models.FurnitureSectionConfig, len(configs))
	for key, cfg := range configs {
		normalized[key] = models.FurnitureSectionConfig{
			Door:        normalizeFurnitureDoorType(cfg.Door),
			HangingRail: cfg.HangingRail,
		}
	}
	return normalized
}

func normalizeFurnitureElements(
	shelves []models.FurnitureShelf,
	partitions []models.FurniturePartition,
	drawers []models.FurnitureDrawer,
	customPanels []models.FurnitureCustomPanel,
	shelfPartitions []models.FurnitureShelfPartition,
) (
	[]models.FurnitureShelf,
	[]models.FurniturePartition,
	[]models.FurnitureDrawer,
	[]models.FurnitureCustomPanel,
	[]models.FurnitureShelfPartition,
) {
	if shelves == nil {
		shelves = []models.FurnitureShelf{}
	}
	if partitions == nil {
		partitions = []models.FurniturePartition{}
	}
	if drawers == nil {
		drawers = []models.FurnitureDrawer{}
	}
	if customPanels == nil {
		customPanels = []models.FurnitureCustomPanel{}
	}
	if shelfPartitions == nil {
		shelfPartitions = []models.FurnitureShelfPartition{}
	}
	return shelves, partitions, drawers, customPanels, shelfPartitions
}

// ── Service functions ─────────────────────────────────────────────────────────

// CreateFurnitureDesign inserts a saved furniture design and assigns a FUR-XXX ID.
func CreateFurnitureDesign(input CreateFurnitureDesignInput) (*models.FurnitureDesign, error) {
	designID, err := utils.NextID("furniture_design")
	if err != nil {
		return nil, fmt.Errorf("id generation failed: %w", err)
	}
	if err := validateFurnitureOuterBox(input.OuterBox); err != nil {
		return nil, err
	}
	furnitureType, err := normalizeFurnitureType(input.FurnitureType)
	if err != nil {
		return nil, err
	}
	shelves, partitions, drawers, customPanels, shelfPartitions := normalizeFurnitureElements(
		input.Shelves,
		input.Partitions,
		input.Drawers,
		input.CustomPanels,
		input.ShelfPartitions,
	)

	now := time.Now()
	design := &models.FurnitureDesign{
		DesignID:        designID,
		Name:            normalizeFurnitureDesignName(input.Name),
		FurnitureType:   furnitureType,
		OuterBox:        input.OuterBox,
		Material:        normalizeFurnitureMaterial(input.Material),
		Shelves:         shelves,
		Partitions:      partitions,
		Drawers:         drawers,
		CustomPanels:    customPanels,
		ShelfPartitions: shelfPartitions,
		SectionConfigs:  normalizeFurnitureSectionConfigs(input.SectionConfigs),
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	if _, err = furnitureDesignCol().InsertOne(context.Background(), design); err != nil {
		return nil, fmt.Errorf("insert failed: %w", err)
	}
	return design, nil
}

// ListFurnitureDesigns returns a paginated list of saved furniture designs.
func ListFurnitureDesigns(f FurnitureDesignListFilter) (*FurnitureDesignListResult, error) {
	if f.Page < 1 {
		f.Page = 1
	}
	if f.Limit < 1 || f.Limit > 100 {
		f.Limit = 20
	}

	query := bson.M{}
	if f.FurnitureType != "" {
		furnitureType, err := normalizeFurnitureType(models.FurnitureType(f.FurnitureType))
		if err != nil {
			return nil, err
		}
		query["furniture_type"] = furnitureType
	}

	ctx := context.Background()
	total, err := furnitureDesignCol().CountDocuments(ctx, query)
	if err != nil {
		return nil, err
	}

	skip := (f.Page - 1) * f.Limit
	cursor, err := furnitureDesignCol().Find(ctx, query, &options.FindOptions{
		Skip:  &skip,
		Limit: &f.Limit,
		Sort:  bson.D{{Key: "updated_at", Value: -1}},
	})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var designs []models.FurnitureDesign
	if err := cursor.All(ctx, &designs); err != nil {
		return nil, err
	}
	if designs == nil {
		designs = []models.FurnitureDesign{}
	}

	return &FurnitureDesignListResult{
		Designs: designs,
		Total:   total,
		Page:    f.Page,
		Limit:   f.Limit,
	}, nil
}

// GetFurnitureDesign fetches a saved design by its human-readable ID.
func GetFurnitureDesign(designID string) (*models.FurnitureDesign, error) {
	var design models.FurnitureDesign
	err := furnitureDesignCol().FindOne(context.Background(), bson.M{"design_id": designID}).Decode(&design)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &design, err
}

// UpdateFurnitureDesign updates a saved furniture design.
func UpdateFurnitureDesign(designID string, input UpdateFurnitureDesignInput) (*models.FurnitureDesign, error) {
	set := bson.M{"updated_at": time.Now()}

	if input.Name != nil {
		set["name"] = normalizeFurnitureDesignName(*input.Name)
	}
	if input.FurnitureType != nil {
		furnitureType, err := normalizeFurnitureType(*input.FurnitureType)
		if err != nil {
			return nil, err
		}
		set["furniture_type"] = furnitureType
	}
	if input.OuterBox != nil {
		if err := validateFurnitureOuterBox(input.OuterBox); err != nil {
			return nil, err
		}
		set["outer_box"] = input.OuterBox
	}
	if input.Material != nil {
		set["material"] = normalizeFurnitureMaterial(*input.Material)
	}
	if input.Shelves != nil {
		set["shelves"] = input.Shelves
	}
	if input.Partitions != nil {
		set["partitions"] = input.Partitions
	}
	if input.Drawers != nil {
		set["drawers"] = input.Drawers
	}
	if input.CustomPanels != nil {
		set["custom_panels"] = input.CustomPanels
	}
	if input.ShelfPartitions != nil {
		set["shelf_partitions"] = input.ShelfPartitions
	}
	if input.SectionConfigs != nil {
		set["section_configs"] = normalizeFurnitureSectionConfigs(input.SectionConfigs)
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var design models.FurnitureDesign
	err := furnitureDesignCol().FindOneAndUpdate(
		context.Background(),
		bson.M{"design_id": designID},
		bson.M{"$set": set},
		opts,
	).Decode(&design)

	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &design, err
}

// DeleteFurnitureDesign permanently removes a saved furniture design.
func DeleteFurnitureDesign(designID string) error {
	res, err := furnitureDesignCol().DeleteOne(context.Background(), bson.M{"design_id": designID})
	if err != nil {
		return err
	}
	if res.DeletedCount == 0 {
		return fmt.Errorf("furniture design not found")
	}
	return nil
}
