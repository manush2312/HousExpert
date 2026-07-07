// Package middleware holds Gin middleware for cross-cutting concerns like
// authentication, authorization, and rate limiting.
package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"

	"housexpert/backend/internal/models"
	"housexpert/backend/internal/utils"
)

// Context keys under which the authenticated user's details are stored.
// Handlers read these via c.GetString(...) after RequireAuth has run.
const (
	CtxEmployeeOID = "employee_oid"
	CtxEmployeeID  = "employee_id"
	CtxEmail       = "email"
	CtxRole        = "role"
)

// RequireAuth validates the Bearer token and injects the user into the context.
// Any request without a valid token is rejected with 401 before reaching a handler.
func RequireAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" {
			utils.Unauthorized(c, "missing Authorization header")
			c.Abort()
			return
		}

		parts := strings.SplitN(header, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
			utils.Unauthorized(c, "Authorization header must be in the form 'Bearer <token>'")
			c.Abort()
			return
		}

		claims, err := utils.ValidateAccessToken(strings.TrimSpace(parts[1]))
		if err != nil {
			utils.Unauthorized(c, "invalid or expired token")
			c.Abort()
			return
		}

		c.Set(CtxEmployeeOID, claims.EmployeeOID)
		c.Set(CtxEmployeeID, claims.EmployeeID)
		c.Set(CtxEmail, claims.Email)
		c.Set(CtxRole, claims.Role)
		c.Next()
	}
}

// RequireRole restricts a route to the given roles. It must run after RequireAuth.
// Example: admin.Use(middleware.RequireRole(models.RoleAdmin, models.RoleSuperAdmin))
func RequireRole(allowed ...models.EmployeeRole) gin.HandlerFunc {
	allowedSet := make(map[string]bool, len(allowed))
	for _, r := range allowed {
		allowedSet[string(r)] = true
	}

	return func(c *gin.Context) {
		role := c.GetString(CtxRole)
		if role == "" {
			// RequireAuth didn't run or token had no role — treat as unauthorized.
			utils.Unauthorized(c, "authentication required")
			c.Abort()
			return
		}
		if !allowedSet[role] {
			utils.Forbidden(c, "your role does not have permission to perform this action")
			c.Abort()
			return
		}
		c.Next()
	}
}

// RequireRoleForMethods enforces RBAC by HTTP method without touching every
// handler. For requests whose method is in `methods`, the caller must hold one
// of `allowed` roles; all other methods pass through. This lets us lock down
// destructive operations (e.g. DELETE) group-wide in one line.
func RequireRoleForMethods(methods []string, allowed ...models.EmployeeRole) gin.HandlerFunc {
	methodSet := make(map[string]bool, len(methods))
	for _, m := range methods {
		methodSet[strings.ToUpper(m)] = true
	}
	allowedSet := make(map[string]bool, len(allowed))
	for _, r := range allowed {
		allowedSet[string(r)] = true
	}

	return func(c *gin.Context) {
		if !methodSet[c.Request.Method] {
			c.Next()
			return
		}
		role := c.GetString(CtxRole)
		if role == "" {
			utils.Unauthorized(c, "authentication required")
			c.Abort()
			return
		}
		if !allowedSet[role] {
			utils.Forbidden(c, "only managers and admins can perform this action")
			c.Abort()
			return
		}
		c.Next()
	}
}
