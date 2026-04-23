package models

import (
	"time"

	"go.mongodb.org/mongo-driver/bson/primitive"
)

// AttendanceStatus defines the attendance status for a day
type AttendanceStatus string

const (
	AttendancePresent  AttendanceStatus = "present"
	AttendanceAbsent   AttendanceStatus = "absent"
	AttendanceHalfDay  AttendanceStatus = "half_day"
	AttendanceOnLeave  AttendanceStatus = "on_leave"
)

// AttendanceRecord represents a single attendance entry for an employee on a day
type AttendanceRecord struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	EmployeeID  primitive.ObjectID `bson:"employee_id" json:"employee_id"`
	Date        time.Time          `bson:"date" json:"date"`
	Status      AttendanceStatus   `bson:"status" json:"status"`
	CheckIn     *time.Time         `bson:"check_in,omitempty" json:"check_in,omitempty"`   // from biometric
	CheckOut    *time.Time         `bson:"check_out,omitempty" json:"check_out,omitempty"` // from biometric
	Source      string             `bson:"source" json:"source"`                           // "biometric" or "manual"
	Notes       string             `bson:"notes,omitempty" json:"notes,omitempty"`
	CreatedAt   time.Time          `bson:"created_at" json:"created_at"`
	UpdatedAt   time.Time          `bson:"updated_at" json:"updated_at"`
}
