package handlers

import (
	"strconv"

	"github.com/gin-gonic/gin"
	"go.mongodb.org/mongo-driver/bson/primitive"

	"housexpert/backend/internal/services"
	"housexpert/backend/internal/utils"
)

// RegisterLogRoutes mounts all log-system endpoints under the given router group.
//
// Log Types (admin):
//
//	GET    /log-types                         list all log types
//	POST   /log-types                         create log type
//	GET    /log-types/:id                     get log type (includes schema history)
//	PUT    /log-types/:id/schema              update schema → creates new version
//	DELETE /log-types/:id                     archive log type
//	POST   /log-types/:id/restore             restore archived log type
//	GET    /log-types/:id/categories          list categories for a log type
//	POST   /log-types/:id/categories          add category under a log type
//	GET    /log-categories/:id/items          list items under a category
//	POST   /log-categories/:id/items          add item under a category
//
// Log Categories / Items (admin):
//
//	DELETE /log-categories/:id               archive a category
//	POST   /log-categories/:id/restore       restore an archived category
//	PUT    /log-items/:id                    update an item
//	DELETE /log-items/:id                    archive an item
//	POST   /log-items/:id/restore            restore an archived item
//
// Log Entries (per project):
//
//	GET    /projects/:id/logs                list entries (filter: log_type_id, category_id, log_date)
//	POST   /projects/:id/logs                create entry
//	PUT    /projects/:id/logs/:entry_id      update entry fields/notes
//	DELETE /projects/:id/logs/:entry_id      delete entry
func RegisterLogRoutes(rg *gin.RouterGroup) {
	// Log Types
	lt := rg.Group("/log-types")
	lt.GET("", listLogTypes)
	lt.POST("", createLogType)
	lt.GET("/:id", getLogType)
	lt.PUT("/:id/schema", updateLogTypeSchema)
	lt.DELETE("/:id", archiveLogType)
	lt.POST("/:id/restore", restoreLogType)
	lt.GET("/:id/categories", listLogCategories)
	lt.POST("/:id/categories", createLogCategory)

	// Log Categories / Items (standalone archive endpoints)
	lc := rg.Group("/log-categories")
	lc.GET("/:id/items", listLogItems)
	lc.POST("/:id/items", createLogItem)
	lc.DELETE("/:id", archiveLogCategory)
	lc.POST("/:id/restore", restoreLogCategory)
	li := rg.Group("/log-items")
	li.PUT("/:id", updateLogItem)
	li.DELETE("/:id", archiveLogItem)
	li.POST("/:id/restore", restoreLogItem)

	// Log Entries (nested under projects)
	p := rg.Group("/projects")
	p.GET("/:id/logs", listLogEntries)
	p.POST("/:id/logs", createLogEntry)
	p.PUT("/:id/logs/:entry_id", updateLogEntry)
	p.DELETE("/:id/logs/:entry_id", deleteLogEntry)

	RegisterPricingRuleRoutes(rg)
}

// ── Log Type handlers ─────────────────────────────────────────────────────────

func listLogTypes(c *gin.Context) {
	includeArchived, _ := strconv.ParseBool(c.DefaultQuery("include_archived", "false"))
	types, err := services.ListLogTypes(services.LogListOptions{IncludeArchived: includeArchived})
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, types)
}

func createLogType(c *gin.Context) {
	var input services.CreateLogTypeInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	lt, err := services.CreateLogType(input)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.Created(c, lt)
}

func getLogType(c *gin.Context) {
	lt, err := services.GetLogType(c.Param("id"))
	if err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if lt == nil {
		utils.NotFound(c, "log type not found")
		return
	}
	utils.OK(c, lt)
}

func updateLogTypeSchema(c *gin.Context) {
	var input services.UpdateLogTypeSchemaInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	itemFields := input.ItemFields
	if len(itemFields) == 0 {
		itemFields = input.Fields
	}
	lt, err := services.UpdateLogTypeSchema(c.Param("id"), itemFields, input.EntryFields, input.CostMode)
	if err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if lt == nil {
		utils.NotFound(c, "log type not found")
		return
	}
	utils.OK(c, lt)
}

func archiveLogType(c *gin.Context) {
	if err := services.ArchiveLogType(c.Param("id")); err != nil {
		utils.NotFound(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"archived": true})
}

func restoreLogType(c *gin.Context) {
	if err := services.RestoreLogType(c.Param("id")); err != nil {
		utils.NotFound(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"restored": true})
}

// ── Log Category handlers ─────────────────────────────────────────────────────

