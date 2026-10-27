const Review = require('../models/Review')
const Product = require('../models/Product')
const Order = require('../models/Order')
const axios = require('axios') // تأكد من استيراد axios إذا لم يكن موجوداً

exports.createReview = async (req, res) => {
  try {
    const { productId, rating, comment, orderId } = req.body;
    const userId = req.user._id;

    // 1. التحقق من orderId فقط إذا كان صالحاً وليس "none" أو فارغاً لتجنب خطأ CastError
    if (orderId && orderId !== "none" && orderId.trim() !== "") {
      const order = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found.' });
      }
    }

    // 2. البحث عن المنتج في MongoDB
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    // 3. حفظ التقييم في MongoDB
    const newReview = new Review({
      productId,
      userId,
      rating,
      comment,
      orderId: (orderId && orderId !== "none" && orderId.trim() !== "") ? orderId : undefined
    });
    await newReview.save();

    // 4. إرسال التقييم تلقائياً إلى WooCommerce REST API مع تحويل rating إلى Integer
    try {
      const wpUrl = process.env.WP_URL; 
      const consumerKey = process.env.WP_CONSUMER_KEY;
      const consumerSecret = process.env.WP_CONSUMER_SECRET;

      const wooProductId = product.wooProductId || product.wpId;

      if (wooProductId && wpUrl) {
        await axios.post(
          `${wpUrl}/wp-json/wc/v3/products/reviews`,
          {
            product_id: wooProductId, 
            reviewer: req.user.userFirstName ? `${req.user.userFirstName} ${req.user.userLastName || ''}` : "Customer",
            reviewer_email: req.user.email || "customer@ssine.net",
            review: comment,
            rating: parseInt(rating, 10), // <--- تم التعديل هنا لضمان إرساله كـ Integer
          },
          {
            auth: {
              username: consumerKey,
              password: consumerSecret,
            },
          }
        );
      }
    } catch (wooError) {
      console.error('Failed to sync review to WooCommerce:', wooError.response?.data || wooError.message);
    }

    // 5. حساب وتحديث averageRating و reviewCount بشكل صحيح ومضبوط في MongoDB للمنتج
    const allReviews = await Review.find({ productId });
    const totalReviews = allReviews.length;
    const sumRatings = allReviews.reduce((acc, rev) => acc + rev.rating, 0);
    const averageRating = totalReviews > 0 ? parseFloat((sumRatings / totalReviews).toFixed(1)) : 0;

    product.averageRating = averageRating;
    product.reviewCount = totalReviews;
    await product.save();

    res.status(201).json({
      success: true,
      message: 'Review created and synced to WooCommerce successfully!',
      review: newReview,
      averageRating,
      totalReviews,
    });

  } catch (error) {
    console.error('Error adding review:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create review.',
      error: error.message,
    });
  }
};

exports.getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const reviews = await Review.find({ productId })
      .populate('userId', 'userFirstName userLastName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const totalReviews = await Review.countDocuments({ productId });

    const product = await Product.findById(productId).select('averageRating');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    let calculatedAverage = product.averageRating || 0;
    if (calculatedAverage === 0 && reviews.length > 0) {
      const sum = reviews.reduce((acc, rev) => acc + rev.rating, 0);
      calculatedAverage = sum / reviews.length;
    }

    const averageRating = parseFloat((calculatedAverage || 0).toFixed(1));

    res.status(200).json({
      success: true,
      reviews,
      averageRating,
      totalReviews,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalReviews / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews.',
      error: error.message,
    });
  }
};

exports.deleteComment = async (req, res) => {
  try {
    const { reviewId } = req.params
    const userId = req.user.id

    const review = await Review.findById(reviewId)
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found.',
      })
    }

    if (review.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to delete this review.',
      })
    }

    const productId = review.productId
    const rating = review.rating

    await Review.deleteOne({ _id: reviewId })

    res.status(200).json({
      success: true,
      message: 'Review deleted successfully.',
    })

    const product = await Product.findById(productId)
    if (product && product.reviewCount > 0) {
      product.reviewCount -= 1
      if (product.reviewCount === 0) {
        product.averageRating = 0.0
      } else {
        product.averageRating = parseFloat(
          (
            (product.averageRating * (product.reviewCount + 1) - rating) /
            product.reviewCount
          ).toFixed(1)
        )
      }
      await product.save()
    }
  } catch (error) {
    console.error('Error deleting review:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to delete review.',
      error: error.message,
    })
  }
}

exports.getReviewableProducts = async (req, res) => {
  try {
    const { orderId } = req.params
    const userId = req.user.id

    const order = await Order.findById(orderId)
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found.',
      })
    }

    if (order.userId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You are not authorized to access this order.',
      })
    }

    const productIds = order.items.map((item) => item.productId)

    const userReviews = await Review.find({ orderId, userId }).select('productId')

    const reviewedProductIds = userReviews.map((review) => review.productId.toString())

    const reviewableProductIds = productIds.filter(
      (productId) => !reviewedProductIds.includes(productId.toString())
    )

    const reviewableProducts = await Product.find({ _id: { $in: reviewableProductIds } })
      .select('_id imageURLs title')

    res.status(200).json({
      success: true,
      reviewableProducts,
    })
  } catch (error) {
    console.error('Error retrieving reviewable products:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve reviewable products.',
      error: error.message,
    })
  }
}