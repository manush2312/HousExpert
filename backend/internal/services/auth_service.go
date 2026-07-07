package services

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"

	"housexpert/backend/internal/database"
	"housexpert/backend/internal/models"
	"housexpert/backend/internal/utils"
)

// ── Errors callers can branch on ───────────────────────────────────────────────

var (
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrAccountInactive    = errors.New("account is inactive")
	ErrEmailTaken         = errors.New("an account with this email already exists")
)

// refreshTokenTTL is how long a refresh token (and thus a login session) lasts.
const refreshTokenTTL = 7 * 24 * time.Hour

// resetTokenTTL is how long a password-reset link stays valid.
const resetTokenTTL = 30 * time.Minute

// ── Input / output types ───────────────────────────────────────────────────────

type RegisterInput struct {
	Name     string             `json:"name"     binding:"required"`
	Email    string             `json:"email"    binding:"required"`
	Password string             `json:"password" binding:"required"`
	Mobile   string             `json:"mobile"`
	Gender   string             `json:"gender"`
	Role     models.EmployeeRole `json:"role"`
}

type LoginInput struct {
	Email    string `json:"email"    binding:"required"`
	Password string `json:"password" binding:"required"`
}

// AuthResult is what the client gets back on login / register / refresh.
type AuthResult struct {
	AccessToken      string           `json:"access_token"`
	AccessExpiresAt  time.Time        `json:"access_expires_at"`
	RefreshToken     string           `json:"refresh_token"`
	RefreshExpiresAt time.Time        `json:"refresh_expires_at"`
	User             *models.Employee `json:"user"`
}

// ── Collection helpers ──────────────────────────────────────────────────────────

func employeeCol() *mongo.Collection     { return database.Collection("employees") }
func refreshTokenCol() *mongo.Collection { return database.Collection("refresh_tokens") }

// normalizeEmail lower-cases and trims an email so lookups are case-insensitive.
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// ── Registration ────────────────────────────────────────────────────────────────

// RegisterEmployee creates a new system user with a hashed password.
// createdBy is the ObjectID of the admin performing the action (zero value for
// the seed/bootstrap user).
func RegisterEmployee(input RegisterInput, createdBy primitive.ObjectID) (*models.Employee, error) {
	email := normalizeEmail(input.Email)
	if _, err := mail.ParseAddress(email); err != nil {
		return nil, fmt.Errorf("invalid email address")
	}
	if err := utils.ValidatePasswordPolicy(input.Password); err != nil {
		return nil, err
	}

	role := input.Role
	if role == "" {
		role = models.RoleSales // sensible least-privilege default
	}
	if !models.IsValidRole(role) {
		return nil, fmt.Errorf("invalid role: %q", role)
	}

	hash, err := utils.HashPassword(input.Password)
	if err != nil {
		return nil, err
	}

	employeeID, err := utils.NextID("employee")
	if err != nil {
		return nil, fmt.Errorf("id generation failed: %w", err)
	}

	now := time.Now()
	emp := &models.Employee{
		ID:           primitive.NewObjectID(),
		EmployeeID:   employeeID,
		Name:         strings.TrimSpace(input.Name),
		Email:        email,
		Mobile:       input.Mobile,
		Gender:       input.Gender,
		Role:         role,
		PasswordHash: hash,
		Status:       models.EmployeeActive,
		CreatedBy:    createdBy,
		CreatedAt:    now,
		UpdatedAt:    now,
	}

	if _, err := employeeCol().InsertOne(context.Background(), emp); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return nil, ErrEmailTaken
		}
		return nil, fmt.Errorf("insert failed: %w", err)
	}
	return emp, nil
}

// ── Login ────────────────────────────────────────────────────────────────────────

// Login verifies credentials and issues an access + refresh token pair.
// It returns ErrInvalidCredentials for both "no such user" and "wrong password"
// so an attacker can't enumerate which emails exist.
func Login(input LoginInput) (*AuthResult, error) {
	email := normalizeEmail(input.Email)

	var emp models.Employee
	err := employeeCol().FindOne(context.Background(), bson.M{"email": email}).Decode(&emp)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}

	if !utils.CheckPassword(emp.PasswordHash, input.Password) {
		return nil, ErrInvalidCredentials
	}
	if emp.Status != models.EmployeeActive {
		return nil, ErrAccountInactive
	}

	// Stamp last login (best-effort — don't fail the login if this write fails).
	now := time.Now()
	_, _ = employeeCol().UpdateByID(context.Background(), emp.ID, bson.M{"$set": bson.M{"last_login_at": now}})
	emp.LastLoginAt = &now

	return issueTokens(&emp)
}

