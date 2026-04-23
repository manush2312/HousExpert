package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// InquiryStatus tracks where a lead is in the pipeline
type InquiryStatus string

const (
	InquiryStatusNew      InquiryStatus = "new"
	InquiryStatusInquired InquiryStatus = "inquired"
	InquiryStatusVisited  InquiryStatus = "visited"
	InquiryStatusConverted InquiryStatus = "converted"
	InquiryStatusLost     InquiryStatus = "lost"
)

// InquirySource tracks where the lead came from
type InquirySource string

const (
	SourceInstagram  InquirySource = "instagram"
	SourceWebsite    InquirySource = "website"
	SourceReferral   InquirySource = "referral"
	SourceDirectForm InquirySource = "direct_form"
	SourceOther      InquirySource = "other"
)

// Inquiry represents an incoming lead before conversion to client
type Inquiry struct {
	ID              primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	Name            string             `bson:"name" json:"name"`
	Mobile          string             `bson:"mobile" json:"mobile"`
	Email           string             `bson:"email,omitempty" json:"email,omitempty"`
	ProjectName     string             `bson:"project_name,omitempty" json:"project_name,omitempty"`
	Budget          float64            `bson:"budget,omitempty" json:"budget,omitempty"`
	ExpectedVisit   *time.Time         `bson:"expected_visit,omitempty" json:"expected_visit,omitempty"`
	Source          InquirySource      `bson:"source" json:"source"`
	Status          InquiryStatus      `bson:"status" json:"status"`
	AssignedTo      *primitive.ObjectID `bson:"assigned_to,omitempty" json:"assigned_to,omitempty"`
	Notes           string             `bson:"notes,omitempty" json:"notes,omitempty"`
	ConvertedClient *primitive.ObjectID `bson:"converted_client,omitempty" json:"converted_client,omitempty"`
	CreatedAt       time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt       time.Time          `bson:"updated_at" json:"updated_at"`
}

// Client represents a converted inquiry / confirmed customer
type Client struct {
	ID          primitive.ObjectID  `bson:"_id,omitempty" json:"id"`
	ClientID    string              `bson:"client_id" json:"client_id"` // e.g. CLT-001
	Name        string              `bson:"name" json:"name"`
	Mobile      string              `bson:"mobile" json:"mobile"`
	Email       string              `bson:"email,omitempty" json:"email,omitempty"`
	Address     string              `bson:"address,omitempty" json:"address,omitempty"`
	InquiryID   *primitive.ObjectID `bson:"inquiry_id,omitempty" json:"inquiry_id,omitempty"` // original inquiry ref
	ProjectIDs  []primitive.ObjectID `bson:"project_ids" json:"project_ids"`                  // linked projects
	AssignedTo  *primitive.ObjectID `bson:"assigned_to,omitempty" json:"assigned_to,omitempty"`
	Notes       string              `bson:"notes,omitempty" json:"notes,omitempty"`
	CreatedAt   time.Time           `bson:"created_at" json:"created_at"`
	UpdatedAt   time.Time           `bson:"updated_at" json:"updated_at"`
}
