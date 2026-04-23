package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"housexpert/backend/internal/database"
	"housexpert/backend/internal/models"
	"housexpert/backend/internal/utils"
)

// ── Input types ──────────────────────────────────────────────────────────────

type CreateProductInput struct {
	Name        string `json:"name"         binding:"required"`
	DefaultSize string `json:"default_size"`
}

type UpdateProductInput struct {
	Name        *string `json:"name"`
	DefaultSize *string `json:"default_size"`
}

// ── Collection helper ─────────────────────────────────────────────────────────

func productCol() *mongo.Collection {
	return database.Collection("products")
}

// ── Service functions ─────────────────────────────────────────────────────────

// CreateProduct inserts a new product and assigns a PRD-XXX ID.
func CreateProduct(input CreateProductInput) (*models.Product, error) {
	productID, err := utils.NextID("product")
	if err != nil {
		return nil, fmt.Errorf("id generation failed: %w", err)
	}

	now := time.Now()
	product := &models.Product{
		ProductID:   productID,
		Name:        input.Name,
		DefaultSize: input.DefaultSize,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if _, err = productCol().InsertOne(context.Background(), product); err != nil {
		return nil, fmt.Errorf("insert failed: %w", err)
	}
	return product, nil
}

// ListProducts returns all products sorted by name.
func ListProducts() ([]models.Product, error) {
	ctx := context.Background()
	cursor, err := productCol().Find(ctx, bson.M{}, &options.FindOptions{
		Sort: bson.D{{Key: "name", Value: 1}},
	})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var products []models.Product
	if err := cursor.All(ctx, &products); err != nil {
		return nil, err
	}
	if products == nil {
		products = []models.Product{}
	}
	return products, nil
}

// GetProduct fetches a product by product_id (e.g. "PRD-001").
func GetProduct(productID string) (*models.Product, error) {
	var product models.Product
	err := productCol().FindOne(context.Background(), bson.M{"product_id": productID}).Decode(&product)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &product, err
}

// UpdateProduct updates name and/or default_size.
func UpdateProduct(productID string, input UpdateProductInput) (*models.Product, error) {
	set := bson.M{"updated_at": time.Now()}
	if input.Name != nil {
		set["name"] = *input.Name
	}
	if input.DefaultSize != nil {
		set["default_size"] = *input.DefaultSize
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var product models.Product
	err := productCol().FindOneAndUpdate(
		context.Background(),
		bson.M{"product_id": productID},
		bson.M{"$set": set},
		opts,
	).Decode(&product)

	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &product, err
}

// DeleteProduct permanently removes a product (it's catalog data, not transactional).
func DeleteProduct(productID string) error {
	res, err := productCol().DeleteOne(context.Background(), bson.M{"product_id": productID})
	if err != nil {
		return err
	}
	if res.DeletedCount == 0 {
		return fmt.Errorf("product not found")
	}
	return nil
}
