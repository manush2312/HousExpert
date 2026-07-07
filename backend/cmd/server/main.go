package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	"housexpert/backend/internal/database"
	"housexpert/backend/internal/handlers"
	"housexpert/backend/internal/middleware"
	"housexpert/backend/internal/models"
	"housexpert/backend/internal/utils"
)

func main() {
	// Load .env file — ENV_FILE overrides the default lookup.
	envFile := os.Getenv("ENV_FILE")
	if envFile == "" {
		envFile = ".env"
	}
	if err := godotenv.Load(envFile); err != nil {
		if envFile == ".env" {
			if fallbackErr := godotenv.Load("backend/.env"); fallbackErr != nil {
				log.Println("No .env file found, using environment variables")
			}
		} else {
			log.Println("No .env file found, using environment variables")
		}
	}

	// Connect to MongoDB and create indexes
	database.Connect()

	// Initialize file storage (S3/R2) — non-fatal if not configured
	if err := utils.InitStorage(); err != nil {
		log.Printf("⚠️  File storage not configured (%v) — presigned URL endpoints will return 503", err)
	} else {
		log.Println("✅ File storage initialized")
	}

	// Set up Gin router
	r := gin.Default()

	// CORS — restrict to an allowlist of origins from ALLOWED_ORIGINS
	// (comma-separated). Falls back to localhost dev origins if unset.
	r.Use(corsMiddleware(allowedOrigins()))

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "service": "HouseXpert API"})
	})

	// ── Public API (no authentication) ──────────────────────────────────────
	// Login, token refresh, and password reset must be reachable without a token.
	public := r.Group("/api/v1")
	handlers.RegisterPublicAuthRoutes(public)

	// ── Protected API (valid JWT required) ──────────────────────────────────
	// Every business endpoint sits behind RequireAuth. Destructive operations
	// (DELETE) are further restricted to managers and admins via RBAC.
	v1 := r.Group("/api/v1")
	v1.Use(middleware.RequireAuth())
	v1.Use(middleware.RequireRoleForMethods(
		[]string{http.MethodDelete},
		models.RoleManager, models.RoleAdmin, models.RoleSuperAdmin,
	))

	handlers.RegisterProtectedAuthRoutes(v1)
	handlers.RegisterProjectRoutes(v1)
	handlers.RegisterLogRoutes(v1)
	handlers.RegisterProductRoutes(v1)
	handlers.RegisterInventoryRoutes(v1)
	handlers.RegisterQuotationRoutes(v1)
	handlers.RegisterFurnitureDesignRoutes(v1)
	handlers.RegisterExportRoutes(v1)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("HouseXpert API running on port %s", port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

// allowedOrigins reads the CORS allowlist from ALLOWED_ORIGINS (comma-separated).
// When unset it falls back to common local dev origins so development isn't blocked.
func allowedOrigins() map[string]bool {
	raw := os.Getenv("ALLOWED_ORIGINS")
	if raw == "" {
		raw = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"
		log.Println("⚠️  ALLOWED_ORIGINS not set — using localhost dev origins only")
	}

	origins := make(map[string]bool)
	for _, o := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(o); trimmed != "" {
			origins[trimmed] = true
		}
	}
	return origins
}

// corsMiddleware echoes the request Origin back only when it's in the allowlist.
// Unlike a wildcard `*`, this is safe to combine with credentials and prevents
// arbitrary sites from calling the API from a browser.
func corsMiddleware(allowed map[string]bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && allowed[origin] {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
			c.Header("Access-Control-Allow-Credentials", "true")
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
