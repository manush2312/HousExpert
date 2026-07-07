package utils

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ErrInvalidToken is returned when a JWT is malformed, expired, or signed with
// the wrong secret.
var ErrInvalidToken = errors.New("invalid or expired token")

// AccessTokenClaims is the payload we embed in every access token. We keep it
// small — just enough to identify the user and authorize requests without a DB
// lookup on every call.
type AccessTokenClaims struct {
	EmployeeID   string `json:"employee_id"`   // human-readable id, e.g. "E-001"
	EmployeeOID  string `json:"employee_oid"`  // mongo ObjectID hex — the canonical id
	Email        string `json:"email"`
	Role         string `json:"role"`
	jwt.RegisteredClaims
}

// jwtSecret reads the signing secret from the environment. It is intentionally
// read at call time (not cached) so tests/seed scripts can set it freely.
func jwtSecret() ([]byte, error) {
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		return nil, errors.New("JWT_SECRET is not set — refusing to sign/verify tokens")
	}
	if len(secret) < 32 {
		return nil, errors.New("JWT_SECRET must be at least 32 characters")
	}
	return []byte(secret), nil
}

// accessTokenTTL is how long an access token stays valid. Override with
// ACCESS_TOKEN_TTL_HOURS (defaults to 24h).
func accessTokenTTL() time.Duration {
	if raw := os.Getenv("ACCESS_TOKEN_TTL_HOURS"); raw != "" {
		var hours int
		if _, err := fmt.Sscanf(raw, "%d", &hours); err == nil && hours > 0 {
			return time.Duration(hours) * time.Hour
		}
	}
	return 24 * time.Hour
}

// GenerateAccessToken signs a short-lived JWT for the given user.
func GenerateAccessToken(employeeOID, employeeID, email, role string) (string, time.Time, error) {
	secret, err := jwtSecret()
	if err != nil {
		return "", time.Time{}, err
	}

	expiresAt := time.Now().Add(accessTokenTTL())
	claims := AccessTokenClaims{
		EmployeeID:  employeeID,
		EmployeeOID: employeeOID,
		Email:       email,
		Role:        role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   employeeOID,
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			Issuer:    "housexpert",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(secret)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("failed to sign token: %w", err)
	}
	return signed, expiresAt, nil
}

// ValidateAccessToken parses and verifies a token, returning its claims.
// Returns ErrInvalidToken for any failure (bad signature, expiry, tampering).
func ValidateAccessToken(tokenStr string) (*AccessTokenClaims, error) {
	secret, err := jwtSecret()
	if err != nil {
		return nil, err
	}

	claims := &AccessTokenClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		// Reject any algorithm other than the one we sign with — prevents the
		// classic "alg: none" and HS/RS confusion attacks.
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return secret, nil
	})
	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

// RandomToken returns a cryptographically-random hex string of the given byte
// length (so the string is 2x as many characters). Used for refresh tokens and
// password-reset tokens, which are opaque and stored hashed.
func RandomToken(numBytes int) (string, error) {
	b := make([]byte, numBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate random token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// HashToken returns a SHA-256-free, bcrypt-free fast hash suitable for opaque
// random tokens. Since these tokens already have 256 bits of entropy, a simple
// keyed hash is enough — we reuse bcrypt only for human-chosen passwords.
// Here we hex-encode a SHA-256 digest for constant-length, index-friendly storage.
func HashToken(token string) string {
	return sha256Hex(token)
}
