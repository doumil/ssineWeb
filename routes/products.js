const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { optionalAuth, verifyToken } = require('../middleware/verifyToken');
const Product = require('../models/Product'); // موديل المنتجات المتزامنة مع WooCommerce

// ==========================================
// 0. مسار تصحيح وربط التصنيفات
// ==========================================
router.get('/fix-product-categories-now', productController.fixCategoriesObjectId);

// ==========================================
// 1. مسار جلب جميع المنتجات مع الـ Populate الصحيح
// ==========================================
router.get('/all-sync-products', optionalAuth, async (req, res) => {
    try {
        const products = await Product.find({})
            .populate({
                path: 'category',
                select: 'name description' // جلب الاسم والتفاصيل الحقيقية للتصنيف
            })
            .sort({ createdAt: -1 });
            
        res.status(200).json({
            success: true,
            count: products.length,
            products: products
        });
    } catch (err) {
        console.error('Error fetching sync products:', err.message);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// ==========================================
// 2. المسارات الأخرى الخاصة بالتطبيق
// ==========================================
router.get('/get-best-of-products', optionalAuth, productController.getBestOfProducts);

router.get('/liked-products', verifyToken, productController.getLikedProducts);

router.get('/category/:categoryId', optionalAuth, productController.getProductsByCategoryId);

router.get('/search', optionalAuth, productController.searchProducts);

// 3. المسار الذي يحتوي على المتغير (/:productId) يجب أن يبقى في النهاية دائماً
router.get('/:productId', optionalAuth, productController.getSingleProduct);

module.exports = router;