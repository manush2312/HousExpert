package handlers

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"

	"housexpert/backend/internal/models"
	"housexpert/backend/internal/services"
	"housexpert/backend/internal/utils"
)

// RegisterProjectRoutes mounts all project endpoints under the given router group.
//
//	GET    /projects                                         list projects
//	POST   /projects                                         create project
//	GET    /projects/:id                                     get project
//	PUT    /projects/:id                                     update project
//	DELETE /projects/:id                                     archive project (soft delete)
//	POST   /projects/:id/restore                             restore archived project
//	POST   /projects/:id/floor-plans/:bhk_type/upload-url   get presigned upload URL
//	POST   /projects/:id/floor-plans/:bhk_type              attach floor plan after upload
//	DELETE /projects/:id/floor-plans/:bhk_type/:plan_id     remove floor plan
func RegisterProjectRoutes(rg *gin.RouterGroup) {
	p := rg.Group("/projects")
	p.GET("", listProjects)
	p.POST("", createProject)
	p.GET("/:id", getProject)
	p.PUT("/:id", updateProject)
	p.DELETE("/:id", archiveProject)
	p.POST("/:id/restore", restoreProject)
	p.POST("/:id/floor-plans/:bhk_type/upload-url", getUploadURL)
	p.POST("/:id/floor-plans/:bhk_type", addFloorPlan)
	p.DELETE("/:id/floor-plans/:bhk_type/:plan_id", removeFloorPlan)
}

// validBHKTypes is used to validate the :bhk_type URL parameter.
var validBHKTypes = map[models.BHKType]bool{
	models.BHK1:      true,
	models.BHK2:      true,
	models.BHK3:      true,
	models.BHK4:      true,
	models.BHK5:      true,
	models.Villa:     true,
	models.Penthouse: true,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// listProjects handles GET /projects
// Query params: status, city, include_archived, page, limit
func listProjects(c *gin.Context) {
	includeArchived, _ := strconv.ParseBool(c.DefaultQuery("include_archived", "false"))
	filter := services.ProjectListFilter{
		Status:          c.Query("status"),
		City:            c.Query("city"),
		IncludeArchived: includeArchived,
		Page:            parseIntQuery(c, "page", 1),
		Limit:           parseIntQuery(c, "limit", 20),
	}

	result, err := services.ListProjects(filter)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, result)
}

// createProject handles POST /projects
func createProject(c *gin.Context) {
	var input services.CreateProjectInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	project, err := services.CreateProject(input)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.Created(c, project)
}

// getProject handles GET /projects/:id
func getProject(c *gin.Context) {
	project, err := services.GetProject(c.Param("id"))
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	if project == nil {
		utils.NotFound(c, "project not found")
		return
	}
	utils.OK(c, project)
}

// updateProject handles PUT /projects/:id
func updateProject(c *gin.Context) {
	var input services.UpdateProjectInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	project, err := services.UpdateProject(c.Param("id"), input)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	if project == nil {
		utils.NotFound(c, "project not found")
		return
	}
	utils.OK(c, project)
}

// archiveProject handles DELETE /projects/:id (soft delete)
func archiveProject(c *gin.Context) {
	if err := services.ArchiveProject(c.Param("id")); err != nil {
		if err.Error() == "project not found" {
			utils.NotFound(c, err.Error())
			return
		}
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"archived": true, "project_id": c.Param("id")})
}

func restoreProject(c *gin.Context) {
	if err := services.RestoreProject(c.Param("id")); err != nil {
		if err.Error() == "project not found" {
			utils.NotFound(c, err.Error())
			return
		}
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"restored": true, "project_id": c.Param("id")})
}

// getUploadURL handles POST /projects/:id/floor-plans/:bhk_type/upload-url
// Body: { "filename": "plan-a.pdf", "content_type": "application/pdf" }
// Returns: { "upload_url": "...", "public_url": "..." }
func getUploadURL(c *gin.Context) {
	if !utils.StorageReady() {
		utils.ServiceUnavailable(c, "file storage not configured — set S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY")
		return
	}

	bhkType := models.BHKType(c.Param("bhk_type"))
	if !validBHKTypes[bhkType] {
		utils.BadRequest(c, "invalid bhk_type: must be one of 1BHK, 2BHK, 3BHK, 4BHK, 5BHK, Villa, Penthouse")
		return
	}

	var req struct {
		Filename    string `json:"filename"     binding:"required"`
		ContentType string `json:"content_type" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	uploadURL, publicURL, err := services.GetUploadURL(
		c.Param("id"), string(bhkType), req.Filename, req.ContentType,
	)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}

	utils.OK(c, gin.H{
		"upload_url": uploadURL,
		"public_url": publicURL,
	})
}

// addFloorPlan handles POST /projects/:id/floor-plans/:bhk_type
// Call this after the frontend has uploaded the file using the presigned URL.
// Body: { "label": "Type A", "file_url": "...", "file_type": "pdf" }
func addFloorPlan(c *gin.Context) {
	bhkType := models.BHKType(c.Param("bhk_type"))
	if !validBHKTypes[bhkType] {
		utils.BadRequest(c, "invalid bhk_type: must be one of 1BHK, 2BHK, 3BHK, 4BHK, 5BHK, Villa, Penthouse")
		return
	}

	var input services.AddFloorPlanInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	project, err := services.AddFloorPlan(c.Param("id"), bhkType, input)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	if project == nil {
		utils.NotFound(c, "project not found")
		return
	}
	utils.OK(c, project)
}

// removeFloorPlan handles DELETE /projects/:id/floor-plans/:bhk_type/:plan_id
func removeFloorPlan(c *gin.Context) {
	bhkType := models.BHKType(c.Param("bhk_type"))
	if !validBHKTypes[bhkType] {
		utils.BadRequest(c, "invalid bhk_type")
		return
	}

	planID, err := primitive.ObjectIDFromHex(c.Param("plan_id"))
	if err != nil {
		utils.BadRequest(c, "invalid plan_id — must be a valid ObjectID hex string")
		return
	}

	project, err := services.RemoveFloorPlan(c.Param("id"), bhkType, planID)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	if project == nil {
		utils.NotFound(c, "project or floor plan not found")
		return
	}
	utils.OK(c, project)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func parseIntQuery(c *gin.Context, key string, defaultVal int64) int64 {
	raw := c.Query(key)
	if raw == "" {
		return defaultVal
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 1 {
		return defaultVal
	}
	return n
}
