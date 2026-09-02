package handlers

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"housexpert/backend/internal/services"
	"housexpert/backend/internal/utils"
)

func RegisterInventoryRoutes(rg *gin.RouterGroup) {
	i := rg.Group("/inventory")
	i.GET("/overview", getInventoryOverview)
	i.GET("/log-links", listInventoryLogLinks)
	i.GET("/items", listInventoryItems)
	i.GET("/stock-lots", listAllInventoryStockLots)
	i.GET("/items/:id/supplier-stock", listInventorySupplierStock)
	i.GET("/items/:id/stock-lots", listInventoryStockLots)
	i.POST("/items", createInventoryItem)
	i.PUT("/items/:id", updateInventoryItem)
	i.DELETE("/items/:id", deleteInventoryItem)
	i.GET("/movements", listInventoryMovements)
	i.POST("/movements", createInventoryMovement)
	i.GET("/summary", getInventorySummary)

	// Goods-received-not-invoiced: stock taken in before its supplier bill.
	i.GET("/pending-bills", listPendingBills)
	i.GET("/pending-bills/summary", getPendingBillsSummary)
	i.POST("/stock-lots/:lotId/confirm-bill", confirmLotBill)
	i.GET("/cost-revisions", listCostRevisions)
	i.GET("/projects/:projectRef/cost-confidence", getProjectCostConfidence)
}

func listPendingBills(c *gin.Context) {
	rows, err := services.ListPendingBills()
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, rows)
}

func getPendingBillsSummary(c *gin.Context) {
	summary, err := services.GetPendingBillsSummary()
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, summary)
}

// confirmLotBill applies the supplier's real rate to a provisional lot. Pass
// dry_run to get the impact preview the confirmation dialog shows before the
// user commits.
func confirmLotBill(c *gin.Context) {
	var input services.ConfirmLotBillInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	result, err := services.ConfirmLotBill(c.Param("lotId"), input)
	if err != nil {
		if err.Error() == "stock lot not found" {
			utils.NotFound(c, err.Error())
			return
		}
		utils.BadRequest(c, err.Error())
		return
	}
	utils.OK(c, result)
}

func listCostRevisions(c *gin.Context) {
	limit, _ := strconv.ParseInt(c.DefaultQuery("limit", "100"), 10, 64)
	revisions, err := services.ListCostRevisions(c.Query("item_id"), limit)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, revisions)
}

func getProjectCostConfidence(c *gin.Context) {
	confidence, err := services.GetProjectCostConfidence(c.Param("projectRef"))
	if err != nil {
		if err.Error() == "project not found" {
			utils.NotFound(c, err.Error())
			return
		}
		utils.BadRequest(c, err.Error())
		return
	}
	utils.OK(c, confidence)
}

// getInventoryOverview serves items, summary and stock lots in one response.
// The page needs all three to render, and computing them together costs one
// item query instead of three.
func getInventoryOverview(c *gin.Context) {
	overview, err := services.GetInventoryOverview()
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, overview)
}

func listInventoryLogLinks(c *gin.Context) {
	links, err := services.ListInventoryLogLinks()
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, links)
}

func listInventoryItems(c *gin.Context) {
	items, err := services.ListInventoryItems()
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, items)
}

func listAllInventoryStockLots(c *gin.Context) {
	rows, err := services.ListAllInventoryStockLots()
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, rows)
}

func createInventoryItem(c *gin.Context) {
	var input services.CreateInventoryItemInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	item, err := services.CreateInventoryItem(input)
	if err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	utils.Created(c, item)
}

func listInventorySupplierStock(c *gin.Context) {
	rows, err := services.ListInventorySupplierStock(c.Param("id"))
	if err != nil {
		if err.Error() == "inventory item not found" {
			utils.NotFound(c, err.Error())
			return
		}
		utils.BadRequest(c, err.Error())
		return
	}
	utils.OK(c, rows)
}

func listInventoryStockLots(c *gin.Context) {
	rows, err := services.ListInventoryStockLots(c.Param("id"))
	if err != nil {
		if err.Error() == "inventory item not found" {
			utils.NotFound(c, err.Error())
			return
		}
		utils.BadRequest(c, err.Error())
		return
	}
	utils.OK(c, rows)
}

func updateInventoryItem(c *gin.Context) {
	var input services.UpdateInventoryItemInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	item, err := services.UpdateInventoryItem(c.Param("id"), input)
	if err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if item == nil {
		utils.NotFound(c, "inventory item not found")
		return
	}
	utils.OK(c, item)
}

func deleteInventoryItem(c *gin.Context) {
	if err := services.DeleteInventoryItem(c.Param("id")); err != nil {
		if err.Error() == "inventory item not found" {
			utils.NotFound(c, err.Error())
			return
		}
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"deleted": true, "item_id": c.Param("id")})
}

func listInventoryMovements(c *gin.Context) {
	limit, _ := strconv.ParseInt(c.DefaultQuery("limit", "50"), 10, 64)
	movements, err := services.ListInventoryMovements(services.InventoryMovementFilter{
		ItemID:   c.Query("item_id"),
		Type:     c.Query("type"),
		Reason:   c.Query("reason"),
		DateFrom: c.Query("date_from"),
		DateTo:   c.Query("date_to"),
		Limit:    limit,
	})
	if err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	utils.OK(c, movements)
}

func createInventoryMovement(c *gin.Context) {
	var input services.CreateInventoryMovementInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	movement, err := services.CreateInventoryMovement(input)
	if err != nil {
		if err.Error() == "inventory item not found" {
			utils.NotFound(c, err.Error())
			return
		}
		utils.BadRequest(c, err.Error())
		return
	}
	utils.Created(c, movement)
}

func getInventorySummary(c *gin.Context) {
	summary, err := services.GetInventorySummary()
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, summary)
}
