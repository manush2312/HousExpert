// Command seed bootstraps the first super_admin user so you can log in.
//
// Usage (from the backend/ directory):
//
//	SEED_ADMIN_EMAIL=admin@housexpert.com \
//	SEED_ADMIN_PASSWORD=changeme123 \
//	SEED_ADMIN_NAME="Super Admin" \
//	go run ./cmd/seed
//
// It reads the same .env as the server (MONGO_URI etc.). Running it again with
// an email that already exists is a no-op, so it's safe to re-run.
package main

import (
	"log"
	"os"

	"github.com/joho/godotenv"
	"go.mongodb.org/mongo-driver/bson/primitive"

	"housexpert/backend/internal/database"
	"housexpert/backend/internal/models"
	"housexpert/backend/internal/services"
)

func main() {
	// Load .env (mirrors the server's loading logic).
	envFile := os.Getenv("ENV_FILE")
	if envFile == "" {
		envFile = ".env"
	}
	if err := godotenv.Load(envFile); err != nil {
		if fallbackErr := godotenv.Load("backend/.env"); fallbackErr != nil {
			log.Println("No .env file found, using environment variables")
		}
	}

	email := os.Getenv("SEED_ADMIN_EMAIL")
	password := os.Getenv("SEED_ADMIN_PASSWORD")
	name := os.Getenv("SEED_ADMIN_NAME")
	if email == "" || password == "" {
		log.Fatal("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required")
	}
	if name == "" {
		name = "Super Admin"
	}

	database.Connect()

	emp, err := services.RegisterEmployee(services.RegisterInput{
		Name:     name,
		Email:    email,
		Password: password,
		Role:     models.RoleSuperAdmin,
	}, primitive.NilObjectID)

	if err != nil {
		if err == services.ErrEmailTaken {
			log.Printf("✅ Admin %q already exists — nothing to do", email)
			return
		}
		log.Fatalf("Failed to seed admin: %v", err)
	}

	log.Printf("✅ Created super_admin %s (%s) — you can now log in", emp.Email, emp.EmployeeID)
}
