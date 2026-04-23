package database

import (
	"context"
	"log"
	"os"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

var DB *mongo.Database

// Connect initializes the MongoDB connection
func Connect() {
	uri := os.Getenv("MONGO_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}

	dbName := os.Getenv("MONGO_DB_NAME")
	if dbName == "" {
		dbName = "housexpert"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := mongo.Connect(ctx, options.Client().ApplyURI(uri))
	if err != nil {
		log.Fatalf("Failed to connect to MongoDB: %v", err)
	}

	// Ping to verify connection
	if err := client.Ping(ctx, nil); err != nil {
		log.Fatalf("MongoDB ping failed: %v", err)
	}

	DB = client.Database(dbName)
	log.Printf("Connected to MongoDB — database: %s", dbName)

	// Create indexes on startup
	createIndexes()
}

// Collection returns a MongoDB collection by name
func Collection(name string) *mongo.Collection {
	return DB.Collection(name)
}

// createIndexes sets up all necessary MongoDB indexes
func createIndexes() {
	ctx := context.Background()

	// Projects — unique project_id, searchable by city
	DB.Collection("projects").Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "project_id", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "address.city", Value: 1}}},
		{Keys: bson.D{{Key: "status", Value: 1}}},
	})

	// Employees — unique employee_id and email
	DB.Collection("employees").Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "employee_id", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "email", Value: 1}}, Options: options.Index().SetUnique(true)},
	})

	// Clients — unique client_id
	DB.Collection("clients").Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "client_id", Value: 1}}, Options: options.Index().SetUnique(true)},
	})

	// Inquiries — searchable by status and source
	DB.Collection("inquiries").Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "status", Value: 1}}},
		{Keys: bson.D{{Key: "source", Value: 1}}},
	})

	// LogTypes — unique name (company level)
	DB.Collection("log_types").Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "name", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "status", Value: 1}}},
	})

	// LogCategories — unique name per log_type
	DB.Collection("log_categories").Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "log_type_id", Value: 1}, {Key: "name", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "status", Value: 1}}},
	})

	// LogItems — unique name per category
	DB.Collection("log_items").Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "category_id", Value: 1}, {Key: "name", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "log_type_id", Value: 1}}},
		{Keys: bson.D{{Key: "category_id", Value: 1}}},
		{Keys: bson.D{{Key: "status", Value: 1}}},
	})

	// LogEntries — searchable by project, date, log type
	DB.Collection("log_entries").Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "project_id", Value: 1}}},
		{Keys: bson.D{{Key: "log_date", Value: -1}}},
		{Keys: bson.D{{Key: "project_id", Value: 1}, {Key: "log_date", Value: -1}}},
		{Keys: bson.D{{Key: "log_type_id", Value: 1}}},
		{Keys: bson.D{{Key: "category_id", Value: 1}}},
		{Keys: bson.D{{Key: "item_id", Value: 1}}},
	})

	// Attendance — unique per employee per date
	DB.Collection("attendance").Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "employee_id", Value: 1}, {Key: "date", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "date", Value: -1}}},
	})

	// Vendors
	DB.Collection("vendors").Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "vendor_id", Value: 1}}, Options: options.Index().SetUnique(true)},
	})

	// Products
	DB.Collection("products").Indexes().CreateMany(ctx, []mongo.IndexModel{
		{Keys: bson.D{{Key: "product_id", Value: 1}}, Options: options.Index().SetUnique(true)},
		{Keys: bson.D{{Key: "vendor_id", Value: 1}}},
	})

	log.Println("MongoDB indexes created successfully")
}
