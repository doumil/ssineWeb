const mongoose = require('mongoose')

const ReviewSchema = new mongoose.Schema({
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false // 👈 ردناها false حيت التقييمات ديال Woo يقدر ما يكونش اليوزر مسجل عندنا
    },
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: false // 👈 ردناها false حيت التقييمات ديال Woo ما عندهاش orderId محلي
    },
    rating: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    comment: {
        type: String,
        default: ''
    },
    // 👈 زدنا هاد الحقل الجديد الخاص بمزامنة WooCommerce
    wooCommerceReviewId: {
        type: Number,
        unique: true,
        sparse: true
    }
}, { timestamps: true })

module.exports = mongoose.model('Review', ReviewSchema)