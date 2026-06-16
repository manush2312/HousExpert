package handlers

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"housexpert/backend/internal/models"
	"housexpert/backend/internal/services"
	"housexpert/backend/internal/utils"
)

const maxFloorPlanUploadBytes int64 = 10 << 20 // 10 MB
const maxInlineAnalysisImageBytes = 4 << 20    // 4 MB

var errPDFConverterUnavailable = errors.New("pdf converter unavailable")

var allowedFloorPlanContentTypes = map[string]string{
	"application/pdf": "pdf",
	"image/jpeg":      "image",
	"image/png":       "image",
	"image/webp":      "image",
}

var allowedFloorPlanExtensions = map[string]string{
	".pdf":  "application/pdf",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".png":  "image/png",
	".webp": "image/webp",
}

// RegisterQuotationRoutes mounts all quotation endpoints.
//
//	GET    /quotations              list quotations
//	POST   /quotations              create quotation
//	POST   /quotations/analyze-floor-plan  validate a floor plan upload for AI-assisted quotation draft
//	GET    /quotations/:id          get quotation
//	PUT    /quotations/:id          update quotation (draft only)
//	PUT    /quotations/:id/status   transition status
//	POST   /quotations/:id/convert  mark as converted to project
//	DELETE /quotations/:id          delete draft quotation
func RegisterQuotationRoutes(rg *gin.RouterGroup) {
	q := rg.Group("/quotations")
	q.GET("", listQuotations)
	q.POST("", createQuotation)
	q.POST("/analyze-floor-plan", analyzeFloorPlan)
	q.GET("/:id", getQuotation)
	q.PUT("/:id", updateQuotation)
	q.PUT("/:id/status", updateQuotationStatus)
	q.POST("/:id/convert", convertQuotation)
	q.DELETE("/:id", deleteQuotation)
}

// analyzeFloorPlan handles POST /quotations/analyze-floor-plan.
// It validates a multipart floor-plan upload, converts PDFs to a first-page
// image when needed, and asks AI to detect rooms/areas for quotation drafting.
func analyzeFloorPlan(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxFloorPlanUploadBytes+1024)

	fileHeader, err := c.FormFile("file")
	if err != nil {
		utils.BadRequest(c, "floor plan file is required")
		return
	}
	if fileHeader.Size <= 0 {
		utils.BadRequest(c, "floor plan file is empty")
		return
	}
	if fileHeader.Size > maxFloorPlanUploadBytes {
		utils.BadRequest(c, "floor plan file must be 10 MB or smaller")
		return
	}

	contentType, kind, err := detectFloorPlanFileType(fileHeader)
	if err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	clientName := strings.TrimSpace(c.PostForm("client_name"))
	clientPhone := strings.TrimSpace(c.PostForm("client_phone"))
	clientLocation := strings.TrimSpace(c.PostForm("client_location"))
	warnings := []string{}
	var analysisImageBytes []byte
	analysisImageContentType := contentType
	analysisImage := gin.H{
		"source":       "original_upload",
		"page":         1,
		"converted":    false,
		"content_type": contentType,
		"kind":         kind,
		"size_bytes":   fileHeader.Size,
	}

	if contentType == "application/pdf" {
		converted, converter, err := convertPDFUploadToPNG(fileHeader)
		if err != nil {
			if errors.Is(err, errPDFConverterUnavailable) {
				utils.ServiceUnavailable(c, "PDF conversion is not configured. Install poppler-utils (pdftoppm), MuPDF (mutool), ImageMagick, or Ghostscript on the backend server.")
				return
			}
			utils.BadRequest(c, err.Error())
			return
		}

		analysisImageBytes = converted
		analysisImageContentType = "image/png"
		analysisImage = gin.H{
			"source":       "pdf_first_page",
			"page":         1,
			"converted":    true,
			"converter":    converter,
			"content_type": "image/png",
			"kind":         "image",
			"size_bytes":   len(converted),
		}
		if len(converted) <= maxInlineAnalysisImageBytes {
			analysisImage["data_url"] = "data:image/png;base64," + base64.StdEncoding.EncodeToString(converted)
		} else {
			warnings = append(warnings, "PDF first page was converted, but preview image is too large to inline.")
		}
	} else {
		analysisImageBytes, err = readMultipartFileBytes(fileHeader)
		if err != nil {
			utils.BadRequest(c, err.Error())
			return
		}
	}

	analysis, err := services.AnalyzeFloorPlanRooms(c.Request.Context(), analysisImageBytes, analysisImageContentType)
	if err != nil {
		if errors.Is(err, services.ErrOpenAINotConfigured) {
			utils.ServiceUnavailable(c, "OpenAI room detection is not configured. Set OPENAI_API_KEY on the backend server.")
			return
		}
		utils.InternalError(c, err.Error())
		return
	}
	warnings = append(warnings, analysis.Warnings...)

	utils.OK(c, gin.H{
		"status":  "analysis_completed",
		"message": "Floor plan analyzed. Review detected rooms before creating a quotation.",
		"file": gin.H{
			"filename":     filepath.Base(fileHeader.Filename),
			"content_type": contentType,
			"kind":         kind,
			"size_bytes":   fileHeader.Size,
		},
		"client": gin.H{
			"name":     clientName,
			"phone":    clientPhone,
			"location": clientLocation,
		},
		"analysis_image": analysisImage,
		"rooms":          analysis.Rooms,
		"warnings":       warnings,
	})
}

