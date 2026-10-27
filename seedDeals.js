const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Product = require('./models/Product'); 
const Deal = require('./models/Deal');       

dotenv.config();

const createDealsFromProducts = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB...');

    await Deal.deleteMany({});
    console.log('🧹 Cleaned existing deals collection.');

    // جلب أحدث 5 منتجات
    const products = await Product.find({}).sort({ createdAt: -1 }).limit(5);

    if (products.length === 0) {
      console.log('⚠️ No products found in Database!');
      process.exit(1);
    }

    const dealPromises = products.map((product, index) => {
      // التأكد من جلب الصورة الصحيحة من الـ Product
      let img = '';
      if (product.images && product.images.length > 0) {
        img = product.images[0];
      } else if (product.image) {
        img = product.image;
      }

      return new Deal({
        product: product._id, // ربط الـ ID الحقيقي للمنتج
        dealOrder: index + 1,
        title: product.name || product.title || 'Special Deal',
        description: product.description || 'Great offer on this product!',
        imageUrl: img,        // الصورة الحقيقية للمنتج
        action: 'view_product',
        aspectRatio: '16:9',
      }).save();
    });

    await Promise.all(dealPromises);
    console.log(`🚀 Successfully created ${products.length} deals linked properly!`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Connection closed.');
  }
};

createDealsFromProducts();