package services

import (
	"context"
	"errors"
	"fmt"
	"math"
	"regexp"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"housexpert/backend/internal/database"
	"housexpert/backend/internal/models"
	"housexpert/backend/internal/utils"
)

var inchesSizePattern = regexp.MustCompile(`^\s*(\d+(?:\.\d+)?)\s*[Xx]\s*(\d+(?:\.\d+)?)\s*$`)

// ── Input types ──────────────────────────────────────────────────────────────

type QuotationItemInput struct {
	ProductID       string   `json:"product_id"`
	Description     string   `json:"description" binding:"required"`
	Size            string   `json:"size"`
	Sqft            *float64 `json:"sqft"`
	Qty             float64  `json:"qty"`
	UseQuantityRate bool     `json:"use_quantity_rate"`
	Rate            float64  `json:"rate"`
	Note            string   `json:"note"`
}

type QuotationSectionInput struct {
	RoomName string               `json:"room_name" binding:"required"`
	Items    []QuotationItemInput `json:"items"`
}

type CreateQuotationInput struct {
	ClientName      string                  `json:"client_name"     binding:"required"`
	ClientPhone     string                  `json:"client_phone"`
	ClientLocation  string                  `json:"client_location"`
	Sections        []QuotationSectionInput `json:"sections"`
	DiscountPercent float64                 `json:"discount_percent"`
	ApplyGST        bool                    `json:"apply_gst"`
	GSTPercent      float64                 `json:"gst_percent"`
	Notes           string                  `json:"notes"`
}

type UpdateQuotationInput struct {
	ClientName      *string                 `json:"client_name"`
	ClientPhone     *string                 `json:"client_phone"`
	ClientLocation  *string                 `json:"client_location"`
	Sections        []QuotationSectionInput `json:"sections"` // nil means no change
	DiscountPercent *float64                `json:"discount_percent"`
	ApplyGST        *bool                   `json:"apply_gst"`
	GSTPercent      *float64                `json:"gst_percent"`
	Notes           *string                 `json:"notes"`
}

type QuotationListFilter struct {
	Status string
	Page   int64
	Limit  int64
}

type QuotationListResult struct {
	Quotations []models.Quotation `json:"quotations"`
	Total      int64              `json:"total"`
	Page       int64              `json:"page"`
	Limit      int64              `json:"limit"`
}

// ── Collection helper ─────────────────────────────────────────────────────────

