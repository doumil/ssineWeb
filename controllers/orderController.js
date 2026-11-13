const Order = require('../models/Order');
const Cart = require('../models/Cart');
const axios = require('axios');

exports.createCashOnDeliveryOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deliveryAddressId } = req.body;

    // 1. جلب السلة مع تفاصيل المنتجات
    const cart = await Cart.findOne({ ownerId: userId }).populate('items.productId');
    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty',
      });
    }

    let itemsTotal = 0;
    const orderItems = cart.items.map(item => {
      const itemTotal = item.productId.price * item.quantity;
      itemsTotal += itemTotal;
      return {
        productId: item.productId._id,
        quantity: item.quantity,
        price: item.productId.price,
        wooProductId: item.productId.wooProductId, // الـ ID ديال المنتج في ووردبريس
      };
    });

    const cargoFeeThreshold = 200; // حد التوصيل المجاني
    const cargoFee = itemsTotal >= cargoFeeThreshold ? 0 : (cart.cargoFee || 0);
    const totalAmount = itemsTotal + cargoFee;

    // 2. حفظ الطلب في MongoDB أولاً
    const newOrder = new Order({
      userId,
      items: orderItems.map(i => ({
        productId: i.productId,
        quantity: i.quantity,
        price: i.price,
      })),
      amount: totalAmount,
      currency: 'MAD',
      deliveryAddress: deliveryAddressId,
      status: 'pending',
      paymentMethod: 'COD',
    });

    await newOrder.save();

    // 3. إرسال الطلب إلى WooCommerce REST API مطابقة لمتغيرات الـ .env ديالك (WP_)
    try {
      const wcLineItems = orderItems.map(item => ({
        product_id: item.wooProductId,
        quantity: item.quantity,
      }));

      if (cargoFee > 0) {
        wcLineItems.push({
          name: 'Cargo Fee',
          total: cargoFee.toString(),
        });
      }

      const wcOrderData = {
        payment_method: 'cod',
        payment_method_title: 'Cash on Delivery',
        set_paid: false,
        line_items: wcLineItems,
      };

      const wcAuth = Buffer.from(
        `${process.env.WP_CONSUMER_KEY}:${process.env.WP_CONSUMER_SECRET}`
      ).toString('base64');

      await axios.post(
        `${process.env.WP_URL}/wp-json/wc/v3/orders`,
        wcOrderData,
        {
          headers: {
            Authorization: `Basic ${wcAuth}`,
            'Content-Type': 'application/json',
          },
        }
      );
      console.log('✅ Order successfully synced with WooCommerce!');
    } catch (wcError) {
      console.error('⚠️ Failed to sync order with WooCommerce:', wcError.response?.data || wcError.message);
    }

    // 4. تفريغ السلة بعد نجاح العملية
    cart.items = [];
    await cart.save();

    // 5. إرجاع الـ orderId الحقيقي للتطبيق باش يخدم بدون مشاكل 404
    res.status(201).json({
      success: true,
      message: 'Order created successfully and synced with WooCommerce',
      orderId: newOrder._id,
    });
  } catch (error) {
    console.error('Error creating COD order:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
    });
  }
};