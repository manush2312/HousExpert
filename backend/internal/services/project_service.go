package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"housexpert/backend/internal/database"
	"housexpert/backend/internal/models"
	"housexpert/backend/internal/utils"
)

// ── Input types ──────────────────────────────────────────────────────────────

type CreateProjectInput struct {
	Name       string                `json:"name"        binding:"required"`
	Address    models.ProjectAddress `json:"address"     binding:"required"`
	BHKConfigs []models.BHKConfig    `json:"bhk_configs"`
	CreatedBy  primitive.ObjectID    `json:"created_by"`

	// Optional at creation
	Lead        string     `json:"lead"`
	ClientName  string     `json:"client_name"`
	ClientPhone string     `json:"client_phone"`
	StartedAt   *time.Time `json:"started_at"`
	TargetAt    *time.Time `json:"target_at"`
	Units       int        `json:"units"`
	Floors      int        `json:"floors"`
	Budget      float64    `json:"budget"`
	Spent       float64    `json:"spent"`
	Progress    float64    `json:"progress"`
}

type UpdateProjectInput struct {
	Name    *string                `json:"name"`
	Address *models.ProjectAddress `json:"address"`

	Lead        *string    `json:"lead"`
	ClientName  *string    `json:"client_name"`
	ClientPhone *string    `json:"client_phone"`
	StartedAt   *time.Time `json:"started_at"`
	TargetAt    *time.Time `json:"target_at"`
	Units       *int       `json:"units"`
	Floors      *int       `json:"floors"`
	Budget      *float64   `json:"budget"`
	Spent       *float64   `json:"spent"`
	Progress    *float64   `json:"progress"`
}

type ProjectListFilter struct {
	Status          string
	City            string
	IncludeArchived bool
	Page            int64
	Limit           int64
}

type ProjectListResult struct {
	Projects []models.Project `json:"projects"`
	Total    int64            `json:"total"`
	Page     int64            `json:"page"`
	Limit    int64            `json:"limit"`
}

type AddFloorPlanInput struct {
	Label       string             `json:"label"        binding:"required"`
	FileURL     string             `json:"file_url"     binding:"required"`
	FileType    string             `json:"file_type"    binding:"required"` // "pdf" or "image"
	UploadedBy  primitive.ObjectID `json:"uploaded_by"`
}

// ── Collection helper ─────────────────────────────────────────────────────────

func projectCol() *mongo.Collection {
	return database.Collection("projects")
}

// ── Service functions ─────────────────────────────────────────────────────────

// CreateProject creates a new project and assigns a PROJ-XXX ID.
func CreateProject(input CreateProjectInput) (*models.Project, error) {
	projectID, err := utils.NextID("project")
	if err != nil {
		return nil, fmt.Errorf("id generation failed: %w", err)
	}

	now := time.Now()
	project := &models.Project{
		ID:         primitive.NewObjectID(),
		ProjectID:  projectID,
		Name:       input.Name,
		Address:    input.Address,
		BHKConfigs: input.BHKConfigs,
		Status:     models.ProjectActive,
		Lead:        input.Lead,
		ClientName:  input.ClientName,
		ClientPhone: input.ClientPhone,
		StartedAt:   input.StartedAt,
		TargetAt:    input.TargetAt,
		Units:       input.Units,
		Floors:      input.Floors,
		Budget:      input.Budget,
		Spent:       input.Spent,
		Progress:    input.Progress,
		CreatedBy:   input.CreatedBy,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if project.BHKConfigs == nil {
		project.BHKConfigs = []models.BHKConfig{}
	}

	if _, err = projectCol().InsertOne(context.Background(), project); err != nil {
		return nil, fmt.Errorf("insert failed: %w", err)
	}
	return project, nil
}

// ListProjects returns a paginated list of projects with optional filters.
func ListProjects(f ProjectListFilter) (*ProjectListResult, error) {
	if f.Page < 1 {
		f.Page = 1
	}
	if f.Limit < 1 || f.Limit > 100 {
		f.Limit = 20
	}

	query := bson.M{}
	if !f.IncludeArchived {
		query["status"] = bson.M{"$ne": models.ProjectArchived}
	}
	if f.Status != "" {
		query["status"] = f.Status
	}
	if f.City != "" {
		query["address.city"] = f.City
	}

	ctx := context.Background()

	total, err := projectCol().CountDocuments(ctx, query)
	if err != nil {
		return nil, err
	}

	skip := (f.Page - 1) * f.Limit
	cursor, err := projectCol().Find(ctx, query, &options.FindOptions{
		Skip:  &skip,
		Limit: &f.Limit,
		Sort:  bson.D{{Key: "created_at", Value: -1}},
	})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var projects []models.Project
	if err := cursor.All(ctx, &projects); err != nil {
		return nil, err
	}
	if projects == nil {
		projects = []models.Project{}
	}

	return &ProjectListResult{
		Projects: projects,
		Total:    total,
		Page:     f.Page,
		Limit:    f.Limit,
	}, nil
}

// GetProject fetches a project by its human-readable project_id (e.g. "PROJ-001").
// Returns nil, nil when not found.
func GetProject(projectID string) (*models.Project, error) {
	var project models.Project
	err := projectCol().FindOne(context.Background(), bson.M{"project_id": projectID}).Decode(&project)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &project, err
}

// UpdateProject updates the name and/or address of a project.
// Returns nil, nil when project not found or already archived.
func UpdateProject(projectID string, input UpdateProjectInput) (*models.Project, error) {
	set := bson.M{"updated_at": time.Now()}
	if input.Name != nil {
		set["name"] = *input.Name
	}
	if input.Address != nil {
		set["address"] = *input.Address
	}
	if input.Lead != nil {
		set["lead"] = *input.Lead
	}
	if input.ClientName != nil {
		set["client_name"] = *input.ClientName
	}
	if input.ClientPhone != nil {
		set["client_phone"] = *input.ClientPhone
	}
	if input.StartedAt != nil {
		set["started_at"] = *input.StartedAt
	}
	if input.TargetAt != nil {
		set["target_at"] = *input.TargetAt
	}
	if input.Units != nil {
		set["units"] = *input.Units
	}
	if input.Floors != nil {
		set["floors"] = *input.Floors
	}
	if input.Budget != nil {
		set["budget"] = *input.Budget
	}
	if input.Spent != nil {
		set["spent"] = *input.Spent
	}
	if input.Progress != nil {
		set["progress"] = *input.Progress
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var project models.Project
	err := projectCol().FindOneAndUpdate(
		context.Background(),
		bson.M{"project_id": projectID, "status": bson.M{"$ne": models.ProjectArchived}},
		bson.M{"$set": set},
		opts,
	).Decode(&project)

	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &project, err
}

// ArchiveProject soft-deletes a project by setting its status to "archived".
func ArchiveProject(projectID string) error {
	res, err := projectCol().UpdateOne(
		context.Background(),
		bson.M{"project_id": projectID},
		bson.M{"$set": bson.M{"status": models.ProjectArchived, "updated_at": time.Now()}},
	)
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return fmt.Errorf("project not found")
	}
	return nil
}

// RestoreProject brings an archived project back to active status.
func RestoreProject(projectID string) error {
	res, err := projectCol().UpdateOne(
		context.Background(),
		bson.M{"project_id": projectID, "status": models.ProjectArchived},
		bson.M{"$set": bson.M{"status": models.ProjectActive, "updated_at": time.Now()}},
	)
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return fmt.Errorf("project not found")
	}
	return nil
}

