package utils

import (
	"context" // used for request lifecycle control.
	"fmt"

	"go.mongodb.org/mongo-driver/bson" // bson --> binary json. it is same as json but instead of text it is stored in binary.
	// So when you save a document to MongoDB, it's stored as BSON internally. When you read it back in Go, the MongoDB driver converts it back into Go structs automatically.
	"go.mongodb.org/mongo-driver/mongo/options"

	"housexpert/backend/internal/database"
)

// NextID generates the next sequential human-readable ID for an entity.
// Uses an atomic findOneAndUpdate on a "counters" collection so IDs
// are never duplicated even under concurrent requests.
//
// Usage:
//
//	NextID("project")  → "PROJ-001", "PROJ-002", ...
//	NextID("employee") → "E-001", "E-002", ...
func NextID(entity string) (string, error) {
	var result struct {
		Seq int64 `bson:"seq"` // this tells mongo
	}

	opts := options.FindOneAndUpdate().
		SetUpsert(true).
		SetReturnDocument(options.After)

	err := database.Collection("counters").FindOneAndUpdate(
		context.Background(),
		bson.M{"_id": entity}, // bson.M is just a Go map — M stands for Map. It's the way you write MongoDB queries in Go. Instead of writing raw query strings, you build them as structured Go maps.
		bson.M{"$inc": bson.M{"seq": 1}},
		opts,
	).Decode(&result)
	if err != nil {
		return "", fmt.Errorf("counter increment failed for %q: %w", entity, err)
	}

	switch entity {
	case "project":
		return fmt.Sprintf("PROJ-%03d", result.Seq), nil
	case "employee":
		return fmt.Sprintf("E-%03d", result.Seq), nil
	case "client":
		return fmt.Sprintf("CLT-%03d", result.Seq), nil
	case "vendor":
		return fmt.Sprintf("VND-%03d", result.Seq), nil
	case "product":
		return fmt.Sprintf("PRD-%03d", result.Seq), nil
	case "quotation":
		return fmt.Sprintf("QT-%03d", result.Seq), nil
	default:
		return fmt.Sprintf("%s-%03d", entity, result.Seq), nil
	}
}
