package handlers

import (
	"strings"

	"github.com/gin-gonic/gin"

	"housexpert/backend/internal/services"
	"housexpert/backend/internal/utils"
)

// RegisterFurnitureDesignRoutes mounts all furniture design endpoints.
//
//	GET    /furniture-designs       list saved furniture designs
//	POST   /furniture-designs       create furniture design
//	GET    /furniture-designs/:id   get furniture design
//	PUT    /furniture-designs/:id   update furniture design
//	DELETE /furniture-designs/:id   delete furniture design
func RegisterFurnitureDesignRoutes(rg *gin.RouterGroup) {
	f := rg.Group("/furniture-designs")
	f.GET("", listFurnitureDesigns)
	f.POST("", createFurnitureDesign)
	f.GET("/:id", getFurnitureDesign)
	f.PUT("/:id", updateFurnitureDesign)
	f.DELETE("/:id", deleteFurnitureDesign)
}

// listFurnitureDesigns handles GET /furniture-designs
// Query params: furniture_type, page, limit
func listFurnitureDesigns(c *gin.Context) {
	filter := services.FurnitureDesignListFilter{
		FurnitureType: c.Query("furniture_type"),
		Page:          parseIntQuery(c, "page", 1),
		Limit:         parseIntQuery(c, "limit", 20),
	}

	result, err := services.ListFurnitureDesigns(filter)
	if err != nil {
		writeFurnitureDesignServiceError(c, err)
		return
	}
	utils.OK(c, result)
}

// createFurnitureDesign handles POST /furniture-designs
func createFurnitureDesign(c *gin.Context) {
	var input services.CreateFurnitureDesignInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	design, err := services.CreateFurnitureDesign(input)
	if err != nil {
		writeFurnitureDesignServiceError(c, err)
		return
	}
	utils.Created(c, design)
}

// getFurnitureDesign handles GET /furniture-designs/:id
func getFurnitureDesign(c *gin.Context) {
	design, err := services.GetFurnitureDesign(c.Param("id"))
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	if design == nil {
		utils.NotFound(c, "furniture design not found")
		return
	}
	utils.OK(c, design)
}

// updateFurnitureDesign handles PUT /furniture-designs/:id
func updateFurnitureDesign(c *gin.Context) {
	var input services.UpdateFurnitureDesignInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	design, err := services.UpdateFurnitureDesign(c.Param("id"), input)
	if err != nil {
		writeFurnitureDesignServiceError(c, err)
		return
	}
	if design == nil {
		utils.NotFound(c, "furniture design not found")
		return
	}
	utils.OK(c, design)
}

// deleteFurnitureDesign handles DELETE /furniture-designs/:id
func deleteFurnitureDesign(c *gin.Context) {
	if err := services.DeleteFurnitureDesign(c.Param("id")); err != nil {
		if err.Error() == "furniture design not found" {
			utils.NotFound(c, err.Error())
			return
		}
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"deleted": true, "design_id": c.Param("id")})
}

func writeFurnitureDesignServiceError(c *gin.Context, err error) {
	message := err.Error()
	if strings.HasPrefix(message, "invalid furniture_type") ||
		strings.Contains(message, "dimensions must be greater than 0") {
		utils.BadRequest(c, message)
		return
	}
	utils.InternalError(c, message)
}