// AddFloorPlan adds a floor plan to a BHK config within a project.
// If the BHK type does not exist yet in bhk_configs it is created automatically.
func AddFloorPlan(projectID string, bhkType models.BHKType, input AddFloorPlanInput) (*models.Project, error) {
	plan := models.FloorPlan{
		PlanID:     primitive.NewObjectID(),
		Label:      input.Label,
		FileURL:    input.FileURL,
		FileType:   input.FileType,
		UploadedBy: input.UploadedBy,
		UploadedAt: time.Now(),
	}

	ctx := context.Background()

	// Check whether this BHK type already exists so we know which update path to use.
	var existing models.Project
	err := projectCol().FindOne(ctx, bson.M{"project_id": projectID}).Decode(&existing)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	bhkExists := false
	for _, cfg := range existing.BHKConfigs {
		if cfg.BHKType == bhkType {
			bhkExists = true
			break
		}
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var updated models.Project

	if bhkExists {
		// Push the floor plan into the matching BHK config's floor_plans array.
		err = projectCol().FindOneAndUpdate(ctx,
			bson.M{"project_id": projectID, "bhk_configs.bhk_type": string(bhkType)},
			bson.M{
				"$push": bson.M{"bhk_configs.$.floor_plans": plan},
				"$set":  bson.M{"updated_at": time.Now()},
			},
			opts,
		).Decode(&updated)
	} else {
		// The BHK type doesn't exist yet — add a new BHKConfig with this floor plan.
		newConfig := models.BHKConfig{
			BHKType:    bhkType,
			FloorPlans: []models.FloorPlan{plan},
		}
		err = projectCol().FindOneAndUpdate(ctx,
			bson.M{"project_id": projectID},
			bson.M{
				"$push": bson.M{"bhk_configs": newConfig},
				"$set":  bson.M{"updated_at": time.Now()},
			},
			opts,
		).Decode(&updated)
	}

	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &updated, err
}

// RemoveFloorPlan removes a specific floor plan from a BHK config.
func RemoveFloorPlan(projectID string, bhkType models.BHKType, planID primitive.ObjectID) (*models.Project, error) {
	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var project models.Project

	err := projectCol().FindOneAndUpdate(
		context.Background(),
		bson.M{"project_id": projectID, "bhk_configs.bhk_type": string(bhkType)},
		bson.M{
			"$pull": bson.M{"bhk_configs.$.floor_plans": bson.M{"plan_id": planID}},
			"$set":  bson.M{"updated_at": time.Now()},
		},
		opts,
	).Decode(&project)

	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &project, err
}

// GetUploadURL generates a presigned S3/R2 PUT URL for a floor plan file.
// Returns (uploadURL, publicURL, error).
// The frontend PUTs the file to uploadURL, then calls AddFloorPlan with publicURL.
func GetUploadURL(projectID, bhkType, filename, contentType string) (string, string, error) {
	key := fmt.Sprintf("projects/%s/floor-plans/%s/%d-%s", projectID, bhkType, time.Now().UnixMilli(), filename)
	uploadURL, err := utils.PresignUpload(key, contentType, 15)
	if err != nil {
		return "", "", err
	}
	return uploadURL, utils.PublicURL(key), nil
}
