package handlers

type quotationSpecSection struct {
	Title string
	Items []string
}

var quotationSpecSections = []quotationSpecSection{
	{
		Title: "Selections Included",
		Items: []string{
			"Laminate selection: Designer, Carvers, Crafters, Plain, Unique, wooden and similar finishes.",
			"Cabinet handle selection.",
			"Sofa and headboard design plus fabric selection.",
			"Internal wardrobe partition and CNC design selection.",
			"LED light selection: Syska or Crompton, round or square, white or warm, 15W.",
		},
	},
	{
		Title: "Payment Milestones",
		Items: []string{
			"10% token amount.",
			"50% on material unloading.",
			"25% at laminate stage start.",
			"10% before paint work.",
			"5% at the time of sofa material selection.",
		},
	},
	{
		Title: "Material Specifications",
		Items: []string{
			"Ply: termite-proof, 10-year warranty, IS.303 / MR grade, Magic Ply.",
			"Inner mica: 0.8 mm, off-white or white, Durian.",
			"Laminate: 1 mm imported laminate with 10-year warranty, including Honest, One Touch, Latitude Gold and Premium Lam ranges.",
			"Electrical wiring: RR Cables.",
			"Kitchen baskets: tandem baskets with auto-close system, heavy quality, up to 12-year warranty, Excellence / Blandox.",
			"LED lights: standard company fittings such as Syska / Crompton.",
			"Electric switches: Hi-Fi.",
			"Hardware: ISI marked, including Blandox / Spenza.",
			"Paint: Asian Paint Royale.",
			"POP / gypsum: 10-year warranty sheet options such as Indigyp, Oman, Khushbu and Atlantica.",
		},
	},
	{
		Title: "Electrical And Site Scope",
		Items: []string{
			"35 lights included.",
			"Main hall rope light included.",
			"Main hall and all room pelmet work included.",
			"All-house colour in Royale range included where applicable.",
			"All-house POP included where applicable.",
		},
	},
	{
		Title: "Exclusions And Conditions",
		Items: []string{
			"Electronic items are not included, such as fan, AC, TV and similar appliances.",
			"Curtains and mattress are not included.",
			"Only 4 drawers are included in an 84 x 84 wardrobe. Extra drawers are chargeable at Rs. 2000 per drawer.",
			"Design is included in the quote and can be changed up to 3 times after the designer meeting. Further revisions are chargeable.",
			"Decorative lights are excluded, including jhumar, magnetic lights, sensor-based lights, AC wiring/fittings and Wi-Fi or internet wire.",
			"Centre table, aluminium section work, door laminates, glass partitions, bird net and all civil work are excluded unless specifically mentioned in the quotation.",
			"Paint / colour is not included in bathroom, lobby foyer area, washyard, balcony, doors and chaukhat unless specifically mentioned in the quotation.",
		},
	},
}

func (p *pdfWriter) drawQuotationAppendixNotice(y float64) float64 {
	doc := p.doc
	const boxH = 15.5

	p.setFill(cBGSUN)
	p.setDraw(cLINE)
	doc.SetLineWidth(0.25)
	doc.RoundedRect(qml, y, qcw, boxH, 2.5, "1234", "FD")

	p.setFill(cINK)
	doc.RoundedRect(qml+4, y+4.7, 2.4, 2.4, 1.2, "1234", "F")

	p.setFont("B", 8.5)
	p.setColor(cINK)
	doc.SetXY(qml+8.5, y+2.8)
	doc.CellFormat(qcw-13, 4.5, "Specifications & Terms Appendix Included", "", 0, "L", false, 0, "")

	p.setFont("", 7.5)
	p.setColor(cINK3)
	doc.SetXY(qml+8.5, y+8.5)
	doc.CellFormat(qcw-13, 4, "Material standards, payment milestones and exclusions are attached on the following pages as part of this quotation.", "", 0, "L", false, 0, "")

	return y + boxH + 4
}