func listLogCategories(c *gin.Context) {
	includeArchived, _ := strconv.ParseBool(c.DefaultQuery("include_archived", "false"))
	cats, err := services.ListLogCategories(c.Param("id"), services.LogListOptions{IncludeArchived: includeArchived})
	if err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	utils.OK(c, cats)
}

func createLogCategory(c *gin.Context) {
	logTypeID, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		utils.BadRequest(c, "invalid log type id")
		return
	}
	var input services.CreateLogCategoryInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	input.LogTypeID = logTypeID

	cat, err := services.CreateLogCategory(input)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.Created(c, cat)
}

func archiveLogCategory(c *gin.Context) {
	if err := services.ArchiveLogCategory(c.Param("id")); err != nil {
		utils.NotFound(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"archived": true})
}

func restoreLogCategory(c *gin.Context) {
	if err := services.RestoreLogCategory(c.Param("id")); err != nil {
		utils.NotFound(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"restored": true})
}

func listLogItems(c *gin.Context) {
	includeArchived, _ := strconv.ParseBool(c.DefaultQuery("include_archived", "false"))
	items, err := services.ListLogItems(c.Param("id"), services.LogListOptions{IncludeArchived: includeArchived})
	if err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	utils.OK(c, items)
}

func createLogItem(c *gin.Context) {
	categoryID, err := primitive.ObjectIDFromHex(c.Param("id"))
	if err != nil {
		utils.BadRequest(c, "invalid category id")
		return
	}
	var input services.CreateLogItemInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	input.CategoryID = categoryID

	cat, err := services.GetLogCategory(c.Param("id"))
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	if cat == nil {
		utils.NotFound(c, "category not found")
		return
	}
	input.LogTypeID = cat.LogTypeID

	item, err := services.CreateLogItem(input)
	if err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	utils.Created(c, item)
}

func archiveLogItem(c *gin.Context) {
	if err := services.ArchiveLogItem(c.Param("id")); err != nil {
		utils.NotFound(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"archived": true})
}

func restoreLogItem(c *gin.Context) {
	if err := services.RestoreLogItem(c.Param("id")); err != nil {
		utils.NotFound(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"restored": true})
}

func updateLogItem(c *gin.Context) {
	var input services.UpdateLogItemInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	item, err := services.UpdateLogItem(c.Param("id"), input)
	if err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if item == nil {
		utils.NotFound(c, "item not found")
		return
	}
	utils.OK(c, item)
}

// ── Log Entry handlers ────────────────────────────────────────────────────────

// resolveProjectOID is a shared helper that converts the human-readable
// project_id URL param ("PROJ-001") into its MongoDB ObjectID.
func resolveProjectOID(c *gin.Context) (primitive.ObjectID, bool) {
	project, err := services.GetProject(c.Param("id"))
	if err != nil {
		utils.InternalError(c, err.Error())
		return primitive.NilObjectID, false
	}
	if project == nil {
		utils.NotFound(c, "project not found")
		return primitive.NilObjectID, false
	}
	return project.ID, true
}

func listLogEntries(c *gin.Context) {
	projectOID, ok := resolveProjectOID(c)
	if !ok {
		return
	}
	filter := services.LogEntryFilter{
		LogTypeID:  c.Query("log_type_id"),
		CategoryID: c.Query("category_id"),
		LogDate:    c.Query("log_date"), // "YYYY-MM-DD"
	}
	entries, err := services.ListLogEntries(projectOID, filter)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, entries)
}

func createLogEntry(c *gin.Context) {
	projectOID, ok := resolveProjectOID(c)
	if !ok {
		return
	}
	var input services.CreateLogEntryInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	entry, err := services.CreateLogEntry(projectOID, input)
	if err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	utils.Created(c, entry)
}

func updateLogEntry(c *gin.Context) {
	entryOID, err := primitive.ObjectIDFromHex(c.Param("entry_id"))
	if err != nil {
		utils.BadRequest(c, "invalid entry_id")
		return
	}
	var input services.UpdateLogEntryInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	entry, err := services.UpdateLogEntry(entryOID, input)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	if entry == nil {
		utils.NotFound(c, "log entry not found")
		return
	}
	utils.OK(c, entry)
}

func deleteLogEntry(c *gin.Context) {
	entryOID, err := primitive.ObjectIDFromHex(c.Param("entry_id"))
	if err != nil {
		utils.BadRequest(c, "invalid entry_id")
		return
	}
	if err := services.DeleteLogEntry(entryOID); err != nil {
		utils.NotFound(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"deleted": true})
}
