process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Bypass local SSL verification

require('dotenv').config();
const WooCommerceRestApi = require("@woocommerce/woocommerce-rest-api").default;
const Product = require('../models/Product');
const Category = require('../models/Category');
const argon2 = require("argon2");
const User = require("../models/User");
const Review = require('../models/Review'); // 👈 تأكد بلي Review مضاف حتى هو الفوق

const WooCommerce = new WooCommerceRestApi({
  url: 'https://ssine.net',
  consumerKey: 'ck_6b25f2b99040b2ad023684fcfaa2bbf271c8bc15',
  consumerSecret: 'cs_891aed6216cdeb7510722524178474e2d239294f',
  version: 'wc/v3',
  queryStringAuth: true,
  wpAPIPrefix: 'wp-json',
  timeout: 30000
});

// 1. دالة مزامنة المنتجات والفئات من WooCommerce
const syncAllFromWooCommerce = async () => {
  try {
    console.log("🚀 Starting synchronization process...");

    // Fetch Categories
    console.log("📦 Fetching categories from WooCommerce...");
    const catResponse = await WooCommerce.get("products/categories", { per_page: 50 });
    
    if (!Array.isArray(catResponse.data)) {
      console.log("❌ RAW RESPONSE IS NOT AN ARRAY. TYPE:", typeof catResponse.data);
      throw new Error("API did not return a valid categories array. Check permalinks or WordPress settings.");
    }
    
    const wooCategories = catResponse.data;
    console.log(`Successfully fetched ${wooCategories.length} categories.`);

    for (const cat of wooCategories) {
      await Category.findOneAndUpdate(
        { wooCategoryId: cat.id },
        {
          name: cat.name,
          slug: cat.slug,
          image: cat.image ? cat.image.src : '',
          wooCategoryId: cat.id
        },
        { upsert: true, new: true }
      );
    }
    console.log(`✅ ${wooCategories.length} categories saved to MongoDB!`);

    // Fetch Products
    console.log("🛍️ Fetching products from WooCommerce...");
    const prodResponse = await WooCommerce.get("products", { per_page: 50, status: 'any' });

    if (!Array.isArray(prodResponse.data)) {
      throw new Error("API did not return a valid products array.");
    }

    const wooProducts = prodResponse.data;
    console.log(`Successfully fetched ${wooProducts.length} products.`);

    for (const prod of wooProducts) {
      await Product.findOneAndUpdate(
        { wooProductId: prod.id },
        {
          title: prod.name,
          description: prod.description ? prod.description.replace(/<[^>]*>?/gm, '') : '',
          price: parseFloat(prod.price || prod.regular_price || 0),
          images: prod.images.map(img => img.src),
          category: prod.categories[0]?.name || 'Uncategorized',
          inStock: prod.in_stock,
          wooProductId: prod.id
        },
        { upsert: true, new: true }
      );
    }
    console.log(`✅ ${wooProducts.length} products saved to MongoDB!`);

    return {
      categoriesCount: wooCategories.length,
      productsCount: wooProducts.length
    };

  } catch (error) {
    console.error("❌ Sync failed with error:", error.message);
    throw error;
  }
};

// 2. دالة مزامنة المستخدمين الجدد مع WooCommerce
const syncUserToWooCommerce = async (userData) => {
  try {
    const existingCustomers = await WooCommerce.get("customers", {
      email: userData.email
    });

    if (existingCustomers.data && existingCustomers.data.length > 0) {
      console.log('Customer already exists in WooCommerce:', existingCustomers.data[0].id);
      return existingCustomers.data[0];
    }

    const response = await WooCommerce.post("customers", {
      email: userData.email,
      first_name: userData.userFirstName || '',
      last_name: userData.userLastName || '',
      username: userData.email.split('@')[0],
      password: userData.plainPassword
    });

    console.log('Customer synced to WooCommerce successfully:', response.data.id);
    return response.data;
  } catch (error) {
    console.error('Error syncing user to WooCommerce:', error.response?.data || error.message);
  }
};

// 3. التحقق والمزامنة من WooCommerce أثناء Login
const checkAndSyncFromWooCommerce = async (email, password) => {
  try {
    const response = await WooCommerce.get("customers", { email: email });
    
    if (response.data && response.data.length > 0) {
      const wooCustomer = response.data[0];

      const hashedPassword = await argon2.hash(password);

      const newUser = new User({
        email: wooCustomer.email,
        userFirstName: wooCustomer.first_name || '',
        userLastName: wooCustomer.last_name || '',
        password: hashedPassword,
        emailVerified: true
      });

      await newUser.save();
      console.log("✅ User synced from WooCommerce to MongoDB successfully during login.");
      return newUser;
    }
    return null;
  } catch (error) {
    console.error("Error checking WooCommerce for user:", error.message);
    return null;
  }
};

// 4. دالة مزامنة التقييمات
async function syncReviewsFromWooCommerce() {
  try {
    console.log("🔄 بدأت عملية مزامنة التقييمات من WooCommerce...");

    const response = await WooCommerce.get("products/reviews", {
      per_page: 100,
    });

    const wooReviews = response.data;

    for (const wooReview of wooReviews) {
      const product = await Product.findOne({ wooProductId: wooReview.product_id });

      if (!product) {
        console.warn(`⚠️ المنتج ذو الـ ID WooCommerce ${wooReview.product_id} غير موجود في MongoDB. تجاوز التقييم.`);
        continue;
      }

      const user = await User.findOne({ email: wooReview.reviewer_email });

      await Review.findOneAndUpdate(
        { wooCommerceReviewId: wooReview.id },
        {
          productId: product._id,
          userId: user ? user._id : null,
          rating: wooReview.rating,
          comment: wooReview.review.replace(/<[^>]*>?/gm, ''),
          wooCommerceReviewId: wooReview.id,
          createdAt: new Date(wooReview.date_created),
        },
        { upsert: true, new: true }
      );
    }

    console.log("✅ تم استيراد ومزامنة التقييمات بنجاح من WooCommerce إلى MongoDB!");
  } catch (error) {
    console.error("❌ خطأ أثناء مزامنة التقييمات:", error.message);
  }
}

// 🚀 التصدير الموحد لجميع الدوال بدون تكرار
module.exports = {
  syncAllFromWooCommerce,
  syncUserToWooCommerce,
  checkAndSyncFromWooCommerce,
  syncReviewsFromWooCommerce
};