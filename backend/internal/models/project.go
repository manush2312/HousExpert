package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// BHKType represents valid BHK configurations
type BHKType string

const (
	BHK1     BHKType = "1BHK"
	BHK2     BHKType = "2BHK"
	BHK3     BHKType = "3BHK"
	BHK4     BHKType = "4BHK"
	BHK5     BHKType = "5BHK"
	Villa    BHKType = "Villa"
	Penthouse BHKType = "Penthouse"
)

// FloorPlan represents a floor plan file linked to a BHK config
type FloorPlan struct {
	PlanID     primitive.ObjectID `bson:"plan_id" json:"plan_id"`
	Label      string             `bson:"label" json:"label"`           // e.g. "Type A", "Type B"
	FileURL    string             `bson:"file_url" json:"file_url"`     // S3/R2 URL
	FileType   string             `bson:"file_type" json:"file_type"`   // "pdf" or "image"
	UploadedBy primitive.ObjectID `bson:"uploaded_by" json:"uploaded_by"`
	UploadedAt time.Time          `bson:"uploaded_at" json:"uploaded_at"`
}

// BHKConfig represents a BHK type with its associated floor plans
type BHKConfig struct {
	BHKType    BHKType     `bson:"bhk_type" json:"bhk_type"`
	FloorPlans []FloorPlan `bson:"floor_plans" json:"floor_plans"`
}

// ProjectAddress represents a structured address
type ProjectAddress struct {
	Line1   string `bson:"line1" json:"line1"`
	Line2   string `bson:"line2,omitempty" json:"line2,omitempty"`
	City    string `bson:"city" json:"city"`
	State   string `bson:"state" json:"state"`
	Pincode string `bson:"pincode" json:"pincode"`
}

// ProjectStatus represents the status of a project
type ProjectStatus string

const (
	ProjectActive   ProjectStatus = "active"
	ProjectInactive ProjectStatus = "inactive"
	ProjectArchived ProjectStatus = "archived"
)

// Project represents a construction/interior project
type Project struct {
	ID         primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	ProjectID  string             `bson:"project_id" json:"project_id"` // e.g. PROJ-001
	Name       string             `bson:"name" json:"name"`
	Address    ProjectAddress     `bson:"address" json:"address"`
	BHKConfigs []BHKConfig        `bson:"bhk_configs" json:"bhk_configs"`
	Status     ProjectStatus      `bson:"status" json:"status"`

	// People & timeline
	Lead        string     `bson:"lead,omitempty" json:"lead,omitempty"`
	ClientName  string     `bson:"client_name,omitempty" json:"client_name,omitempty"`
	ClientPhone string     `bson:"client_phone,omitempty" json:"client_phone,omitempty"`
	StartedAt   *time.Time `bson:"started_at,omitempty" json:"started_at,omitempty"`
	TargetAt    *time.Time `bson:"target_at,omitempty" json:"target_at,omitempty"`

	// Physical
	Units  int `bson:"units" json:"units"`   // total residential units
	Floors int `bson:"floors" json:"floors"` // number of floors

	// Financial (stored in Crores, e.g. 12.5 = ₹12.5 Cr)
	Budget   float64 `bson:"budget" json:"budget"`     // total approved budget
	Spent    float64 `bson:"spent" json:"spent"`       // amount committed / invoiced so far
	Progress float64 `bson:"progress" json:"progress"` // 0.0 – 1.0

	CreatedBy primitive.ObjectID `bson:"created_by" json:"created_by"`
	CreatedAt time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt time.Time          `bson:"updated_at" json:"updated_at"`
}
