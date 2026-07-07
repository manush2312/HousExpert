package handlers

import (
	"errors"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"

	"housexpert/backend/internal/middleware"
	"housexpert/backend/internal/models"
	"housexpert/backend/internal/services"
	"housexpert/backend/internal/utils"
)

// RegisterPublicAuthRoutes mounts auth endpoints that must be reachable WITHOUT
// a token (you can't be logged in yet to log in).
//
//	POST /auth/login            email + password  → token pair
//	POST /auth/refresh          refresh token     → new token pair (rotated)
//	POST /auth/logout           refresh token     → revoke this session
//	POST /auth/forgot-password  email             → issues a reset token
//	POST /auth/reset-password   token + password  → sets a new password
func RegisterPublicAuthRoutes(rg *gin.RouterGroup) {
	a := rg.Group("/auth")
	// Throttle login attempts: 10 per minute per IP.
	a.POST("/login", middleware.RateLimitLogins(10, time.Minute), login)
	a.POST("/refresh", refresh)
	a.POST("/logout", logout)
	a.POST("/forgot-password", forgotPassword)
	a.POST("/reset-password", resetPassword)
}

// RegisterProtectedAuthRoutes mounts auth endpoints that require a valid token.
// The caller is expected to have applied RequireAuth to this group already.
//
//	GET  /auth/me        → current user
//	POST /auth/register  → create a new user (admin / super_admin only)
func RegisterProtectedAuthRoutes(rg *gin.RouterGroup) {
	a := rg.Group("/auth")
	a.GET("/me", me)
	a.POST("/register",
		middleware.RequireRole(models.RoleAdmin, models.RoleSuperAdmin),
		register,
	)

	// User management — admin / super_admin only. RequireRole is applied to the
	// whole group so every endpoint under /auth/users is locked down.
	users := a.Group("/users")
	users.Use(middleware.RequireRole(models.RoleAdmin, models.RoleSuperAdmin))
	users.GET("", listUsers)
	users.PUT("/:id", updateUser)
	users.POST("/:id/reset-password", adminResetUserPassword)
}

// ── Handlers ──────────────────────────────────────────────────────────────────

func login(c *gin.Context) {
	var input services.LoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	result, err := services.Login(input)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrInvalidCredentials):
			utils.Unauthorized(c, "invalid email or password")
		case errors.Is(err, services.ErrAccountInactive):
			utils.Forbidden(c, "this account is inactive — contact an administrator")
		default:
			utils.InternalError(c, err.Error())
		}
		return
	}
	utils.OK(c, result)
}

func refresh(c *gin.Context) {
	var body struct {
		RefreshToken string `json:"refresh_token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	result, err := services.RefreshSession(body.RefreshToken)
	if err != nil {
		if errors.Is(err, utils.ErrInvalidToken) {
			utils.Unauthorized(c, "invalid or expired refresh token")
			return
		}
		if errors.Is(err, services.ErrAccountInactive) {
			utils.Forbidden(c, "this account is inactive")
			return
		}
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, result)
}

func logout(c *gin.Context) {
	var body struct {
		RefreshToken string `json:"refresh_token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := services.Logout(body.RefreshToken); err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"logged_out": true})
}

func me(c *gin.Context) {
	oid := c.GetString(middleware.CtxEmployeeOID)
	emp, err := services.GetEmployeeByOID(oid)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	if emp == nil {
		utils.NotFound(c, "user not found")
		return
	}
	utils.OK(c, emp)
}

func register(c *gin.Context) {
	var input services.RegisterInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	// Attribute creation to the admin making the request.
	creator, _ := primitive.ObjectIDFromHex(c.GetString(middleware.CtxEmployeeOID))

	emp, err := services.RegisterEmployee(input, creator)
	if err != nil {
		if errors.Is(err, services.ErrEmailTaken) {
			utils.Conflict(c, err.Error())
			return
		}
		// Validation errors (bad email, weak password, bad role) are client errors.
		utils.BadRequest(c, err.Error())
		return
	}
	utils.Created(c, emp)
}

// ── User management (admin only) ────────────────────────────────────────────

func listUsers(c *gin.Context) {
	users, err := services.ListEmployees()
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, users)
}

func updateUser(c *gin.Context) {
	var input services.UpdateEmployeeInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	actingUser, _ := primitive.ObjectIDFromHex(c.GetString(middleware.CtxEmployeeOID))

	// Guard: an admin can't lock themselves out by deactivating their own account.
	if input.Status != nil && *input.Status == models.EmployeeInactive && c.Param("id") == c.GetString(middleware.CtxEmployeeOID) {
		utils.BadRequest(c, "you cannot deactivate your own account")
		return
	}

	emp, err := services.UpdateEmployee(c.Param("id"), input, actingUser)
	if err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if emp == nil {
		utils.NotFound(c, "user not found")
		return
	}
	utils.OK(c, emp)
}

func adminResetUserPassword(c *gin.Context) {
	var body struct {
		NewPassword string `json:"new_password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	emp, err := services.AdminSetPassword(c.Param("id"), body.NewPassword)
	if err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if emp == nil {
		utils.NotFound(c, "user not found")
		return
	}
	utils.OK(c, gin.H{"message": "password updated", "user": emp})
}

func forgotPassword(c *gin.Context) {
	var body struct {
		Email string `json:"email" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	token, _, err := services.RequestPasswordReset(body.Email)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}

	// Always return the same response whether or not the email exists, so the
	// endpoint can't be used to enumerate registered accounts.
	resp := gin.H{"message": "if that email is registered, a reset link has been sent"}

	// Dev convenience: when no mailer is wired, expose the token directly so it
	// can be tested. NEVER enable AUTH_EXPOSE_RESET_TOKEN in production.
	if token != "" && os.Getenv("AUTH_EXPOSE_RESET_TOKEN") == "true" {
		resp["reset_token"] = token
	}
	utils.OK(c, resp)
}

func resetPassword(c *gin.Context) {
	var body struct {
		Token       string `json:"token"        binding:"required"`
		NewPassword string `json:"new_password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	if err := services.ResetPassword(body.Token, body.NewPassword); err != nil {
		if errors.Is(err, utils.ErrInvalidToken) {
			utils.BadRequest(c, "this reset link is invalid or has expired")
			return
		}
		// Password-policy failures are client errors.
		utils.BadRequest(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"message": "password updated — please log in with your new password"})
}
