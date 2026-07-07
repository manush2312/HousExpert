package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// EmployeeRole defines available roles in the system (RBAC)
type EmployeeRole string

const (
	RoleSuperAdmin EmployeeRole = "super_admin"
	RoleAdmin      EmployeeRole = "admin"
	RoleManager    EmployeeRole = "manager"
	RoleSales      EmployeeRole = "sales"
	RoleDesigner   EmployeeRole = "designer"
)

// EmployeeStatus defines the status of an employee
type EmployeeStatus string

const (
	EmployeeActive   EmployeeStatus = "active"
	EmployeeInactive EmployeeStatus = "inactive"
)

// Employee represents a company employee / system user
type Employee struct {
	ID           primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	EmployeeID   string             `bson:"employee_id" json:"employee_id"` // e.g. E-001
	Name         string             `bson:"name" json:"name"` // when storing this field in MongoDB, call it name
	Email        string             `bson:"email" json:"email"`
	Mobile       string             `bson:"mobile" json:"mobile"`
	Gender       string             `bson:"gender" json:"gender"` // "male", "female", "other"
	Role         EmployeeRole       `bson:"role" json:"role"`
	PasswordHash string             `bson:"password_hash" json:"-"` // never expose in JSON
	Status       EmployeeStatus     `bson:"status" json:"status"`

	// Auth bookkeeping
	LastLoginAt *time.Time `bson:"last_login_at,omitempty" json:"last_login_at,omitempty"`

	// Password reset — opaque token stored hashed, never exposed.
	ResetTokenHash    string     `bson:"reset_token_hash,omitempty" json:"-"`
	ResetTokenExpires *time.Time `bson:"reset_token_expires,omitempty" json:"-"`

	CreatedBy primitive.ObjectID `bson:"created_by" json:"created_by"`
	UpdatedBy primitive.ObjectID `bson:"updated_by,omitempty" json:"updated_by,omitempty"`
	CreatedAt time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt time.Time          `bson:"updated_at" json:"updated_at"`
}

// IsValidRole reports whether r is one of the known RBAC roles.
func IsValidRole(r EmployeeRole) bool {
	switch r {
	case RoleSuperAdmin, RoleAdmin, RoleManager, RoleSales, RoleDesigner:
		return true
	default:
		return false
	}
}

// RefreshToken is a long-lived, revocable session credential. The raw token is
// returned to the client once; only its hash is stored, so a DB leak can't be
// replayed. Deleting the row revokes the session.
type RefreshToken struct {
	ID         primitive.ObjectID `bson:"_id,omitempty" json:"-"`
	TokenHash  string             `bson:"token_hash" json:"-"`
	EmployeeID primitive.ObjectID `bson:"employee_id" json:"-"`
	ExpiresAt  time.Time          `bson:"expires_at" json:"-"`
	CreatedAt  time.Time          `bson:"created_at" json:"-"`
}