func (p *pdfWriter) drawQuotationSpecificationsAppendix() {
	y := p.drawQuotationAppendixHeader("Specifications & Terms", "This appendix forms part of the quotation and captures the standard material specifications, inclusions and exclusions shared with the client.")

	for _, section := range quotationSpecSections {
		if y+p.measureQuotationSpecSection(section) > qph-16 {
			y = p.drawQuotationAppendixHeader("Specifications & Terms", "Continued")
		}
		y = p.drawQuotationSpecSection(y, section)
	}
}

func (p *pdfWriter) drawQuotationAppendixHeader(title, subtitle string) float64 {
	doc := p.doc
	doc.AddPage()

	p.setFill(cINK)
	doc.Rect(qml, 12, qcw, 2, "F")

	y := 18.0
	p.drawLogo(qml, y)

	p.setFont("B", 13)
	p.setColor(cINK)
	doc.SetXY(qml+23, y+2)
	doc.CellFormat(80, 6, title, "", 0, "L", false, 0, "")

	p.setFont("", 7.5)
	p.setColor(cINK3)
	doc.SetXY(qml+23, y+8)
	doc.MultiCell(115, 4.2, subtitle, "", "L", false)

	p.setFill(cBGSUN)
	p.setDraw(cLINE)
	doc.RoundedRect(qml+145, y+1, 37, 12, 2, "1234", "FD")
	p.setFont("B", 8)
	p.setColor(cINK2)
	doc.SetXY(qml+145, y+4.2)
	doc.CellFormat(37, 4, "APPENDIX", "", 0, "C", false, 0, "")

	bottom := doc.GetY() + 3
	if bottom < 46 {
		bottom = 46
	}
	p.qhLine(bottom, cLINE, 0.4)
	return bottom + 6
}

func (p *pdfWriter) measureQuotationSpecSection(section quotationSpecSection) float64 {
	doc := p.doc
	const (
		titleBandH   = 8.5
		lineH        = 4.4
		contentW     = qcw - 16
		bulletIndent = 6.5
	)

	p.setFont("B", 8.5)
	height := titleBandH + 6

	p.setFont("", 7.8)
	for _, item := range section.Items {
		lines := doc.SplitText(item, contentW-bulletIndent)
		if len(lines) == 0 {
			lines = []string{item}
		}
		height += float64(len(lines))*lineH + 2.4
	}

	return height
}

func (p *pdfWriter) drawQuotationSpecSection(y float64, section quotationSpecSection) float64 {
	doc := p.doc
	const (
		cardPadTop   = 5.0
		cardPadX     = 8.0
		titleBandH   = 8.5
		lineH        = 4.4
		bulletGap    = 2.4
		bulletIndent = 6.5
		bulletRadius = 0.85
	)

	totalH := p.measureQuotationSpecSection(section)

	p.setFill(cBGSUN)
	p.setDraw(cLINE)
	doc.SetLineWidth(0.25)
	doc.RoundedRect(qml, y, qcw, totalH, 2.5, "1234", "FD")

	p.setFill(cINK)
	doc.RoundedRect(qml, y, qcw, titleBandH, 2.5, "12", "F")
	doc.Rect(qml, y+titleBandH-2.5, qcw, 2.5, "F")

	p.setFont("B", 8.5)
	p.setColor(rgb{255, 255, 255})
	doc.SetXY(qml+cardPadX, y+2.1)
	doc.CellFormat(qcw-cardPadX*2, 4.2, section.Title, "", 0, "L", false, 0, "")

	cursorY := y + titleBandH + cardPadTop
	p.setFont("", 7.8)
	p.setColor(cINK2)

	for _, item := range section.Items {
		lines := doc.SplitText(item, qcw-cardPadX*2-bulletIndent)
		if len(lines) == 0 {
			lines = []string{item}
		}

		p.setColor(cINK)
		p.setFill(cINK)
		doc.Circle(qml+cardPadX+bulletRadius, cursorY+2.15, bulletRadius, "F")

		p.setFont("", 7.8)
		p.setColor(cINK2)
		doc.SetXY(qml+cardPadX+bulletIndent, cursorY)
		doc.MultiCell(qcw-cardPadX*2-bulletIndent, lineH, item, "", "L", false)

		cursorY += float64(len(lines))*lineH + bulletGap
	}

	return y + totalH + 4
}
