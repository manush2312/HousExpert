// Command migrate-suppliers backfills the supplier master (vendors) from the
// free-text supplier strings that existed before suppliers became a managed
// list, and canonicalizes those strings so per-supplier stock buckets stop
// fragmenting on casing/spacing differences.
//
// It scans three sources:
//   - inventory_items.supplier and inventory_items.vendor_pricing[].supplier_name
//   - inventory_stock_lots.supplier_bucket
//   - inventory_movements.supplier_bucket
//
// For every distinct supplier name it ensures a Vendor exists, then rewrites the
// scanned fields to the vendor's canonical casing. Display-only sentinels
// ("Unassigned stock", "Multiple lots") are left untouched.
//
// Usage (from the backend/ directory):
//
//	go run ./cmd/migrate-suppliers          # dry run — reports what it WOULD do
//	go run ./cmd/migrate-suppliers -apply   # actually create vendors + rewrite
//
// It reads the same .env as the server (MONGO_URI etc.) and is safe to re-run.
package main

import (
	"context"
	"flag"
	"log"
	"os"
	"sort"
	"strings"

	"github.com/joho/godotenv"
	"go.mongodb.org/mongo-driver/bson"

	"housexpert/backend/internal/database"
	"housexpert/backend/internal/models"
	"housexpert/backend/internal/services"
)

// sentinels are display-only supplier labels that must never become vendors.
var sentinels = map[string]bool{
	"unassigned stock": true,
	"multiple lots":    true,
}

