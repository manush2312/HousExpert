package handlers

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/phpdave11/gofpdf"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo/options"

	"housexpert/backend/internal/database"
	"housexpert/backend/internal/models"
	"housexpert/backend/internal/services"
	"housexpert/backend/internal/utils"
)

func RegisterExportRoutes(r *gin.RouterGroup) {
	r.GET("/projects/:id/export-logs", exportLogsPDF)
	r.GET("/quotations/:id/export", exportQuotationPDF)
}

// ── Handler ───────────────────────────────────────────────────────────────────

func exportLogsPDF(c *gin.Context) {
	project, err := services.GetProject(c.Param("id"))
	if err != nil || project == nil {
		utils.NotFound(c, "project not found")
		return
	}

	filter := services.LogEntryFilter{
		LogTypeID: c.Query("log_type_id"),
		LogDate:   c.Query("date"),
	}
	entries, err := listEntriesForExport(project.ID, filter)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}

	// Text search in Go (mirrors frontend behaviour)
	q := strings.ToLower(strings.TrimSpace(c.Query("q")))
	if q != "" {
		kept := entries[:0]
		for _, e := range entries {
			var vals []string
			vals = append(vals, strings.ToLower(e.LogTypeName))
			vals = append(vals, strings.ToLower(e.CategoryName))
			vals = append(vals, strings.ToLower(e.Notes))
			for _, f := range e.Fields {
				vals = append(vals, strings.ToLower(fmt.Sprintf("%v", f.Value)))
			}
			if strings.Contains(strings.Join(vals, " "), q) {
				kept = append(kept, e)
			}
		}
		entries = kept
	}

	logTypeName := c.Query("log_type_name")
	dateFilter := c.Query("date")
	buf, err := buildPDF(project, entries, logTypeName, dateFilter, q)
	if err != nil {
		utils.InternalError(c, "pdf generation failed: "+err.Error())
		return
	}

	filename := fmt.Sprintf("%s-logs-%s.pdf", project.ProjectID, time.Now().Format("2006-01-02"))
	c.Header("Content-Disposition", "attachment; filename="+filename)
	c.Header("Content-Type", "application/pdf")
	c.Header("Content-Length", fmt.Sprintf("%d", buf.Len()))
	c.Data(200, "application/pdf", buf.Bytes())
}