func quotationCol() *mongo.Collection {
	return database.Collection("quotations")
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// buildSections converts input sections → model sections and computes item amounts + total.
func buildSections(inputs []QuotationSectionInput) ([]models.QuotationSection, float64, error) {
	var sections []models.QuotationSection
	var total float64

	for _, si := range inputs {
		sec := models.QuotationSection{
			SectionID: primitive.NewObjectID().Hex(),
			RoomName:  si.RoomName,
			Items:     make([]models.QuotationItem, 0, len(si.Items)),
		}
		for _, ii := range si.Items {
			qty := ii.Qty
			if qty == 0 {
				qty = 1
			}
			sqft := deriveQuotationSqft(ii.Size, ii.Sqft)
			amount := computeQuotationItemAmount(qty, ii.Rate, sqft, ii.UseQuantityRate)
			item := models.QuotationItem{
				ItemID:          primitive.NewObjectID(),
				ProductID:       ii.ProductID,
				Description:     ii.Description,
				Size:            ii.Size,
				Sqft:            sqft,
				Qty:             qty,
				UseQuantityRate: ii.UseQuantityRate,
				Rate:            ii.Rate,
				Amount:          amount,
				Note:            ii.Note,
			}
			total += amount
			sec.Items = append(sec.Items, item)
		}
		sections = append(sections, sec)
	}
	if sections == nil {
		sections = []models.QuotationSection{}
	}
	return sections, total, nil
}

func deriveQuotationSqft(size string, fallback *float64) *float64 {
	if matches := inchesSizePattern.FindStringSubmatch(size); len(matches) == 3 {
		var width, height float64
		if _, err := fmt.Sscanf(matches[1], "%f", &width); err == nil {
			if _, err := fmt.Sscanf(matches[2], "%f", &height); err == nil {
				if width > 0 && height > 0 {
					value := math.Round(((width*height)/144)*100) / 100
					return &value
				}
			}
		}
	}
	if fallback == nil {
		return nil
	}
	value := math.Round((*fallback)*100) / 100
	return &value
}

func sqftValueOrZero(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func computeQuotationItemAmount(qty float64, rate float64, sqft *float64, useQuantityRate bool) float64 {
	if qty == 0 {
		qty = 1
	}
	if useQuantityRate || sqft == nil {
		return qty * rate
	}
	return qty * sqftValueOrZero(sqft) * rate
}

func roundQuotationMoney(value float64) float64 {
	return math.Round(value*100) / 100
}

func validateGSTInput(applyGST bool, gstPercent float64) error {
	if !applyGST {
		return nil
	}
	if gstPercent <= 0 {
		return fmt.Errorf("gst percent must be greater than 0")
	}
	if gstPercent > 100 {
		return fmt.Errorf("gst percent cannot be greater than 100")
	}
	return nil
}

func validateDiscountInput(discountPercent float64) error {
	if discountPercent < 0 {
		return fmt.Errorf("discount percent cannot be negative")
	}
	if discountPercent > 100 {
		return fmt.Errorf("discount percent cannot be greater than 100")
	}
	return nil
}

func normalizedDiscountPercent(discountPercent float64) float64 {
	if discountPercent <= 0 {
		return 0
	}
	return roundQuotationMoney(discountPercent)
}

func normalizedGSTPercent(applyGST bool, gstPercent float64) float64 {
	if !applyGST {
		return 0
	}
	return roundQuotationMoney(gstPercent)
}

func computeQuotationTotals(subtotal float64, discountPercent float64, applyGST bool, gstPercent float64) (float64, float64, float64, float64) {
	subtotal = roundQuotationMoney(subtotal)
	discountPercent = normalizedDiscountPercent(discountPercent)
	discountAmount := roundQuotationMoney(subtotal * discountPercent / 100)
	taxableAmount := roundQuotationMoney(subtotal - discountAmount)

	if !applyGST {
		return subtotal, discountAmount, 0, taxableAmount
	}

	gstPercent = normalizedGSTPercent(applyGST, gstPercent)
	gstAmount := roundQuotationMoney(taxableAmount * gstPercent / 100)
	total := roundQuotationMoney(taxableAmount + gstAmount)
	return subtotal, discountAmount, gstAmount, total
}

// ── Service functions ─────────────────────────────────────────────────────────

// CreateQuotation inserts a new quotation and assigns a QT-XXX ID.
func CreateQuotation(input CreateQuotationInput) (*models.Quotation, error) {
	quotationID, err := utils.NextID("quotation")
	if err != nil {
		return nil, fmt.Errorf("id generation failed: %w", err)
	}

	sections, total, err := buildSections(input.Sections)
	if err != nil {
		return nil, err
	}
	if err := validateGSTInput(input.ApplyGST, input.GSTPercent); err != nil {
		return nil, err
	}
	if err := validateDiscountInput(input.DiscountPercent); err != nil {
		return nil, err
	}
	subtotal, discountAmount, gstAmount, finalTotal := computeQuotationTotals(total, input.DiscountPercent, input.ApplyGST, input.GSTPercent)

	now := time.Now()
	q := &models.Quotation{
		QuotationID:     quotationID,
		ClientName:      input.ClientName,
		ClientPhone:     input.ClientPhone,
		ClientLocation:  input.ClientLocation,
		Sections:        sections,
		SubtotalAmount:  subtotal,
		DiscountPercent: normalizedDiscountPercent(input.DiscountPercent),
		DiscountAmount:  discountAmount,
		ApplyGST:        input.ApplyGST,
		GSTPercent:      normalizedGSTPercent(input.ApplyGST, input.GSTPercent),
		GSTAmount:       gstAmount,
		TotalAmount:     finalTotal,
		Status:          models.QuotationDraft,
		Notes:           input.Notes,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	if _, err = quotationCol().InsertOne(context.Background(), q); err != nil {
		return nil, fmt.Errorf("insert failed: %w", err)
	}
	return q, nil
}

// ListQuotations returns a paginated list of quotations.
func ListQuotations(f QuotationListFilter) (*QuotationListResult, error) {
	if f.Page < 1 {
		f.Page = 1
	}
	if f.Limit < 1 || f.Limit > 100 {
		f.Limit = 20
	}

	query := bson.M{}
	if f.Status != "" {
		query["status"] = f.Status
	}

	ctx := context.Background()
	total, err := quotationCol().CountDocuments(ctx, query)
	if err != nil {
		return nil, err
	}

	skip := (f.Page - 1) * f.Limit
	cursor, err := quotationCol().Find(ctx, query, &options.FindOptions{
		Skip:  &skip,
		Limit: &f.Limit,
		Sort:  bson.D{{Key: "created_at", Value: -1}},
	})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var quotations []models.Quotation
	if err := cursor.All(ctx, &quotations); err != nil {
		return nil, err
	}
	if quotations == nil {
		quotations = []models.Quotation{}
	}

	return &QuotationListResult{
		Quotations: quotations,
		Total:      total,
		Page:       f.Page,
		Limit:      f.Limit,
	}, nil
}

// GetQuotation fetches a quotation by its human-readable ID (e.g. "QT-001").
func GetQuotation(quotationID string) (*models.Quotation, error) {
	var q models.Quotation
	err := quotationCol().FindOne(context.Background(), bson.M{"quotation_id": quotationID}).Decode(&q)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &q, err
}

// UpdateQuotation updates client info, sections, or notes. Only allowed on draft quotations.
func UpdateQuotation(quotationID string, input UpdateQuotationInput) (*models.Quotation, error) {
	existing, err := GetQuotation(quotationID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, nil
	}

	set := bson.M{"updated_at": time.Now()}
	currentSubtotal := subtotalOrExisting(existing.SubtotalAmount, existing.TotalAmount, existing.GSTAmount, existing.DiscountAmount)
	nextDiscountPercent := existing.DiscountPercent
	nextApplyGST := existing.ApplyGST
	nextGSTPercent := existing.GSTPercent

	if input.ClientName != nil {
		set["client_name"] = *input.ClientName
	}
	if input.ClientPhone != nil {
		set["client_phone"] = *input.ClientPhone
	}
	if input.ClientLocation != nil {
		set["client_location"] = *input.ClientLocation
	}
	if input.Notes != nil {
		set["notes"] = *input.Notes
	}
	if input.DiscountPercent != nil {
		nextDiscountPercent = *input.DiscountPercent
	}
	if input.ApplyGST != nil {
		nextApplyGST = *input.ApplyGST
	}
	if input.GSTPercent != nil {
		nextGSTPercent = *input.GSTPercent
	}
	if err := validateDiscountInput(nextDiscountPercent); err != nil {
		return nil, err
	}
	if err := validateGSTInput(nextApplyGST, nextGSTPercent); err != nil {
		return nil, err
	}
	if input.Sections != nil {
		sections, total, err := buildSections(input.Sections)
		if err != nil {
			return nil, err
		}
		subtotal, discountAmount, gstAmount, finalTotal := computeQuotationTotals(total, nextDiscountPercent, nextApplyGST, nextGSTPercent)
		set["sections"] = sections
		set["subtotal_amount"] = subtotal
		set["discount_percent"] = normalizedDiscountPercent(nextDiscountPercent)
		set["discount_amount"] = discountAmount
		set["apply_gst"] = nextApplyGST
		set["gst_percent"] = normalizedGSTPercent(nextApplyGST, nextGSTPercent)
		set["gst_amount"] = gstAmount
		set["total_amount"] = finalTotal
		currentSubtotal = subtotal
	}
	if input.DiscountPercent != nil || input.ApplyGST != nil || input.GSTPercent != nil {
		subtotal, discountAmount, gstAmount, finalTotal := computeQuotationTotals(currentSubtotal, nextDiscountPercent, nextApplyGST, nextGSTPercent)
		set["discount_percent"] = normalizedDiscountPercent(nextDiscountPercent)
		set["discount_amount"] = discountAmount
		set["apply_gst"] = nextApplyGST
		set["gst_percent"] = normalizedGSTPercent(nextApplyGST, nextGSTPercent)
		set["subtotal_amount"] = subtotal
		set["gst_amount"] = gstAmount
		set["total_amount"] = finalTotal
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var q models.Quotation
	err = quotationCol().FindOneAndUpdate(
		context.Background(),
		bson.M{"quotation_id": quotationID},
		bson.M{"$set": set},
		opts,
	).Decode(&q)

	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &q, err
}

func subtotalOrExisting(subtotalAmount, totalAmount, gstAmount, discountAmount float64) float64 {
	if subtotalAmount > 0 {
		return subtotalAmount
	}
	return roundQuotationMoney(totalAmount - gstAmount + discountAmount)
}

// UpdateQuotationStatus transitions a quotation to a new status.
func UpdateQuotationStatus(quotationID string, status models.QuotationStatus) (*models.Quotation, error) {
	validStatuses := map[models.QuotationStatus]bool{
		models.QuotationDraft:    true,
		models.QuotationSent:     true,
		models.QuotationAccepted: true,
		models.QuotationRejected: true,
		models.QuotationExpired:  true,
	}
	if !validStatuses[status] {
		return nil, fmt.Errorf("invalid status: %s", status)
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var q models.Quotation
	err := quotationCol().FindOneAndUpdate(
		context.Background(),
		bson.M{"quotation_id": quotationID},
		bson.M{"$set": bson.M{"status": status, "updated_at": time.Now()}},
		opts,
	).Decode(&q)

	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &q, err
}

// MarkConverted writes the project ID back to the quotation after conversion.
func MarkConverted(quotationID, projectID string) error {
	res, err := quotationCol().UpdateOne(
		context.Background(),
		bson.M{"quotation_id": quotationID},
		bson.M{"$set": bson.M{
			"converted_project_id": projectID,
			"status":               models.QuotationAccepted,
			"updated_at":           time.Now(),
		}},
	)
	if err != nil {
		return err
	}
	if res.MatchedCount == 0 {
		return fmt.Errorf("quotation not found")
	}
	return nil
}

// DeleteQuotation permanently deletes a draft quotation.
func DeleteQuotation(quotationID string) error {
	res, err := quotationCol().DeleteOne(
		context.Background(),
		bson.M{"quotation_id": quotationID, "status": models.QuotationDraft},
	)
	if err != nil {
		return err
	}
	if res.DeletedCount == 0 {
		return fmt.Errorf("draft quotation not found")
	}
	return nil
}
