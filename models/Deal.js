const mongoose = require('mongoose');

const DealSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product', // الربط مع Model ديال Product
      required: true,
    },
    dealOrder: {
      type: Number,
      required: true,
      default: 0,
    },
    imageUrl: {
      type: String,
    },
    title: {
      type: String,
    },
    description: {
      type: String,
    },
    action: {
      type: String,
      default: 'view_product',
    },
    aspectRatio: {
      type: String,
      enum: ['16:9', '4:3', '3:2'],
      default: '16:9',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Deal', DealSchema);