// listEntriesForExport fetches entries without the service layer's response wrapper.
func listEntriesForExport(projectID primitive.ObjectID, filter services.LogEntryFilter) ([]models.LogEntry, error) {
	query := bson.M{"project_id": projectID}
	if filter.LogTypeID != "" {
		if oid, err := primitive.ObjectIDFromHex(filter.LogTypeID); err == nil {
			query["log_type_id"] = oid
		}
	}
	if filter.LogDate != "" {
		if t, err := time.Parse("2006-01-02", filter.LogDate); err == nil {
			start := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
			query["log_date"] = bson.M{"$gte": start, "$lt": start.Add(24 * time.Hour)}
		}
	}
	col := database.Collection("log_entries")
	opts := options.Find().SetSort(bson.D{{Key: "log_date", Value: -1}, {Key: "created_at", Value: -1}})
	cursor, err := col.Find(context.Background(), query, opts)
	if err != nil {
		return nil, err
	}
	var entries []models.LogEntry
	if err := cursor.All(context.Background(), &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

// ── Colors ────────────────────────────────────────────────────────────────────

type rgb struct{ r, g, b int }

var (
	cINK    = rgb{30, 28, 40}
	cINK2   = rgb{74, 72, 90}
	cINK3   = rgb{120, 118, 132}
	cINK4   = rgb{170, 168, 180}
	cINK5   = rgb{216, 215, 220}
	cBGSUN  = rgb{244, 243, 247}
	cLINE   = rgb{230, 229, 234}
	cLINE2  = rgb{239, 238, 243}
)

// ── Layout constants ──────────────────────────────────────────────────────────

type col struct{ x, w float64 }

const (
	pw      = 297.0        // A4 landscape width mm
	ph      = 210.0        // A4 landscape height mm
	ml      = 14.0         // left margin
	mr      = 14.0         // right margin
	cw      = pw - ml - mr // 269mm content width
	rowH    = 11.0         // data row height
	headerH = 7.5          // column-header row height
	dateH   = 8.0          // date-group row height
	padX    = 3.0          // horizontal cell padding
	cellH   = 5.0          // standard single-line cell height (matches font size)
)

// Column x positions are measured from the left edge of the page.
// Total width: 40+52+18+28+62+42+27 = 269mm = cw ✓
var tableCols = struct {
	logType, entry, qty, cost, keyVals, notes, loggedBy col
}{
	logType:  col{ml, 40},
	entry:    col{ml + 40, 52},
	qty:      col{ml + 92, 18},
	cost:     col{ml + 110, 28},
	keyVals:  col{ml + 138, 62},
	notes:    col{ml + 200, 42},
	loggedBy: col{ml + 242, 27},
}

// ── PDF writer ────────────────────────────────────────────────────────────────

type pdfWriter struct {
	doc      *gofpdf.Fpdf
	font     string
	rupee    string // "₹" with NotoSans, "Rs." with Helvetica
	dash     string // "—" with NotoSans, "-" with Helvetica
	logoPath string // empty = use initials box fallback
}

func newPDFWriter() *pdfWriter {
	doc := gofpdf.NewCustom(&gofpdf.InitType{
		OrientationStr: "L",
		UnitStr:        "mm",
		SizeStr:        "A4",
	})
	doc.SetMargins(ml, 12, mr)
	doc.SetAutoPageBreak(true, 14)
	p := &pdfWriter{doc: doc, font: "Helvetica", rupee: "Rs.", dash: "-"}
	p.loadFonts()
	p.findLogo()
	return p
}

// findLogo looks for a logo image file in common locations.
func (p *pdfWriter) findLogo() {
	candidates := []string{
		os.Getenv("LOGO_PATH"),
		"./assets/logo.png",
		"./assets/logo.jpg",
		"./logo.png",
	}
	for _, path := range candidates {
		if path == "" {
			continue
		}
		if _, err := os.Stat(path); err == nil {
			p.logoPath = path
			return
		}
	}
}

// drawLogo renders the company logo at (x, y) within a 20×20 mm box.
// Falls back to a dark initials box if no image file is found.
func (p *pdfWriter) drawLogo(x, y float64) {
	doc := p.doc
	const sz = 20.0
	if p.logoPath != "" {
		doc.ImageOptions(p.logoPath, x, y, sz, sz, false, gofpdf.ImageOptions{}, 0, "")
		return
	}
	// Fallback: dark box with "HX" initials
	p.setFill(cINK)
	doc.Rect(x, y, sz, sz, "F")
	doc.SetTextColor(255, 255, 255)
	p.setFont("B", 11)
	doc.SetXY(x, y+(sz-5)/2)
	doc.CellFormat(sz, 5, "HX", "", 0, "C", false, 0, "")
	p.setColor(cINK) // restore text color
}

func (p *pdfWriter) loadFonts() {
	fontDir := os.Getenv("FONT_DIR")
	if fontDir == "" {
		fontDir = "./fonts"
	}
	regBytes, err := os.ReadFile(fontDir + "/NotoSans-Regular.ttf")
	if err != nil {
		return // keep Helvetica fallback
	}
	p.doc.AddUTF8FontFromBytes("NotoSans", "", regBytes)
	boldBytes, err := os.ReadFile(fontDir + "/NotoSans-Bold.ttf")
	if err != nil {
		p.doc.AddUTF8FontFromBytes("NotoSans", "B", regBytes) // use regular as bold fallback
	} else {
		p.doc.AddUTF8FontFromBytes("NotoSans", "B", boldBytes)
	}
	p.font = "NotoSans"
	p.rupee = "₹"
	p.dash = "—"
}

func (p *pdfWriter) setColor(c rgb) { p.doc.SetTextColor(c.r, c.g, c.b) }
func (p *pdfWriter) setFill(c rgb)  { p.doc.SetFillColor(c.r, c.g, c.b) }
func (p *pdfWriter) setDraw(c rgb)  { p.doc.SetDrawColor(c.r, c.g, c.b) }

func (p *pdfWriter) setFont(style string, size float64) {
	p.doc.SetFont(p.font, style, size)
}

// truncate clips text so it fits within maxWidth mm at the current font size.
func (p *pdfWriter) truncate(text string, maxWidth float64) string {
	if p.doc.GetStringWidth(text) <= maxWidth {
		return text
	}
	runes := []rune(text)
	for i := len(runes) - 1; i > 0; i-- {
		s := string(runes[:i]) + "…"
		if p.doc.GetStringWidth(s) <= maxWidth {
			return s
		}
	}
	return ""
}

// cell renders a single line of text at (x, y) using the standard cell height.
// gofpdf centers text vertically within the cell height, so the text sits at y + cellH/2.
func (p *pdfWriter) cell(x, y, w float64, text, align string) {
	p.doc.SetXY(x, y)
	p.doc.CellFormat(w, cellH, text, "", 0, align, false, 0, "")
}

// hLine draws a horizontal rule across the full content width at y.
func (p *pdfWriter) hLine(y float64, c rgb, lw float64) {
	p.setDraw(c)
	p.doc.SetLineWidth(lw)
	p.doc.Line(ml, y, ml+cw, y)
}

// ── Page header ───────────────────────────────────────────────────────────────
//
// Layout (all y values from top of page):
//
//	y=12  ▓▓▓▓▓▓▓▓▓▓▓▓▓  2 mm accent bar
//	y=17  HouseXpert            DAILY LOG REPORT
//	y=24  Your Complete…        Project:  XYZ
//	                            Location: Mumbai, MH
//	                            Generated: 23 Apr 2026
//	                            …
//	y=yB  ─────────────────────── divider ────────────────────
//	y=yB+3  ← table starts
func (p *pdfWriter) drawPageHeader(project *models.Project, logTypeName, dateFilter, q string, total int) {
	doc := p.doc

	// Accent bar across full content width (dark charcoal, no purple)
	p.setFill(cINK)
	doc.Rect(ml, 12, cw, 2, "F")

	y := 17.0

	// ── Left: logo + brand block ───────────────────────────────────────────────
	p.drawLogo(ml, y) // 20×20 mm logo box at left edge

	// Vertically center the two-line text block (7+4=11mm) within the 20mm logo
	const textOffsetY = (20.0 - 11.0) / 2 // 4.5mm from logo top
	p.setFont("B", 13)
	p.setColor(cINK)
	doc.SetXY(ml+23, y+textOffsetY)
	doc.CellFormat(67, 7, "HouseXpert", "", 0, "L", false, 0, "")

	p.setFont("", 7.5)
	p.setColor(cINK3)
	doc.SetXY(ml+23, y+textOffsetY+7)
	doc.CellFormat(67, 4, "Your Complete Home Solution", "", 0, "L", false, 0, "")

	// ── Right: report title + meta ─────────────────────────────────────────────
	const (
		divX   = 108.0               // vertical separator line x
		rightX = divX + 5            // meta block starts here
		rightW = (pw - mr) - rightX  // 283 - 113 = 170mm
	)

	p.setFont("B", 10)
	p.setColor(cINK)
	doc.SetXY(rightX, y)
	doc.CellFormat(rightW, 7, "DAILY LOG REPORT", "", 0, "L", false, 0, "")

	// Build meta pairs
	location := project.Address.City
	if project.Address.State != "" {
		if location != "" {
			location += ", "
		}
		location += project.Address.State
	}
	if location == "" {
		location = p.dash
	}
	meta := [][2]string{
		{"Project", project.Name},
		{"Location", location},
		{"Generated", time.Now().Format("2 Jan 2006, 15:04")},
		{"Total entries", fmt.Sprintf("%d", total)},
	}
	if logTypeName != "" {
		meta = append(meta, [2]string{"Log type", logTypeName})
	}
	if dateFilter != "" {
		if t, err := time.Parse("2006-01-02", dateFilter); err == nil {
			meta = append(meta, [2]string{"Date", t.Format("2 Jan 2006")})
		}
	}
	if q != "" {
		meta = append(meta, [2]string{"Search", q})
	}

	const (
		metaLW = 26.0 // label column width
		metaRH = 4.2  // row height
	)
	for i, row := range meta {
		ry := y + 7 + float64(i)*metaRH
		p.setFont("", 7)
		p.setColor(cINK4)
		doc.SetXY(rightX, ry)
		doc.CellFormat(metaLW, 4, row[0]+":", "", 0, "L", false, 0, "")

		p.setFont("B", 7)
		p.setColor(cINK2)
		doc.SetXY(rightX+metaLW, ry)
		doc.CellFormat(rightW-metaLW, 4, p.truncate(row[1], rightW-metaLW-1), "", 0, "L", false, 0, "")
	}

	// Vertical separator between brand and report info
	yBottom := y + 7 + float64(len(meta))*metaRH + 3
	if yBottom < 44 {
		yBottom = 44 // minimum header height
	}
	p.setDraw(cLINE)
	doc.SetLineWidth(0.3)
	doc.Line(divX, y, divX, yBottom-3)

	// Bottom divider before table
	p.hLine(yBottom, cLINE, 0.4)
	doc.SetY(yBottom + 3)
}

// ── Table column header ───────────────────────────────────────────────────────

func (p *pdfWriter) drawTableHeader() {
	doc := p.doc
	y := doc.GetY()

	// Background + borders
	p.setFill(cINK5)
	doc.Rect(ml, y, cw, headerH, "F")
	p.hLine(y, cLINE, 0.3)
	p.hLine(y+headerH, cLINE, 0.4)

	// Vertically center text within the header cell
	ty := y + (headerH-cellH)/2

	type thDef struct {
		c     col
		label string
		align string
	}
	headers := []thDef{
		{tableCols.logType, "TYPE", "L"},
		{tableCols.entry, "ENTRY", "L"},
		{tableCols.qty, "QTY", "R"},
		{tableCols.cost, "TOTAL COST", "R"},
		{tableCols.keyVals, "KEY VALUES", "L"},
		{tableCols.notes, "NOTES", "L"},
		{tableCols.loggedBy, "LOGGED BY", "L"},
	}

	p.setFont("B", 7)
	p.setColor(cINK2)

	for _, h := range headers {
		if h.align == "R" {
			p.cell(h.c.x, ty, h.c.w-padX, h.label, "R")
		} else {
			p.cell(h.c.x+padX, ty, h.c.w-padX, h.label, "L")
		}
	}

	doc.SetXY(ml, y+headerH)
}

// ── Date group row ────────────────────────────────────────────────────────────

func (p *pdfWriter) drawDateRow(dateKey string, count int) {
	doc := p.doc
	y := doc.GetY()

	// Full-width background + borders
	p.setFill(cLINE2)
	doc.Rect(ml, y, cw, dateH, "F")
	p.hLine(y, cINK5, 0.3)
	p.hLine(y+dateH, cLINE, 0.2)

	// Vertically center text within dateH
	ty := y + (dateH-cellH)/2

	if t, err := time.Parse("2006-01-02", dateKey); err == nil {
		p.setFont("B", 8.5)
		p.setColor(cINK2)
		p.cell(ml+padX, ty, 130, t.Format("Monday, 2 January 2006"), "L")
	}

	countLabel := fmt.Sprintf("%d %s", count, pluralise("entry", "entries", count))
	p.setFont("", 7.5)
	p.setColor(cINK3)
	p.cell(ml+padX, ty, cw-padX*2, countLabel, "R")

	doc.SetXY(ml, y+dateH)
}

// ── Data row ──────────────────────────────────────────────────────────────────
//
// Vertical alignment within rowH=11mm, cellH=5mm:
//
//	line1Y  = y+1   → cell [y+1,  y+6 ], text center at y+3.5  (top half)
//	line2Y  = y+6   → cell [y+6,  y+11], text center at y+8.5  (bottom half)
//	singleY = y+3   → cell [y+3,  y+8 ], text center at y+5.5  (vertically centered)
func (p *pdfWriter) drawDataRow(entry models.LogEntry, shade bool) {
	doc := p.doc
	y := doc.GetY()

	if shade {
		p.setFill(cBGSUN)
		doc.Rect(ml, y, cw, rowH, "F")
	}
	p.hLine(y+rowH, cLINE2, 0.15)

	line1Y := y + 1.0
	line2Y := y + 1.0 + cellH // y + 6
	singleY := y + (rowH-cellH)/2.0 // y + 3

	// ── Type + Category ────────────────────────────────────────────────────────
	tc := tableCols.logType
	p.setFont("B", 8.5)
	p.setColor(cINK)
	p.cell(tc.x+padX, line1Y, tc.w-padX*2, p.truncate(entry.LogTypeName, tc.w-padX*2), "L")

	p.setFont("", 7)
	p.setColor(cINK4)
	p.cell(tc.x+padX, line2Y, tc.w-padX*2, p.truncate(entry.CategoryName, tc.w-padX*2), "L")

	// ── Entry: item name + source badge ────────────────────────────────────────
	ec := tableCols.entry
	primary := buildPrimary(entry)
	secondary := buildSecondary(entry)

	p.setFont("B", 8.5)
	p.setColor(cINK)
	p.cell(ec.x+padX, line1Y, ec.w-padX*2, p.truncate(primary, ec.w-padX*2), "L")

	p.setFont("", 7)
	p.setColor(cINK4)
	p.cell(ec.x+padX, line2Y, ec.w-padX*2, p.truncate(secondary, ec.w-padX*2), "L")

	// ── Quantity ───────────────────────────────────────────────────────────────
	qc := tableCols.qty
	p.setFont("", 8.5)
	if entry.Quantity != nil {
		p.setColor(cINK2)
		p.cell(qc.x, singleY, qc.w-padX, formatNum(*entry.Quantity), "R")
	} else {
		p.setColor(cINK5)
		p.cell(qc.x, singleY, qc.w-padX, p.dash, "R")
	}

	// ── Total cost ─────────────────────────────────────────────────────────────
	cc := tableCols.cost
	if entry.TotalCost != nil && *entry.TotalCost > 0 {
		p.setFont("B", 8.5)
		p.setColor(cINK2)
		p.cell(cc.x, singleY, cc.w-padX, p.rupee+" "+formatNum(*entry.TotalCost), "R")
	} else {
		p.setFont("", 8.5)
		p.setColor(cINK5)
		p.cell(cc.x, singleY, cc.w-padX, p.dash, "R")
	}

	// ── Key values: first two stacked ──────────────────────────────────────────
	kc := tableCols.keyVals
	kv1, kv2 := buildKeyValueLines(entry)
	switch {
	case kv1 == "":
		p.setFont("", 8)
		p.setColor(cINK5)
		p.cell(kc.x+padX, singleY, kc.w-padX*2, p.dash, "L")
	case kv2 == "":
		p.setFont("", 7.5)
		p.setColor(cINK2)
		p.cell(kc.x+padX, singleY, kc.w-padX*2, p.truncate(kv1, kc.w-padX*2), "L")
	default:
		p.setFont("", 7.5)
		p.setColor(cINK2)
		p.cell(kc.x+padX, line1Y, kc.w-padX*2, p.truncate(kv1, kc.w-padX*2), "L")
		p.setFont("", 7)
		p.setColor(cINK3)
		p.cell(kc.x+padX, line2Y, kc.w-padX*2, p.truncate(kv2, kc.w-padX*2), "L")
	}

	// ── Notes ──────────────────────────────────────────────────────────────────
	nc := tableCols.notes
	p.setFont("", 8)
	if entry.Notes == "" {
		p.setColor(cINK5)
		p.cell(nc.x+padX, singleY, nc.w-padX*2, p.dash, "L")
	} else {
		p.setColor(cINK2)
		p.cell(nc.x+padX, singleY, nc.w-padX*2, p.truncate(entry.Notes, nc.w-padX*2), "L")
	}

	// ── Logged by ──────────────────────────────────────────────────────────────
	lb := tableCols.loggedBy
	p.setFont("", 7)
	p.setColor(cINK3)
	hex := entry.CreatedBy.Hex()
	createdBy := "#" + hex
	if len(hex) > 8 {
		createdBy = "#" + hex[:8]
	}
	p.cell(lb.x+padX, singleY, lb.w-padX, createdBy, "L")

	doc.SetXY(ml, y+rowH)
}

// ── Build ─────────────────────────────────────────────────────────────────────

func buildPDF(
	project *models.Project,
	entries []models.LogEntry,
	logTypeName, dateFilter, q string,
) (*bytes.Buffer, error) {
	p := newPDFWriter()
	doc := p.doc

	// Group entries by date, newest first
	grouped := make(map[string][]models.LogEntry)
	for _, e := range entries {
		key := e.LogDate.UTC().Format("2006-01-02")
		grouped[key] = append(grouped[key], e)
	}
	dates := make([]string, 0, len(grouped))
	for k := range grouped {
		dates = append(dates, k)
	}
	sort.Sort(sort.Reverse(sort.StringSlice(dates)))

	// Page 1
	doc.AddPage()
	p.drawPageHeader(project, logTypeName, dateFilter, q, len(entries))
	p.drawTableHeader()

	rowIndex := 0

	for _, dateKey := range dates {
		dayEntries := grouped[dateKey]

		if doc.GetY()+dateH+rowH > ph-14 {
			doc.AddPage()
			p.drawTableHeader()
		}
		p.drawDateRow(dateKey, len(dayEntries))

		for _, entry := range dayEntries {
			if doc.GetY()+rowH > ph-14 {
				doc.AddPage()
				p.drawTableHeader()
				p.drawDateRow(dateKey, len(dayEntries))
			}
			p.drawDataRow(entry, rowIndex%2 == 1)
			rowIndex++
		}
	}

	// Close table
	p.hLine(doc.GetY(), cLINE, 0.3)

	// ── Summary block ─────────────────────────────────────────────────────────
	if doc.GetY()+24 > ph-14 {
		doc.AddPage()
	}
	doc.SetXY(ml, doc.GetY()+7)

	p.setFont("B", 8.5)
	p.setColor(cINK)
	doc.Cell(40, 5, "Summary")
	doc.Ln(5.5)

	totalCost := 0.0
	for _, e := range entries {
		if e.TotalCost != nil {
			totalCost += *e.TotalCost
		}
	}
	summaryRows := [][2]string{{"Total entries", fmt.Sprintf("%d", len(entries))}}
	if totalCost > 0 {
		summaryRows = append(summaryRows, [2]string{"Total cost", p.rupee + " " + formatNum(totalCost)})
	}
	for _, row := range summaryRows {
		p.setFont("", 8)
		p.setColor(cINK3)
		doc.SetX(ml)
		doc.CellFormat(32, 5, row[0]+":", "", 0, "L", false, 0, "")
		p.setFont("B", 8)
		p.setColor(cINK)
		doc.CellFormat(50, 5, row[1], "", 1, "L", false, 0, "")
	}

	// ── Page footers ──────────────────────────────────────────────────────────
	// Disable auto-page-break: footer is drawn near ph-8 (202mm) which is past
	// the break limit (ph-14=196mm) and would otherwise trigger a blank new page.
	doc.SetAutoPageBreak(false, 0)
	pageCount := doc.PageCount()
	for i := 1; i <= pageCount; i++ {
		doc.SetPage(i)
		// Hairline above footer
		p.setDraw(cLINE)
		doc.SetLineWidth(0.2)
		doc.Line(ml, ph-10, ml+cw, ph-10)

		p.setFont("", 7)
		p.setColor(cINK4)
		doc.SetXY(ml, ph-8)
		doc.CellFormat(70, 4, "HouseXpert "+p.dash+" Confidential", "", 0, "L", false, 0, "")
		doc.CellFormat(cw-70-50, 4, fmt.Sprintf("Page %d of %d", i, pageCount), "", 0, "C", false, 0, "")
		doc.CellFormat(50, 4, time.Now().Format("2 Jan 2006, 15:04"), "", 0, "R", false, 0, "")
	}

	var buf bytes.Buffer
	if err := doc.Output(&buf); err != nil {
		return nil, err
	}
	return &buf, nil
}

// ── Text helpers ──────────────────────────────────────────────────────────────

func buildPrimary(e models.LogEntry) string {
	if e.ItemName != "" {
		return e.ItemName
	}
	for _, f := range e.Fields {
		l := strings.ToLower(f.Label)
		if strings.Contains(l, "name") || strings.Contains(l, "item") ||
			strings.Contains(l, "material") || strings.Contains(l, "activity") {
			if s := fmt.Sprintf("%v", f.Value); s != "" && s != "<nil>" {
				return s
			}
		}
	}
	return e.CategoryName
}

func buildSecondary(e models.LogEntry) string {
	if e.ItemName != "" {
		return "Catalog item · " + e.CategoryName
	}
	return "Manual · " + e.CategoryName
}

// buildKeyValueLines returns up to two formatted "Label: Value" strings
// from the entry's custom fields, skipping name/item/material fields.
func buildKeyValueLines(e models.LogEntry) (string, string) {
	var parts []string
	for _, f := range e.Fields {
		if f.Value == nil || f.Value == "" {
			continue
		}
		l := strings.ToLower(f.Label)
		if strings.Contains(l, "name") || strings.Contains(l, "item") || strings.Contains(l, "material") {
			continue
		}
		parts = append(parts, fmt.Sprintf("%s: %v", f.Label, f.Value))
	}
	switch len(parts) {
	case 0:
		return "", ""
	case 1:
		return parts[0], ""
	default:
		return parts[0], parts[1]
	}
}

func formatNum(n float64) string {
	if n == float64(int64(n)) {
		return addIndianCommas(int64(n))
	}
	return fmt.Sprintf("%s.%02.0f", addIndianCommas(int64(n)), (n-float64(int64(n)))*100)
}

func addIndianCommas(n int64) string {
	s := fmt.Sprintf("%d", n)
	if len(s) <= 3 {
		return s
	}
	rest := s[:len(s)-3]
	last3 := s[len(s)-3:]
	var groups []string
	for len(rest) > 2 {
		groups = append([]string{rest[len(rest)-2:]}, groups...)
		rest = rest[:len(rest)-2]
	}
	if rest != "" {
		groups = append([]string{rest}, groups...)
	}
	return strings.Join(groups, ",") + "," + last3
}

func pluralise(singular, plural string, n int) string {
	if n == 1 {
		return singular
	}
	return plural
}
