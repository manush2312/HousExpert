package services

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"housexpert/backend/internal/database"
	"housexpert/backend/internal/models"
	"housexpert/backend/internal/utils"
)

// ── Input types ──────────────────────────────────────────────────────────────

type CreateVendorInput struct {
	Name             string   `json:"name" binding:"required"`
	GSTIN            string   `json:"gstin"`
	Mobile           string   `json:"mobile"`
	Email            string   `json:"email"`
	Address          string   `json:"address"`
	CategoriesServed []string `json:"categories_served"`
	Notes            string   `json:"notes"`
	Status           string   `json:"status"`
	CreatedBy        string   `json:"-"` // employee OID hex, set from auth context
}

type UpdateVendorInput struct {
	Name             *string   `json:"name"`
	GSTIN            *string   `json:"gstin"`
	Mobile           *string   `json:"mobile"`
	Email            *string   `json:"email"`
	Address          *string   `json:"address"`
	CategoriesServed *[]string `json:"categories_served"`
	Notes            *string   `json:"notes"`
	Status           *string   `json:"status"`
}

// ErrVendorNameTaken is returned when a vendor with the same (case-insensitive)
// name already exists.
var ErrVendorNameTaken = errors.New("a supplier with this name already exists")

// ── Collection helper ─────────────────────────────────────────────────────────

func vendorCol() *mongo.Collection {
	return database.Collection("vendors")
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// vendorNameKey normalizes a supplier name for case-insensitive matching.
func vendorNameKey(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

// normalizeCategories trims, de-dupes (case-insensitive) and drops empties,
// preserving the original casing of the first occurrence.
func normalizeCategories(categories []string) []string {
	seen := make(map[string]bool, len(categories))
	out := make([]string, 0, len(categories))
	for _, c := range categories {
		trimmed := strings.TrimSpace(c)
		if trimmed == "" {
			continue
		}
		key := strings.ToLower(trimmed)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, trimmed)
	}
	return out
}

// vendorCreatorOID parses an employee OID hex, returning the zero ObjectID when
// the value is empty or malformed (e.g. seeded data with no auth context).
func vendorCreatorOID(hex string) primitive.ObjectID {
	oid, err := primitive.ObjectIDFromHex(strings.TrimSpace(hex))
	if err != nil {
		return primitive.NilObjectID
	}
	return oid
}

func normalizeVendorStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "inactive":
		return "inactive"
	default:
		return "active"
	}
}

// ── Service functions ─────────────────────────────────────────────────────────

// CreateVendor inserts a new supplier and assigns a VND-XXX ID. Names are unique
// (case-insensitive) so the supplier list stays a clean set of canonical names.
func CreateVendor(input CreateVendorInput) (*models.Vendor, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return nil, fmt.Errorf("name is required")
	}
	nameKey := vendorNameKey(name)

	// Guard against duplicates before spending a counter value.
	existing, err := vendorCol().CountDocuments(context.Background(), bson.M{"name_key": nameKey})
	if err != nil {
		return nil, err
	}
	if existing > 0 {
		return nil, ErrVendorNameTaken
	}

	vendorID, err := utils.NextID("vendor")
	if err != nil {
		return nil, fmt.Errorf("id generation failed: %w", err)
	}

	now := time.Now()
	vendor := &models.Vendor{
		VendorID:         vendorID,
		Name:             name,
		NameKey:          nameKey,
		GSTIN:            strings.TrimSpace(input.GSTIN),
		Mobile:           strings.TrimSpace(input.Mobile),
		Email:            strings.TrimSpace(input.Email),
		Address:          strings.TrimSpace(input.Address),
		CategoriesServed: normalizeCategories(input.CategoriesServed),
		Notes:            strings.TrimSpace(input.Notes),
		Status:           normalizeVendorStatus(input.Status),
		CreatedBy:        vendorCreatorOID(input.CreatedBy),
		CreatedAt:        now,
		UpdatedAt:        now,
	}

	if _, err = vendorCol().InsertOne(context.Background(), vendor); err != nil {
		if mongo.IsDuplicateKeyError(err) {
			return nil, ErrVendorNameTaken
		}
		return nil, fmt.Errorf("insert failed: %w", err)
	}
	return vendor, nil
}

// VendorFilter narrows the vendor list.
type VendorFilter struct {
	Category string // only vendors serving this category
	Status   string // "active" / "inactive" / "" (all)
}

// ListVendors returns suppliers sorted by name, optionally filtered by the
// category they serve and/or their status.
func ListVendors(filter VendorFilter) ([]models.Vendor, error) {
	ctx := context.Background()
	query := bson.M{}
	if cat := strings.TrimSpace(filter.Category); cat != "" {
		// Case-insensitive exact match on any served category.
		query["categories_served"] = bson.M{
			"$elemMatch": bson.M{"$regex": "^" + regexp.QuoteMeta(cat) + "$", "$options": "i"},
		}
	}
	if status := strings.TrimSpace(filter.Status); status != "" {
		query["status"] = normalizeVendorStatus(status)
	}

	cursor, err := vendorCol().Find(ctx, query, &options.FindOptions{
		Sort: bson.D{{Key: "name", Value: 1}},
	})
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var vendors []models.Vendor
	if err := cursor.All(ctx, &vendors); err != nil {
		return nil, err
	}
	if vendors == nil {
		vendors = []models.Vendor{}
	}
	return vendors, nil
}

