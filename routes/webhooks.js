// ==========================================
// File: routes/webhooks.js
// Description: WooCommerce Webhooks Handler for Categories and Products Sync with Advanced Image Extraction
// ==========================================

const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Category = require('../models/Category');

// 1. Webhook الخاص بالمنتجات (إضافة / تحديث)
router.post('/product', async (req, res) => {
    try {
        const prod = req.body;
        console.log("⚡ Webhook received for Product:", prod.name || prod.id);

        if (prod && prod.id) {
            await Product.findOneAndUpdate(
                { wooProductId: prod.id },
                {
                    title: prod.name,
                    description: prod.description ? prod.description.replace(/<[^>]*>?/gm, '') : '',
                    price: parseFloat(prod.price || prod.regular_price || 0),
                    images: prod.images ? prod.images.map(img => img.src) : [],
                    category: prod.categories && prod.categories[0] ? prod.categories[0].name : 'Uncategorized',
                    inStock: prod.in_stock,
                    wooProductId: prod.id
                },
                { upsert: true, new: true }
            );
            console.log(`✅ Auto-synced Product ID: ${prod.id}`);
        }
        res.status(200).send('Product Webhook Processed');
    } catch (err) {
        console.error('❌ Product Webhook Error:', err.message);
        res.status(500).send('Webhook Processing Failed');
    }
});

// 2. Webhook الخاص بالتصنيفات (إضافة / تحديث) - مع استخراج آمن وتتبع للصورة
router.post('/category', async (req, res) => {
    try {
        const cat = req.body;
        console.log("⚡ FULL Category Webhook Payload received:", JSON.stringify(cat, null, 2));

        if (cat && cat.id) {
            let imageUrl = '';
            if (cat.image) {
                if (typeof cat.image === 'string') {
                    imageUrl = cat.image;
                } else if (cat.image.src) {
                    imageUrl = cat.image.src;
                }
            } else if (cat.image_url) {
                imageUrl = cat.image_url;
            }

            console.log(`🖼️ Extracted Image URL for Category [${cat.name}]:`, imageUrl);

            const updatedCategory = await Category.findOneAndUpdate(
                { wooCategoryId: cat.id },
                {
                    name: cat.name,
                    slug: cat.slug,
                    image: imageUrl,
                    wooCategoryId: cat.id
                },
                { upsert: true, new: true }
            );
            console.log(`✅ Successfully saved Category in DB with image:`, updatedCategory.image);
        }
        res.status(200).send('Category Webhook Processed');
    } catch (err) {
        console.error('❌ Category Webhook Error:', err.message);
        res.status(500).send('Webhook Processing Failed');
    }
});

// 3. Webhook لحذف المنتج عند حذفه من WooCommerce
router.post('/product/delete', async (req, res) => {
    try {
        const prod = req.body;
        if (prod && prod.id) {
            await Product.findOneAndDelete({ wooProductId: prod.id });
            console.log(`🗑️ Deleted Product ID: ${prod.id} from MongoDB`);
        }
        res.status(200).send('Product Deleted');
    } catch (err) {
        console.error('❌ Product Delete Webhook Error:', err.message);
        res.status(500).send('Delete Failed');
    }
});

module.exports = router;