package handlers

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"

	"housexpert/backend/internal/database"
	"housexpert/backend/internal/models"
	"housexpert/backend/internal/services"
	"housexpert/backend/internal/utils"
)

func RegisterPricingRuleRoutes(r *gin.RouterGroup) {
	r.GET("/log-types/:id/pricing-rule", getPricingRule)
	r.POST("/log-types/:id/pricing-rule", savePricingRule)
	r.PUT("/pricing-rules/:id", updatePricingRule)
	r.DELETE("/pricing-rules/:id", deletePricingRule)
}

func pricingRuleCol() *mongo.Collection {
	return database.Collection("pricing_rules")
}

// ── GET /log-types/:id/pricing-rule ──────────────────────────────────────────

func getPricingRule(c *gin.Context) {
	logTypeOID, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		utils.BadRequest(c, "invalid log type id")
		return
	}

	var rule models.PricingRule
	err = pricingRuleCol().FindOne(context.Background(), bson.M{"log_type_id": logTypeOID}).Decode(&rule)
	if err != nil {
		// No rule found — return null data (not an error)
		utils.OK(c, nil)
		return
	}
	rule = normalizePricingRule(rule)
	utils.OK(c, rule)
}

// ── POST /log-types/:id/pricing-rule ─────────────────────────────────────────
// Creates or fully replaces the rule for the given log type.

type savePricingRuleInput struct {
	Name            string                    `json:"name"              binding:"required"`
	DimensionFields []string                  `json:"dimension_fields"  binding:"required"`
	Rates           []models.PricingRateEntry `json:"rates"             binding:"required"`
}

func savePricingRule(c *gin.Context) {
	logTypeOID, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		utils.BadRequest(c, "invalid log type id")
		return
	}

	var input savePricingRuleInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validatePricingRuleInput(c.Param("id"), input.DimensionFields, input.Rates); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	col := pricingRuleCol()
	now := time.Now()

	// Upsert: replace existing rule for this log type, or create a new one.
	var existing models.PricingRule
	existErr := col.FindOne(context.Background(), bson.M{"log_type_id": logTypeOID}).Decode(&existing)

	if existErr == nil {
		nextVersion := existing.CurrentVersion + 1
		if nextVersion <= 0 {
			nextVersion = len(existing.VersionHistory) + 1
		}
		versionSnapshot := buildPricingRuleVersion(nextVersion, input.Name, input.DimensionFields, input.Rates, now)

		_, err = col.UpdateOne(
			context.Background(),
			bson.M{"_id": existing.ID},
			bson.M{
				"$set": bson.M{
					"name":             input.Name,
					"dimension_fields": input.DimensionFields,
					"rates":            input.Rates,
					"current_version":  nextVersion,
					"updated_at":       now,
				},
				"$push": bson.M{"version_history": versionSnapshot},
			},
		)
		if err != nil {
			utils.InternalError(c, err.Error())
			return
		}
		existing.Name = input.Name
		existing.DimensionFields = input.DimensionFields
		existing.Rates = input.Rates
		existing.CurrentVersion = nextVersion
		existing.VersionHistory = append(existing.VersionHistory, versionSnapshot)
		existing.UpdatedAt = now
		utils.OK(c, existing)
		return
	}

	// Insert new
	initialVersion := buildPricingRuleVersion(1, input.Name, input.DimensionFields, input.Rates, now)
	rule := models.PricingRule{
		ID:              primitive.NewObjectID(),
		LogTypeID:       logTypeOID,
		Name:            input.Name,
		DimensionFields: input.DimensionFields,
		Rates:           input.Rates,
		CurrentVersion:  1,
		VersionHistory:  []models.PricingRuleVersion{initialVersion},
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if _, err = col.InsertOne(context.Background(), rule); err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.Created(c, rule)
}

// ── PUT /pricing-rules/:id ────────────────────────────────────────────────────

type updatePricingRuleInput struct {
	Name            *string                   `json:"name"`
	DimensionFields []string                  `json:"dimension_fields"`
	Rates           []models.PricingRateEntry `json:"rates"`
}

func updatePricingRule(c *gin.Context) {
	oid, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}

	var input updatePricingRuleInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	var existing models.PricingRule
	if err := pricingRuleCol().FindOne(context.Background(), bson.M{"_id": oid}).Decode(&existing); err != nil {
		if err == mongo.ErrNoDocuments {
			utils.NotFound(c, "pricing rule not found")
			return
		}
		utils.InternalError(c, err.Error())
		return
	}

	dimensionFields := existing.DimensionFields
	if input.DimensionFields != nil {
		dimensionFields = input.DimensionFields
	}
	rates := existing.Rates
	if input.Rates != nil {
		rates = input.Rates
	}
	if err := validatePricingRuleInput(existing.LogTypeID.Hex(), dimensionFields, rates); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	now := time.Now()
	nextName := existing.Name
	if input.Name != nil {
		nextName = *input.Name
	}
	nextDimensionFields := existing.DimensionFields
	if input.DimensionFields != nil {
		nextDimensionFields = input.DimensionFields
	}
	nextRates := existing.Rates
	if input.Rates != nil {
		nextRates = input.Rates
	}
	nextVersion := existing.CurrentVersion + 1
	if nextVersion <= 0 {
		nextVersion = len(existing.VersionHistory) + 1
	}
	versionSnapshot := buildPricingRuleVersion(nextVersion, nextName, nextDimensionFields, nextRates, now)

	res, err := pricingRuleCol().UpdateOne(
		context.Background(),
		bson.M{"_id": oid},
		bson.M{
			"$set": bson.M{
				"name":             nextName,
				"dimension_fields": nextDimensionFields,
				"rates":            nextRates,
				"current_version":  nextVersion,
				"updated_at":       now,
			},
			"$push": bson.M{"version_history": versionSnapshot},
		},
	)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	if res.MatchedCount == 0 {
		utils.NotFound(c, "pricing rule not found")
		return
	}

	var rule models.PricingRule
	if err := pricingRuleCol().FindOne(context.Background(), bson.M{"_id": oid}).Decode(&rule); err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	rule = normalizePricingRule(rule)
	utils.OK(c, rule)
}

