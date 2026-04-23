package handlers

import (
	"github.com/gin-gonic/gin"

	"housexpert/backend/internal/services"
	"housexpert/backend/internal/utils"
)

// RegisterProductRoutes mounts all product catalog endpoints.
//
//	GET    /products        list all products
//	POST   /products        create product
//	PUT    /products/:id    update product
//	DELETE /products/:id    delete product
func RegisterProductRoutes(rg *gin.RouterGroup) {
	p := rg.Group("/products")
	p.GET("", listProducts)
	p.POST("", createProduct)
	p.PUT("/:id", updateProduct)
	p.DELETE("/:id", deleteProduct)
}

// listProducts handles GET /products
func listProducts(c *gin.Context) {
	products, err := services.ListProducts()
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, products)
}

// createProduct handles POST /products
func createProduct(c *gin.Context) {
	var input services.CreateProductInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	product, err := services.CreateProduct(input)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	utils.Created(c, product)
}

// updateProduct handles PUT /products/:id
func updateProduct(c *gin.Context) {
	var input services.UpdateProductInput
	if err := c.ShouldBindJSON(&input); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}

	product, err := services.UpdateProduct(c.Param("id"), input)
	if err != nil {
		utils.InternalError(c, err.Error())
		return
	}
	if product == nil {
		utils.NotFound(c, "product not found")
		return
	}
	utils.OK(c, product)
}

// deleteProduct handles DELETE /products/:id
func deleteProduct(c *gin.Context) {
	if err := services.DeleteProduct(c.Param("id")); err != nil {
		if err.Error() == "product not found" {
			utils.NotFound(c, err.Error())
			return
		}
		utils.InternalError(c, err.Error())
		return
	}
	utils.OK(c, gin.H{"deleted": true, "product_id": c.Param("id")})
}
