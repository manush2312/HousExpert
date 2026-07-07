package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"housexpert/backend/internal/models"
	"housexpert/backend/internal/utils"
)

// This file holds admin-facing employee (user) management. Registration and the
// auth flows live in auth_service.go; here we list, update, and administer users.

type UpdateEmployeeInput struct {
	Name   *string              `json:"name"`
	Mobile *string              `json:"mobile"`
	Role   *models.EmployeeRole `json:"role"`
	Status *models.EmployeeStatus `json:"status"`
}

// ListEmployees returns all users, newest first. Password hashes are never
// exposed (the model hides them via json:"-").
func ListEmployees() ([]models.Employee, error) {
	ctx := context.Background()
	cursor, err := employeeCol().Find(ctx, bson.M{}, options.Find().
		SetSort(bson.D{{Key: "created_at", Value: -1}}))
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var employees []models.Employee
	if err := cursor.All(ctx, &employees); err != nil {
		return nil, err
	}
	if employees == nil {
		employees = []models.Employee{}
	}
	return employees, nil
}

// UpdateEmployee changes a user's profile/role/status. actingUser is the admin
// making the change (recorded in updated_by). Deactivating a user also revokes
// all their active sessions so the change takes effect immediately.
func UpdateEmployee(oid string, input UpdateEmployeeInput, actingUser primitive.ObjectID) (*models.Employee, error) {
	objID, err := primitive.ObjectIDFromHex(oid)
	if err != nil {
		return nil, fmt.Errorf("invalid user id")
	}

	set := bson.M{"updated_at": time.Now(), "updated_by": actingUser}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			return nil, fmt.Errorf("name cannot be empty")
		}
		set["name"] = name
	}
	if input.Mobile != nil {
		set["mobile"] = strings.TrimSpace(*input.Mobile)
	}
	if input.Role != nil {
		if !models.IsValidRole(*input.Role) {
			return nil, fmt.Errorf("invalid role: %q", *input.Role)
		}
		set["role"] = *input.Role
	}
	deactivating := false
	if input.Status != nil {
		switch *input.Status {
		case models.EmployeeActive, models.EmployeeInactive:
			set["status"] = *input.Status
			deactivating = *input.Status == models.EmployeeInactive
		default:
			return nil, fmt.Errorf("invalid status: %q", *input.Status)
		}
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var emp models.Employee
	err = employeeCol().FindOneAndUpdate(context.Background(), bson.M{"_id": objID}, bson.M{"$set": set}, opts).Decode(&emp)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	// A deactivated user should be logged out everywhere immediately.
	if deactivating {
		_, _ = refreshTokenCol().DeleteMany(context.Background(), bson.M{"employee_id": objID})
	}
	return &emp, nil
}

// AdminSetPassword lets an admin set a new password for a user (e.g. when the
// user is locked out). It enforces the password policy and revokes all of that
// user's sessions so any old credentials stop working.
func AdminSetPassword(oid, newPassword string) (*models.Employee, error) {
	objID, err := primitive.ObjectIDFromHex(oid)
	if err != nil {
		return nil, fmt.Errorf("invalid user id")
	}
	if err := utils.ValidatePasswordPolicy(newPassword); err != nil {
		return nil, err
	}

	hash, err := utils.HashPassword(newPassword)
	if err != nil {
		return nil, err
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var emp models.Employee
	err = employeeCol().FindOneAndUpdate(
		context.Background(),
		bson.M{"_id": objID},
		bson.M{
			"$set":   bson.M{"password_hash": hash, "updated_at": time.Now()},
			"$unset": bson.M{"reset_token_hash": "", "reset_token_expires": ""},
		},
		opts,
	).Decode(&emp)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	_, _ = refreshTokenCol().DeleteMany(context.Background(), bson.M{"employee_id": objID})
	return &emp, nil
}
