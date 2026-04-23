package handlers

import (
	"github.com/gin-gonic/gin"

	"housexpert/backend/internal/models"
	"housexpert/backend/internal/services"
	"housexpert/backend/internal/utils"
)

// RegisterQuotationRoutes mounts all quotation endpoints.
//
//	GET    /quotations              list quotations
//	POST   /quotations              create quotation
//	GET    /quotations/:id          get quotation
//	PUT    /quotations/:id          update quotation (draft only)
//	PUT    /quotations/:id/status   transition status
//	POST   /quotations/:id/convert  mark as converted to project
//	DELETE /quotations/:id          delete draft quotation
func RegisterQuotationRoutes(rg *gin.RouterGroup) {
	q := rg.Group("/quotations")
	q.GET("", listQuotations)
	q.POST("", createQuotation)
	q.GET("/:id", getQuotation)
	q.PUT("/:id", updateQuotation)
	q.PUT("/:id/status", updateQuotationStatus)
	q.POST("/:id/convert", convertQuotation)
	q.DELETE("/:id", deleteQuotation)
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
