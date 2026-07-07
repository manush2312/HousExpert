package utils

import (
	"crypto/sha256"
	"encoding/hex"
)

// sha256Hex returns the hex-encoded SHA-256 digest of s. Used to store opaque
// high-entropy tokens (refresh / password-reset) without keeping the raw value.
func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
