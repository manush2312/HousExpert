package handlers

import (
	"errors"

	"github.com/gin-gonic/gin"

	"housexpert/backend/internal/middleware"
	"housexpert/backend/internal/services"
	"housexpert/backend/internal/utils"
)

// RegisterVendorRoutes mounts the supplier (vendor) master endpoints.
//
//	GET    /vendors        list suppliers (optional ?category= & ?status= filters)
//	POST   /vendors        create supplier
//	PUT    /vendors/:id    update supplier
//	DELETE /vendors/:id    delete supplier
func RegisterVendorRoutes(rg *gin.RouterGroup) {
	v := rg.Group("/vendors")
	v.GET("", listVendors)
	v.POST("", createVendor)
	v.PUT("/:id", updateVendor)
	v.DELETE("/:id", deleteVendor)
}

// listVendors handles GET /vendors
func listVendors(c *gin.Context) {
	vendors, err := services.ListVendors(services.VendorFilter{
		Category: c.Query("category"),
		Status:   c.Query("status"),
	})
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, vendors)
}

// createVendor handles POST /vendors
func createVendor(c *gin.Context) {
	var input services.CreateVendorInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	input.CreatedBy = c.GetString(middleware.CtxEmployeeOID)

	vendor, err := services.CreateVendor(input)
	if err != nil {
		if errors.Is(err, services.ErrVendorNameTaken) {
			utils.Conflict(c, err.Error())
			return
		}
		utils.InternalError(c, err.Error())
		return
	}
	utils.Created(c, vendor)
}

// updateVendor handles PUT /vendors/:id
func updateVendor(c *gin.Context) {
	var input services.UpdateVendorInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	vendor, err := services.UpdateVendor(c.Param("id"), input)
	if err != nil {
		if errors.Is(err, services.ErrVendorNameTaken) {
			utils.Conflict(c, err.Error())
			return
		}
		utils.InternalError(c, err.Error())
		return
	}
	if vendor == nil {
		utils.NotFound(c, "vendor not found")
		return
	}
	utils.OK(c, vendor)
}

// deleteVendor handles DELETE /vendors/:id
func deleteVendor(c *gin.Context) {
	if err := services.DeleteVendor(c.Param("id")); err != nil {
		if err.Error() == "vendor not found" {
			utils.NotFound(c, err.Error())
			return
		}
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"deleted": true, "vendor_id": c.Param("id")})
}