func normKey(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func main() {
	apply := flag.Bool("apply", false, "actually create vendors and rewrite records (default: dry run)")
	flag.Parse()

	loadEnv()
	database.Connect()
	ctx := context.Background()

	// ── 1. Collect distinct supplier names with a representative casing ──────────
	names := map[string]string{} // name_key → first-seen display name
	counts := map[string]int{}   // name_key → occurrences (for the report)

	record := func(raw string) {
		v := strings.TrimSpace(raw)
		if v == "" || sentinels[normKey(v)] {
			return
		}
		k := normKey(v)
		counts[k]++
		if _, ok := names[k]; !ok {
			names[k] = v
		}
	}

	var items []models.InventoryItem
	if err := findAll(ctx, "inventory_items", &items); err != nil {
		log.Fatalf("read inventory_items: %v", err)
	}
	for _, it := range items {
		record(it.Supplier)
		for _, vp := range it.VendorPricing {
			record(vp.SupplierName)
		}
	}

	var lots []models.InventoryStockLot
	if err := findAll(ctx, "inventory_stock_lots", &lots); err != nil {
		log.Fatalf("read inventory_stock_lots: %v", err)
	}
	for _, lot := range lots {
		record(lot.SupplierBucket)
	}

	var movements []models.InventoryMovement
	if err := findAll(ctx, "inventory_movements", &movements); err != nil {
		log.Fatalf("read inventory_movements: %v", err)
	}
	for _, mv := range movements {
		record(mv.SupplierBucket)
	}

	if len(names) == 0 {
		log.Println("No supplier names found in inventory data — nothing to migrate.")
		return
	}

	// ── 2. Resolve a canonical name per key (existing vendor wins) ───────────────
	canonical := map[string]string{} // name_key → canonical display name
	missing := make([]string, 0)     // keys with no vendor yet
	for k, display := range names {
		if v := findVendorByKey(ctx, k); v != nil {
			canonical[k] = v.Name
			continue
		}
		canonical[k] = display
		missing = append(missing, k)
	}
	sort.Strings(missing)

	mode := "DRY RUN"
	if *apply {
		mode = "APPLY"
	}
	log.Printf("── Supplier migration (%s) ──", mode)
	log.Printf("Distinct supplier names: %d (%d already in master, %d to create)",
		len(names), len(names)-len(missing), len(missing))

	// ── 3. Create the missing vendors ───────────────────────────────────────────
	created := 0
	for _, k := range missing {
		display := names[k]
		if !*apply {
			log.Printf("  would create vendor: %q (%d references)", display, counts[k])
			continue
		}
		v, err := services.CreateVendor(services.CreateVendorInput{Name: display})
		if err != nil {
			log.Printf("  ⚠️  create vendor %q failed: %v", display, err)
			continue
		}
		canonical[k] = v.Name
		created++
		log.Printf("  created %s: %q", v.VendorID, v.Name)
	}

	// ── 4. Rewrite the scanned fields to canonical casing ───────────────────────
	itemRewrites := rewriteItems(ctx, items, canonical, *apply)
	lotRewrites := rewriteLots(ctx, lots, canonical, *apply)
	movementRewrites := rewriteMovements(ctx, movements, canonical, *apply)

	log.Printf("── Summary (%s) ──", mode)
	log.Printf("Vendors created: %d", created)
	log.Printf("Records %s: items=%d, stock lots=%d, movements=%d",
		verb(*apply), itemRewrites, lotRewrites, movementRewrites)
	if !*apply {
		log.Println("Dry run only — re-run with -apply to write these changes.")
	}
}

// canonicalFor returns the canonical name for a raw supplier value, or "" when it
// should be left as-is (empty, a sentinel, unknown, or already canonical).
func canonicalFor(canonical map[string]string, raw string) (string, bool) {
	v := strings.TrimSpace(raw)
	if v == "" || sentinels[normKey(v)] {
		return "", false
	}
	next, ok := canonical[normKey(v)]
	if !ok || next == "" || next == raw {
		return "", false
	}
	return next, true
}

func rewriteItems(ctx context.Context, items []models.InventoryItem, canonical map[string]string, apply bool) int {
	rewrites := 0
	for _, it := range items {
		set := bson.M{}
		if next, ok := canonicalFor(canonical, it.Supplier); ok {
			set["supplier"] = next
		}
		vps := it.VendorPricing
		changedVP := false
		for i := range vps {
			if next, ok := canonicalFor(canonical, vps[i].SupplierName); ok {
				vps[i].SupplierName = next
				changedVP = true
			}
		}
		if changedVP {
			set["vendor_pricing"] = vps
		}
		if len(set) == 0 {
			continue
		}
		rewrites++
		if apply {
			if _, err := database.Collection("inventory_items").UpdateOne(ctx, bson.M{"_id": it.ID}, bson.M{"$set": set}); err != nil {
				log.Printf("  ⚠️  rewrite item %s failed: %v", it.ItemID, err)
			}
		}
	}
	return rewrites
}

func rewriteLots(ctx context.Context, lots []models.InventoryStockLot, canonical map[string]string, apply bool) int {
	rewrites := 0
	for _, lot := range lots {
		next, ok := canonicalFor(canonical, lot.SupplierBucket)
		if !ok {
			continue
		}
		rewrites++
		if apply {
			if _, err := database.Collection("inventory_stock_lots").UpdateOne(ctx, bson.M{"_id": lot.ID}, bson.M{"$set": bson.M{"supplier_bucket": next}}); err != nil {
				log.Printf("  ⚠️  rewrite lot %s failed: %v", lot.LotID, err)
			}
		}
	}
	return rewrites
}

func rewriteMovements(ctx context.Context, movements []models.InventoryMovement, canonical map[string]string, apply bool) int {
	rewrites := 0
	for _, mv := range movements {
		next, ok := canonicalFor(canonical, mv.SupplierBucket)
		if !ok {
			continue
		}
		rewrites++
		if apply {
			if _, err := database.Collection("inventory_movements").UpdateOne(ctx, bson.M{"_id": mv.ID}, bson.M{"$set": bson.M{"supplier_bucket": next}}); err != nil {
				log.Printf("  ⚠️  rewrite movement %s failed: %v", mv.MovementID, err)
			}
		}
	}
	return rewrites
}

func findAll(ctx context.Context, collection string, out interface{}) error {
	cur, err := database.Collection(collection).Find(ctx, bson.M{})
	if err != nil {
		return err
	}
	defer cur.Close(ctx)
	return cur.All(ctx, out)
}

func findVendorByKey(ctx context.Context, key string) *models.Vendor {
	var v models.Vendor
	if err := database.Collection("vendors").FindOne(ctx, bson.M{"name_key": key}).Decode(&v); err != nil {
		return nil
	}
	return &v
}

func verb(apply bool) string {
	if apply {
		return "rewritten"
	}
	return "to rewrite"
}

func loadEnv() {
	envFile := os.Getenv("ENV_FILE")
	if envFile == "" {
		envFile = ".env"
	}
	if err := godotenv.Load(envFile); err != nil {
		if fallbackErr := godotenv.Load("backend/.env"); fallbackErr != nil {
			log.Println("No .env file found, using environment variables")
		}
	}
}
