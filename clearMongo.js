const mongoose = require('mongoose');

// تأكد من مسار النماذج لديك إذا كان مختلفاً
require('./models/Category');
require('./models/Product');
const Category = mongoose.model('Category');
const Product = mongoose.model('Product');

const MONGO_URI = "mongodb+srv://yassinedoumil96_db_user:Yn5lN2xowAmIae35@cluster0.ybvgazg.mongodb.net/trizy?retryWrites=true&w=majority";

async function clearDB() {
  try {
    console.log("🔄 جاري الاتصال بقاعدة البيانات...");
    await mongoose.connect(MONGO_URI);
    console.log("✅ تم الاتصال بنجاح.\n");
    
    // حذف جميع المنتجات
    await Product.deleteMany({});
    console.log("🗑️ تم حذف جميع المنتجات من MongoDB.");
    
    // حذف جميع التصنيفات
    await Category.deleteMany({});
    console.log("🗑️ تم حذف جميع التصنيفات من MongoDB.");
    
    console.log("\n🎉 تمت عملية التنظيف بنجاح!");
    process.exit(0);
  } catch (error) {
    console.error("❌ حدث خطأ أثناء التنظيف:", error);
    process.exit(1);
  }
}

clearDB();