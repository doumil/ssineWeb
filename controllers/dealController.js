const Deal = require('../models/Deal');

exports.getDeals = async (req, res) => {
  try {
    const deals = await Deal.find()
      .sort({ dealOrder: 1 })
      .populate('product') // كيجيب كاع معلومات المنتج المربوط بالصفقة
      .exec();

    // تصفية الصفقات باش نحيدو أي صفقة المنتج ديالها تمسح من قاعدة البيانات
    const validDeals = deals.filter((deal) => deal.product !== null);

    res.status(200).json({ deals: validDeals });
  } catch (error) {
    console.error('Error fetching deals:', error);
    res.status(500).json({
      message: 'Failed to fetch deals',
      error: error.message,
    });
  }
};