// ── DELETE /pricing-rules/:id ─────────────────────────────────────────────────

func deletePricingRule(c *gin.Context) {
	oid, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}

	res, err := pricingRuleCol().DeleteOne(context.Background(), bson.M{"_id": oid})
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	if res.DeletedCount == 0 {
		utils.NotFound(c, "pricing rule not found")
		return
	}
	utils.OK(c, gin.H{"deleted": true})
}

func validatePricingRuleInput(logTypeID string, dimensionFields []string, rates []models.PricingRateEntry) error {
	if len(dimensionFields) == 0 {
		return fmt.Errorf("pick at least one dimension field")
	}
	if len(rates) == 0 {
		return fmt.Errorf("add at least one pricing row")
	}

	logType, err := services.GetLogType(logTypeID)
	if err != nil {
		return err
	}
	if logType == nil {
		return fmt.Errorf("log type not found")
	}

	schemaFields := append([]models.SchemaField{}, logType.CurrentSchema...)
	schemaFields = append(schemaFields, logType.CurrentEntrySchema...)
	fieldByID := make(map[string]models.SchemaField, len(schemaFields))
	for _, field := range schemaFields {
		fieldByID[field.FieldID] = field
	}

	seenDimensions := make(map[string]struct{}, len(dimensionFields))
	for _, fieldID := range dimensionFields {
		if _, exists := seenDimensions[fieldID]; exists {
			return fmt.Errorf("dimension fields must be unique")
		}
		seenDimensions[fieldID] = struct{}{}

		field, ok := fieldByID[fieldID]
		if !ok {
			return fmt.Errorf("dimension field %q does not exist in the current schema", fieldID)
		}
		if field.FieldType != models.FieldTypeDropdown {
			return fmt.Errorf("%s must be a dropdown field to be used in pricing rules", field.Label)
		}
		if len(field.Options) == 0 {
			return fmt.Errorf("%s must define dropdown options before it can be used in pricing rules", field.Label)
		}
	}

	seenKeys := make(map[string]struct{}, len(rates))
	for _, rate := range rates {
		if math.IsNaN(rate.Rate) || math.IsInf(rate.Rate, 0) || rate.Rate < 0 {
			return fmt.Errorf("rates must be valid numbers greater than or equal to 0")
		}

		parts := make([]string, 0, len(dimensionFields))
		for _, fieldID := range dimensionFields {
			field := fieldByID[fieldID]
			value := strings.TrimSpace(rate.Keys[fieldID])
			if value == "" {
				return fmt.Errorf("each pricing row must define a value for %s", field.Label)
			}
			if !containsString(field.Options, value) {
				return fmt.Errorf("%q is not a valid option for %s", value, field.Label)
			}
			parts = append(parts, fieldID+"="+value)
		}

		signature := strings.Join(parts, "|")
		if _, exists := seenKeys[signature]; exists {
			return fmt.Errorf("duplicate pricing row for the same field combination")
		}
		seenKeys[signature] = struct{}{}
	}

	return nil
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func buildPricingRuleVersion(version int, name string, dimensionFields []string, rates []models.PricingRateEntry, createdAt time.Time) models.PricingRuleVersion {
	keysCopy := make([]models.PricingRateEntry, len(rates))
	for idx, rate := range rates {
		keyMap := make(map[string]string, len(rate.Keys))
		for key, value := range rate.Keys {
			keyMap[key] = value
		}
		keysCopy[idx] = models.PricingRateEntry{
			Keys: keyMap,
			Rate: rate.Rate,
		}
	}

	dimensionsCopy := append([]string(nil), dimensionFields...)
	return models.PricingRuleVersion{
		Version:         version,
		Name:            name,
		DimensionFields: dimensionsCopy,
		Rates:           keysCopy,
		CreatedAt:       createdAt,
	}
}

func normalizePricingRule(rule models.PricingRule) models.PricingRule {
	if rule.CurrentVersion > 0 && len(rule.VersionHistory) > 0 {
		return rule
	}

	initialCreatedAt := rule.CreatedAt
	if initialCreatedAt.IsZero() {
		initialCreatedAt = rule.UpdatedAt
	}
	if initialCreatedAt.IsZero() {
		initialCreatedAt = time.Now()
	}
	rule.CurrentVersion = 1
	rule.VersionHistory = []models.PricingRuleVersion{
		buildPricingRuleVersion(1, rule.Name, rule.DimensionFields, rule.Rates, initialCreatedAt),
	}
	return rule
}