// listQuotations handles GET /quotations
// Query params: status, page, limit
func listQuotations(c *gin.Context) {
	filter := services.QuotationListFilter{
		Status: c.Query("status"),
		Page:   parseIntQuery(c, "page", 1),
		Limit:  parseIntQuery(c, "limit", 20),
	}

	result, err := services.ListQuotations(filter)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, result)
}

// createQuotation handles POST /quotations
func createQuotation(c *gin.Context) {
	var input services.CreateQuotationInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	q, err := services.CreateQuotation(input)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.Created(c, q)
}

// getQuotation handles GET /quotations/:id
func getQuotation(c *gin.Context) {
	q, err := services.GetQuotation(c.Param("id"))
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	if q == nil {
		utils.NotFound(c, "quotation not found")
		return
	}
	utils.OK(c, q)
}

// updateQuotation handles PUT /quotations/:id
func updateQuotation(c *gin.Context) {
	var input services.UpdateQuotationInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	q, err := services.UpdateQuotation(c.Param("id"), input)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	if q == nil {
		utils.NotFound(c, "quotation not found")
		return
	}
	utils.OK(c, q)
}

// updateQuotationStatus handles PUT /quotations/:id/status
// Body: { "status": "sent" }
func updateQuotationStatus(c *gin.Context) {
	var body struct {
		Status models.QuotationStatus `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	q, err := services.UpdateQuotationStatus(c.Param("id"), body.Status)
	if err != nil {
		if err.Error()[:14] == "invalid status" {
			utils.BadRequest(c, err.Error())
			return
		}
		utils.InternalError(c, err.Error())
		return
	}
	if q == nil {
		utils.NotFound(c, "quotation not found")
		return
	}
	utils.OK(c, q)
}

// convertQuotation handles POST /quotations/:id/convert
// Body: { "project_id": "PROJ-001" }
// Called after the project is created from the frontend to link them.
func convertQuotation(c *gin.Context) {
	var body struct {
		ProjectID string `json:"project_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	if err := services.MarkConverted(c.Param("id"), body.ProjectID); err != nil {
		if err.Error() == "quotation not found" {
			utils.NotFound(c, err.Error())
			return
		}
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"converted": true, "quotation_id": c.Param("id"), "project_id": body.ProjectID})
}

// deleteQuotation handles DELETE /quotations/:id (draft only)
func deleteQuotation(c *gin.Context) {
	if err := services.DeleteQuotation(c.Param("id")); err != nil {
		if err.Error() == "draft quotation not found" {
			utils.NotFound(c, err.Error())
			return
		}
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"deleted": true, "quotation_id": c.Param("id")})
}

func detectFloorPlanFileType(fileHeader *multipart.FileHeader) (string, string, error) {
	file, err := fileHeader.Open()
	if err != nil {
		return "", "", fmt.Errorf("failed to read floor plan file")
	}
	defer file.Close()

	buffer := make([]byte, 512)
	n, _ := file.Read(buffer)
	detected := http.DetectContentType(buffer[:n])
	declared := strings.ToLower(strings.TrimSpace(fileHeader.Header.Get("Content-Type")))
	ext := strings.ToLower(filepath.Ext(fileHeader.Filename))

	candidates := []string{detected, declared, allowedFloorPlanExtensions[ext]}
	for _, contentType := range candidates {
		if kind, ok := allowedFloorPlanContentTypes[contentType]; ok {
			return contentType, kind, nil
		}
	}

	return "", "", fmt.Errorf("unsupported floor plan file type; upload PDF, PNG, JPG, or WEBP")
}

