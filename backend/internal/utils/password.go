package utils

import (
	"fmt"
	"unicode"

	"golang.org/x/crypto/bcrypt"
)

// bcryptCost controls how expensive (and thus how brute-force-resistant) the
// hash is. 12 is a good balance for 2025-era hardware — ~250ms per hash.
const bcryptCost = 12

// HashPassword returns a bcrypt hash of the given plaintext password.
// The salt is generated and embedded in the result automatically.
func HashPassword(plain string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), bcryptCost)
	if err != nil {
		return "", fmt.Errorf("failed to hash password: %w", err)
	}
	return string(hash), nil
}

// CheckPassword reports whether the plaintext matches the stored bcrypt hash.
// Returns false (not an error) on mismatch so callers can treat it as a simple bool.
func CheckPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}

// ValidatePasswordPolicy enforces a minimum password strength.
// Rules: at least 8 characters, with at least one letter and one digit.
// Returns a human-readable error describing the first failed rule.
func ValidatePasswordPolicy(password string) error {
	if len(password) < 8 {
		return fmt.Errorf("password must be at least 8 characters")
	}

	var hasLetter, hasDigit bool
	for _, r := range password {
		switch {
		case unicode.IsLetter(r):
			hasLetter = true
		case unicode.IsDigit(r):
			hasDigit = true
		}
	}

	if !hasLetter || !hasDigit {
		return fmt.Errorf("password must contain at least one letter and one number")
	}
	return nil
}
