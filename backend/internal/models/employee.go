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
	CreatedBy    primitive.ObjectID `bson:"created_by" json:"created_by"`
	CreatedAt    time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt    time.Time          `bson:"updated_at" json:"updated_at"`
}
