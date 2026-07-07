package utils

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func OK(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, gin.H{"success": true, "data": data}) // 200 — request succeeded, here's your data
}

func Created(c *gin.Context, data interface{}) {
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": data}) // 201 — something was created
}

func BadRequest(c *gin.Context, message string) {
	c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": message}) // 400 — you sent bad input
}

func Unauthorized(c *gin.Context, message string) {
	c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": message}) // 401 — not logged in / bad or expired token
}

func Forbidden(c *gin.Context, message string) {
	c.JSON(http.StatusForbidden, gin.H{"success": false, "error": message}) // 403 — logged in, but your role can't do this
}

func NotFound(c *gin.Context, message string) {
	c.JSON(http.StatusNotFound, gin.H{"success": false, "error": message}) // 404 — that record doesn't exist
}

func Conflict(c *gin.Context, message string) {
	c.JSON(http.StatusConflict, gin.H{"success": false, "error": message}) // 409 — clashes with existing data (e.g. duplicate email)
}

func TooManyRequests(c *gin.Context, message string) {
	c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "error": message}) // 429 — slow down (rate limited)
}

func InternalError(c *gin.Context, message string) {
	c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": message}) // 500 — something broke on our side
}

func ServiceUnavailable(c *gin.Context, message string) {
	c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "error": message}) // 503 — feature not ready (e.g. storage not configured)
}