// canonicalSupplierName resolves a free-text supplier name to the canonical
// casing stored in the vendor master (matching case-insensitively). Unknown
// names are returned trimmed as-is, so existing free-text data, seeds and
// imports keep working while dropdown-entered names collapse onto one bucket.
func canonicalSupplierName(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return ""
	}
	var vendor models.Vendor
	err := vendorCol().FindOne(
		context.Background(),
		bson.M{"name_key": vendorNameKey(trimmed)},
	).Decode(&vendor)
	if err != nil {
		return trimmed
	}
	return vendor.Name
}

// EnsureVendorsFromInventoryData backfills the supplier master from supplier
// names already present in inventory data (item suppliers, per-vendor pricing
// rows, stock-lot buckets and movement buckets). It ONLY creates missing
// vendors and never modifies existing inventory records, so it is safe and
// idempotent to run on every server startup — the first deploy that includes
// the supplier master automatically registers whatever suppliers were typed
// before the feature existed. Returns the number of vendors created.
func EnsureVendorsFromInventoryData() (int, error) {
	ctx := context.Background()

	names := map[string]string{} // name_key → first-seen display name
	record := func(raw string) {
		v := strings.TrimSpace(raw)
		if v == "" {
			return
		}
		key := vendorNameKey(v)
		// Skip display-only sentinels — they are labels, not suppliers.
		if key == "unassigned stock" || key == "multiple lots" {
			return
		}
		if _, ok := names[key]; !ok {
			names[key] = v
		}
	}

	var items []models.InventoryItem
	if cur, err := database.Collection("inventory_items").Find(ctx, bson.M{}); err == nil {
		_ = cur.All(ctx, &items)
	}
	for _, it := range items {
		record(it.Supplier)
		for _, vp := range it.VendorPricing {
			record(vp.SupplierName)
		}
	}

	var lots []models.InventoryStockLot
	if cur, err := database.Collection("inventory_stock_lots").Find(ctx, bson.M{}); err == nil {
		_ = cur.All(ctx, &lots)
	}
	for _, lot := range lots {
		record(lot.SupplierBucket)
	}

	var movements []models.InventoryMovement
	if cur, err := database.Collection("inventory_movements").Find(ctx, bson.M{}); err == nil {
		_ = cur.All(ctx, &movements)
	}
	for _, mv := range movements {
		record(mv.SupplierBucket)
	}

	created := 0
	for _, display := range names {
		if IsKnownSupplier(display) {
			continue
		}
		if _, err := CreateVendor(CreateVendorInput{Name: display}); err != nil {
			if errors.Is(err, ErrVendorNameTaken) {
				continue // created concurrently or casing-dup — fine
			}
			return created, err
		}
		created++
	}
	return created, nil
}

// IsKnownSupplier reports whether the given name matches a supplier in the
// master (case-insensitive). Used to validate supplier-dimension pricing rows.
func IsKnownSupplier(name string) bool {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return false
	}
	count, err := vendorCol().CountDocuments(
		context.Background(),
		bson.M{"name_key": vendorNameKey(trimmed)},
	)
	if err != nil {
		return false
	}
	return count > 0
}

// GetVendor fetches a supplier by vendor_id (e.g. "VND-001").
func GetVendor(vendorID string) (*models.Vendor, error) {
	var vendor models.Vendor
	err := vendorCol().FindOne(context.Background(), bson.M{"vendor_id": vendorID}).Decode(&vendor)
	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &vendor, err
}

// UpdateVendor patches the supplied fields. Renaming re-checks uniqueness.
func UpdateVendor(vendorID string, input UpdateVendorInput) (*models.Vendor, error) {
	set := bson.M{"updated_at": time.Now()}

	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			return nil, fmt.Errorf("name cannot be empty")
		}
		nameKey := vendorNameKey(name)
		// Ensure no other vendor already owns this name.
		count, err := vendorCol().CountDocuments(context.Background(), bson.M{
			"name_key":  nameKey,
			"vendor_id": bson.M{"$ne": vendorID},
		})
		if err != nil {
			return nil, err
		}
		if count > 0 {
			return nil, ErrVendorNameTaken
		}
		set["name"] = name
		set["name_key"] = nameKey
	}
	if input.GSTIN != nil {
		set["gstin"] = strings.TrimSpace(*input.GSTIN)
	}
	if input.Mobile != nil {
		set["mobile"] = strings.TrimSpace(*input.Mobile)
	}
	if input.Email != nil {
		set["email"] = strings.TrimSpace(*input.Email)
	}
	if input.Address != nil {
		set["address"] = strings.TrimSpace(*input.Address)
	}
	if input.CategoriesServed != nil {
		set["categories_served"] = normalizeCategories(*input.CategoriesServed)
	}
	if input.Notes != nil {
		set["notes"] = strings.TrimSpace(*input.Notes)
	}
	if input.Status != nil {
		set["status"] = normalizeVendorStatus(*input.Status)
	}

	opts := options.FindOneAndUpdate().SetReturnDocument(options.After)
	var vendor models.Vendor
	err := vendorCol().FindOneAndUpdate(
		context.Background(),
		bson.M{"vendor_id": vendorID},
		bson.M{"$set": set},
		opts,
	).Decode(&vendor)

	if errors.Is(err, mongo.ErrNoDocuments) {
		return nil, nil
	}
	return &vendor, err
}

// DeleteVendor permanently removes a supplier. Callers should prefer setting the
// status to "inactive" once vendors are referenced by inventory/log records.
func DeleteVendor(vendorID string) error {
	res, err := vendorCol().DeleteOne(context.Background(), bson.M{"vendor_id": vendorID})
	if err != nil {
		return err
	}
	if res.DeletedCount == 0 {
		return fmt.Errorf("vendor not found")
	}
	return nil
}