func convertPDFUploadToPNG(fileHeader *multipart.FileHeader) ([]byte, string, error) {
	workDir, err := os.MkdirTemp("", "hx-floor-plan-*")
	if err != nil {
		return nil, "", fmt.Errorf("failed to prepare PDF conversion workspace")
	}
	defer os.RemoveAll(workDir)

	inputPath := filepath.Join(workDir, "floor-plan.pdf")
	if err := saveMultipartFile(fileHeader, inputPath); err != nil {
		return nil, "", err
	}

	converters := []struct {
		name string
		run  func(context.Context, string, string) (string, error)
	}{
		{name: "pdftoppm", run: convertPDFWithPDFToPPM},
		{name: "mutool", run: convertPDFWithMuTool},
		{name: "magick", run: convertPDFWithMagick},
		{name: "gs", run: convertPDFWithGhostscript},
		{name: "qlmanage", run: convertPDFWithQLManage},
	}

	available := false
	var lastErr error
	for _, converter := range converters {
		if _, err := exec.LookPath(converter.name); err != nil {
			continue
		}
		available = true
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		outputPath, err := converter.run(ctx, inputPath, workDir)
		cancel()
		if err != nil {
			lastErr = err
			continue
		}
		imageBytes, err := os.ReadFile(outputPath)
		if err != nil {
			lastErr = err
			continue
		}
		if len(imageBytes) == 0 {
			lastErr = fmt.Errorf("converted PDF image was empty")
			continue
		}
		return imageBytes, converter.name, nil
	}

	if !available {
		return nil, "", errPDFConverterUnavailable
	}
	if lastErr != nil {
		return nil, "", fmt.Errorf("failed to convert PDF first page: %v", lastErr)
	}
	return nil, "", fmt.Errorf("failed to convert PDF first page")
}

func saveMultipartFile(fileHeader *multipart.FileHeader, outputPath string) error {
	src, err := fileHeader.Open()
	if err != nil {
		return fmt.Errorf("failed to read PDF upload")
	}
	defer src.Close()

	dst, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("failed to store PDF upload for conversion")
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return fmt.Errorf("failed to store PDF upload for conversion")
	}
	return nil
}

func readMultipartFileBytes(fileHeader *multipart.FileHeader) ([]byte, error) {
	file, err := fileHeader.Open()
	if err != nil {
		return nil, fmt.Errorf("failed to read floor plan image")
	}
	defer file.Close()

	imageBytes, err := io.ReadAll(file)
	if err != nil {
		return nil, fmt.Errorf("failed to read floor plan image")
	}
	if len(imageBytes) == 0 {
		return nil, fmt.Errorf("floor plan image is empty")
	}
	return imageBytes, nil
}

func convertPDFWithPDFToPPM(ctx context.Context, inputPath, workDir string) (string, error) {
	outputPrefix := filepath.Join(workDir, "page-1")
	cmd := exec.CommandContext(ctx, "pdftoppm", "-f", "1", "-singlefile", "-png", "-r", "180", inputPath, outputPrefix)
	if output, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("pdftoppm: %s", strings.TrimSpace(string(output)))
	}
	return outputPrefix + ".png", nil
}

func convertPDFWithMuTool(ctx context.Context, inputPath, workDir string) (string, error) {
	outputPath := filepath.Join(workDir, "page-1.png")
	cmd := exec.CommandContext(ctx, "mutool", "draw", "-o", outputPath, "-r", "180", inputPath, "1")
	if output, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("mutool: %s", strings.TrimSpace(string(output)))
	}
	return outputPath, nil
}

func convertPDFWithMagick(ctx context.Context, inputPath, workDir string) (string, error) {
	outputPath := filepath.Join(workDir, "page-1.png")
	cmd := exec.CommandContext(ctx, "magick", "-density", "180", inputPath+"[0]", "-quality", "92", outputPath)
	if output, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("magick: %s", strings.TrimSpace(string(output)))
	}
	return outputPath, nil
}

func convertPDFWithGhostscript(ctx context.Context, inputPath, workDir string) (string, error) {
	outputPath := filepath.Join(workDir, "page-1.png")
	cmd := exec.CommandContext(
		ctx,
		"gs",
		"-dSAFER",
		"-dBATCH",
		"-dNOPAUSE",
		"-sDEVICE=png16m",
		"-r180",
		"-dFirstPage=1",
		"-dLastPage=1",
		"-sOutputFile="+outputPath,
		inputPath,
	)
	if output, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("ghostscript: %s", strings.TrimSpace(string(output)))
	}
	return outputPath, nil
}

func convertPDFWithQLManage(ctx context.Context, inputPath, workDir string) (string, error) {
	outputDir := filepath.Join(workDir, "qlmanage")
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", err
	}
	cmd := exec.CommandContext(ctx, "qlmanage", "-t", "-s", "1800", "-o", outputDir, inputPath)
	if output, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("qlmanage: %s", strings.TrimSpace(string(output)))
	}
	return findGeneratedImage(outputDir)
}

func findGeneratedImage(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if ext == ".png" || ext == ".jpg" || ext == ".jpeg" {
			return filepath.Join(dir, entry.Name()), nil
		}
	}
	return "", fmt.Errorf("no image generated")
}
