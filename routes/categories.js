const express = require('express')
const router = express.Router()
const categoryController = require('../controllers/categoryController')
const { syncAllFromWooCommerce } = require('../services/woocommerceSync')

// مسارات جلب التصنيفات للتطبيق
router.get('/get-root-categories', categoryController.getRootCategories)
router.get('/get-child-categories/:parentId', categoryController.getChildCategories)

// مسار المزامنة الشاملة مع WooCommerce
router.get('/sync', async (req, res) => {
  try {
    const result = await syncAllFromWooCommerce()
    res.status(200).json({
      success: true,
      message: 'Categories and products synchronized successfully!',
      categoriesCount: result.categoriesCount,
      productsCount: result.productsCount,
      data: result
    })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

module.exports = router