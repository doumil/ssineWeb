const mongoose = require('mongoose');

const ProductSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        default: ''
    },
    price: {
        type: Number,
        required: true
    },
    images: [{
        type: String
    }],
    // 👈 تعديل حقل category ليكون ربطاً حقيقياً مع موديل Category
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true
    },
    inStock: {
        type: Boolean,
        default: true
    },
    wooProductId: {
        type: Number,
        unique: true,
        sparse: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Product', ProductSchema);