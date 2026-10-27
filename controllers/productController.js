const mongoose = require('mongoose')
const Product = require('../models/Product')
const Category = require('../models/Category')
const SearchTerm = require('../models/SearchTerm')
const ProductView = require('../models/ProductView')
const Like = require('../models/Like')
const { USE_REDIS } = require('../config/env')
const createRedisClient = require('../services/redisClient')
const BestOfProduct = require('../models/BestOfProduct')

const ObjectId = mongoose.Types.ObjectId

const CACHE_TTL = 3600

exports.getProductsByCategoryId = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const products = await Product.find({ category: categoryId })
            .populate('category'); // 👈 زيادة هذه السلسلة ضرورية
        res.status(200).json({ success: true, products });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

/*
const getAllSubCategoryIds = async (parentCategoryId) => {
  const subCategories = await Category.find({ parentCategory: parentCategoryId, isActive: true })
  const subCategoryIds = subCategories.map((sub) => sub._id)

  if (subCategoryIds.length > 0) {
    for (const subCategoryId of subCategoryIds) {
      const deeperSubCategoryIds = await getAllSubCategoryIds(subCategoryId)
      subCategoryIds.push(...deeperSubCategoryIds)
    }
  }

  return subCategoryIds
}
*/





exports.searchProducts = async (req, res) => {
    try {
        const query = req.query.q;
        const products = await Product.find({
            title: { $regex: query, $options: 'i' }
        }).populate('category'); // 👈 زيادة هذه السلسلة ضرورية
        
        res.status(200).json({ success: true, products });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};



// ==========================================
// جلب تفاصيل منتج واحد بصفة خاصة (Single Product)
// ==========================================
exports.getSingleProduct = async (req, res) => {
    try {
        const { productId } = req.params;

        // 1. البحث عن المنتج بالـ ID بوحده
        const product = await Product.findById(productId).populate({
            path: 'category',
            select: 'name description'
        });

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'المنتج غير موجود'
            });
        }

        // 2. تصفية وتحديد الصور الخاصة بهاد المنتج فقط (مربوطة بـ ID ديالو)
        let singleProductImages = [];

        // إيلا كانت imageURLs مصفوفة وفيها صور، كنزيدو شرط التأكد أن الصور خاصة بهاد المنتج
        if (Array.isArray(product.imageURLs) && product.imageURLs.length > 0) {
            singleProductImages = product.imageURLs;
        } else if (Array.isArray(product.images) && product.images.length > 0) {
            singleProductImages = product.images;
        } else if (product.image) {
            singleProductImages = [product.image];
        }

        // 3. إرجاع النتيجة بشكل صريح لـ Flutter
        return res.status(200).json({
            success: true,
            productResponse: {
                product: {
                    ...product.toObject(),
                    // هنا كنأكدو أن imageURLs فيها غير الصور ديال هاد المنتج الفردي
                    imageURLs: singleProductImages 
                }
            }
        });

    } catch (err) {
        console.error('Error fetching single product:', err.message);
        return res.status(500).json({
            success: false,
            message: 'خطأ في السيرفر',
            error: err.message
        });
    }
};


exports.getLikedProducts = async (req, res) => {
  try {
    const userId = req.user.id
    const {
      page = 1,
      limit = 10,
      minPrice,
      maxPrice,
      exactRatings,
      minRatingCount,
      maxRatingCount,
      minLikeCount,
      maxLikeCount,
      sortBy, 
    } = req.query

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required.',
      })
    }

    const likedProducts = await Like.find({ userId })
      .select('productId')
      .skip((page - 1) * limit)
      .limit(parseInt(limit))

    if (likedProducts.length === 0) {
      return res.status(200).json({
        success: true,
        products: [],
        message: 'No liked products found.',
        pagination: {
          currentPage: parseInt(page),
          totalPages: 0,
          totalProducts: 0,
        },
      })
    }

    const totalLikedProducts = await Like.countDocuments({ userId })

    const productIds = likedProducts.map((like) => like.productId)

    const filters = { _id: { $in: productIds } }

    if (minPrice || maxPrice) {
      filters.price = {}
      if (minPrice) filters.price.$gte = parseFloat(minPrice)
      if (maxPrice) filters.price.$lte = parseFloat(maxPrice)
    }
    if (exactRatings) {
      const ratingsArray = exactRatings.split(',').map(Number)
      filters.averageRating = { 
        $in: ratingsArray.flatMap(rating => 
          Array.from({ length: 10 }, (_, i) => parseFloat((rating + i * 0.1).toFixed(1)))
        ) 
      }
    }

    if (minRatingCount || maxRatingCount) {
      filters.reviewCount = {}
      if (minRatingCount) filters.reviewCount.$gte = parseInt(minRatingCount)
      if (maxRatingCount) filters.reviewCount.$lte = parseInt(maxRatingCount)
    }

    if (minLikeCount || maxLikeCount) {
      filters.likeCount = {}
      if (minLikeCount) filters.likeCount.$gte = parseInt(minLikeCount)
      if (maxLikeCount) filters.likeCount.$lte = parseInt(maxLikeCount)
    }

    const sortOptions = {}
    if (sortBy === 'priceAsc') sortOptions.price = 1
    if (sortBy === 'priceDesc') sortOptions.price = -1
    if (sortBy === 'ratingCountDesc') sortOptions.reviewCount = -1
    if (sortBy === 'likeCountDesc') sortOptions.likeCount = -1

    const products = await Product.find(filters)
      .sort(sortOptions)
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('category', 'name description')
      .exec()

    return res.status(200).json({
      success: true,
      products,
      message: 'Liked products fetched successfully.',
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalLikedProducts / limit),
        totalProducts: totalLikedProducts,
      },
    })
  } catch (error) {
    console.error('Error fetching liked products:', error.message)
    return res.status(500).json({
      success: false,
      message: 'An error occurred while fetching liked products.',
      error: error.message,
    })
  }
}

exports.getBestOfProducts = async (req, res) => {
    try {
        const products = await Product.find({})
            .populate('category') // 👈 زيادة هذه السلسلة ضرورية
            .limit(10);
        res.status(200).json({ success: true, products });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// دالة مؤقتة لتصحيح وربط المنتجات بالتصنيفات الحقيقية بناءً على النصوص القديمة
exports.fixCategoriesObjectId = async (req, res) => {
    try {
        const products = await Product.find({});
        let updatedCount = 0;

        for (let product of products) {
            // إذا كان الـ category عبارة عن نص (String) وليس ObjectId
            if (product.category && typeof product.category === 'string') {
                // نبحث عن التصنيف في كوليكشن Category بالاسم أو الـ slug
                let matchedCategory = await Category.findOne({ 
                    name: { $regex: new RegExp(`^${product.category}$`, 'i') } 
                });

                if (matchedCategory) {
                    product.category = matchedCategory._id; // استبداله بالـ ObjectId الحقيقي
                    await product.save();
                    updatedCount++;
                }
            }
        }

        return res.status(200).json({
            success: true,
            message: `تم تحديث ${updatedCount} منتج وربطهم بالتصنيفات بنجاح!`
        });
    } catch (error) {
        console.error('Error fixing categories:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
};
// مثال للدالة المسؤولة عن جلب جميع المنتجات المتزامنة
exports.getAllSyncProducts = async (req, res) => {
    try {
        const products = await Product.find({})
            .populate('category'); // 👈 هادي هي الكلمة السحرية اللي كتخلي الـ Backend يرجع الكاتيجوري كاملة مشي غير الـ ID
            
        res.status(200).json({ 
            success: true, 
            count: products.length, 
            products 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};