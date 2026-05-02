package main

import (
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	"housexpert/backend/internal/database"
	"housexpert/backend/internal/handlers"
	"housexpert/backend/internal/utils"
)

func main() {
	// Load .env file (optional — falls back to real env vars in production)
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
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

	// CORS — allow requests from any origin (frontend on S3, local dev, etc.)
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "service": "HouseXpert API"})
	})

	// API v1 — register module routes here as they are built
	v1 := r.Group("/api/v1")
	handlers.RegisterProjectRoutes(v1)
	handlers.RegisterLogRoutes(v1)
	handlers.RegisterProductRoutes(v1)
	handlers.RegisterInventoryRoutes(v1)
	handlers.RegisterQuotationRoutes(v1)
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