// issueTokens mints an access JWT and a fresh refresh token for a user.
func issueTokens(emp *models.Employee) (*AuthResult, error) {
	access, accessExp, err := utils.GenerateAccessToken(emp.ID.Hex(), emp.EmployeeID, emp.Email, string(emp.Role))
	if err != nil {
		return nil, err
	}

	rawRefresh, err := utils.RandomToken(32)
	if err != nil {
		return nil, err
	}
	refreshExp := time.Now().Add(refreshTokenTTL)
	rt := models.RefreshToken{
		ID:         primitive.NewObjectID(),
		TokenHash:  utils.HashToken(rawRefresh),
		EmployeeID: emp.ID,
		ExpiresAt:  refreshExp,
		CreatedAt:  time.Now(),
	}
	if _, err := refreshTokenCol().InsertOne(context.Background(), rt); err != nil {
		return nil, fmt.Errorf("failed to persist refresh token: %w", err)
	}

	emp.PasswordHash = "" // defensive — never leak the hash even though json:"-" already hides it
	return &AuthResult{
		AccessToken:      access,
		AccessExpiresAt:  accessExp,
		RefreshToken:     rawRefresh,
		RefreshExpiresAt: refreshExp,
		User:             emp,
	}, nil
}

// ── Refresh ────────────────────────────────────────────────────────────────────

// RefreshSession exchanges a valid refresh token for a new token pair and
// rotates the refresh token (the old one is deleted). Rotation means a stolen
// refresh token is only usable until the legitimate client next refreshes.
func RefreshSession(rawRefresh string) (*AuthResult, error) {
	ctx := context.Background()
	hash := utils.HashToken(rawRefresh)

	var rt models.RefreshToken
	err := refreshTokenCol().FindOne(ctx, bson.M{"token_hash": hash}).Decode(&rt)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, utils.ErrInvalidToken
	}
	if err != nil {
		return nil, err
	}

	// Rotate: delete the presented token regardless of outcome.
	_, _ = refreshTokenCol().DeleteOne(ctx, bson.M{"_id": rt.ID})

	if time.Now().After(rt.ExpiresAt) {
		return nil, utils.ErrInvalidToken
	}

	var emp models.Employee
	if err := employeeCol().FindOne(ctx, bson.M{"_id": rt.EmployeeID}).Decode(&emp); err != nil {
		return nil, utils.ErrInvalidToken
	}
	if emp.Status != models.EmployeeActive {
		return nil, ErrAccountInactive
	}

	return issueTokens(&emp)
}

// Logout revokes a single refresh token (the current session).
func Logout(rawRefresh string) error {
	_, err := refreshTokenCol().DeleteOne(context.Background(), bson.M{"token_hash": utils.HashToken(rawRefresh)})
	return err
}

// ── Current user ──────────────────────────────────────────────────────────────

// GetEmployeeByOID fetches a user by ObjectID hex string. Used by /auth/me.
func GetEmployeeByOID(oid string) (*models.Employee, error) {
	objID, err := primitive.ObjectIDFromHex(oid)
	if err != nil {
		return nil, fmt.Errorf("invalid user id")
	}
	var emp models.Employee
	err = employeeCol().FindOne(context.Background(), bson.M{"_id": objID}).Decode(&emp)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &emp, err
}

// ── Password reset ──────────────────────────────────────────────────────────────

// RequestPasswordReset generates a reset token for the given email and stores
// its hash. The raw token is returned to the caller (the handler decides how to
// deliver it — email, etc.). To avoid leaking which emails exist, the caller
// should return success even when this returns an empty token for an unknown email.
func RequestPasswordReset(email string) (string, *models.Employee, error) {
	email = normalizeEmail(email)

	var emp models.Employee
	err := employeeCol().FindOne(context.Background(), bson.M{"email": email}).Decode(&emp)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return "", nil, nil // unknown email — no token, no error (anti-enumeration)
	}
	if err != nil {
		return "", nil, err
	}

	rawToken, err := utils.RandomToken(32)
	if err != nil {
		return "", nil, err
	}
	expires := time.Now().Add(resetTokenTTL)

	_, err = employeeCol().UpdateByID(context.Background(), emp.ID, bson.M{"$set": bson.M{
		"reset_token_hash":    utils.HashToken(rawToken),
		"reset_token_expires": expires,
	}})
	if err != nil {
		return "", nil, err
	}
	return rawToken, &emp, nil
}

// ResetPassword validates a reset token and sets a new password. All refresh
// tokens for the user are revoked so any stolen sessions are killed.
func ResetPassword(rawToken, newPassword string) error {
	if err := utils.ValidatePasswordPolicy(newPassword); err != nil {
		return err
	}

	ctx := context.Background()
	var emp models.Employee
	err := employeeCol().FindOne(ctx, bson.M{"reset_token_hash": utils.HashToken(rawToken)}).Decode(&emp)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return utils.ErrInvalidToken
	}
	if err != nil {
		return err
	}
	if emp.ResetTokenExpires == nil || time.Now().After(*emp.ResetTokenExpires) {
		return utils.ErrInvalidToken
	}

	hash, err := utils.HashPassword(newPassword)
	if err != nil {
		return err
	}

	_, err = employeeCol().UpdateByID(ctx, emp.ID, bson.M{
		"$set":   bson.M{"password_hash": hash, "updated_at": time.Now()},
		"$unset": bson.M{"reset_token_hash": "", "reset_token_expires": ""},
	})
	if err != nil {
		return err
	}

	// Revoke all sessions for this user.
	_, _ = refreshTokenCol().DeleteMany(ctx, bson.M{"employee_id": emp.ID})
	return nil
}
