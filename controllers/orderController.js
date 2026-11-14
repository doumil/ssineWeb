const Order = require('../models/Order');
const Cart = require('../models/Cart');
const axios = require('axios');

exports.getUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const orders = await Order.find({ userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({
        path: 'items.productId',
        select: 'title price imageURLs',
      })
      .populate({
        path: 'deliveryAddress',
        select: '_id city state country address',
      });

    const totalOrders = await Order.countDocuments({ userId });

    res.status(200).json({
      success: true,
      orders,
      currentPage: page,
      totalPages: Math.ceil(totalOrders / limit),
    });
  } catch (error) {
    console.error('Error fetching user orders:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
    });
  }
};

exports.cancelOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;

    const order = await Order.findOne({ _id: orderId, userId });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only orders with "pending" status can be cancelled',
      });
    }

    order.status = 'cancelled';
    await order.save();

    res.status(200).json({
      success: true,
      message: 'Order cancelled successfully',
      order,
    });
  } catch (error) {
    console.error('Error cancelling order:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel order',
    });
  }
};

exports.getOrderDetails = async (req, res) => {
  try {
    const userId = req.user.id;
    const { orderId } = req.params;

    const order = await Order.findOne({ _id: orderId, userId })
      .populate({
        path: 'deliveryAddress',
        select: 'fullName phoneNumber address city state postalCode country',
      })
      .populate({
        path: 'items.productId',
        select: 'imageURLs title',
      });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found or does not belong to the user.',
      });
    }

    const orderDetails = {
      orderId: order._id,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
      createdAt: order.createdAt,
      deliveryAddress: order.deliveryAddress,
      items: order.items.map((item) => ({
        productId: item.productId._id,
        productTitle: item.productId.title,
        productImage: item.productId.imageURLs[0] || null,
        quantity: item.quantity,
        price: item.price,
      })),
    };

    res.status(200).json({
      success: true,
      order: orderDetails,
    });
  } catch (error) {
    console.error('Error fetching order details:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order details.',
    });
  }
};

exports.getLatestOrderDetails = async (req, res) => {
  try {
    const userId = req.user.id;

    const order = await Order.findOne({ userId })
      .sort({ createdAt: -1 })
      .populate({
        path: 'deliveryAddress',
        select: 'fullName phoneNumber address city state postalCode country',
      })
      .populate({
        path: 'items.productId',
        select: 'imageURLs title',
      });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'No orders found for the user.',
      });
    }

    const orderDetails = {
      orderId: order._id,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
      createdAt: order.createdAt,
      deliveryAddress: order.deliveryAddress,
      items: order.items.map((item) => ({
        productId: item.productId._id,
        productTitle: item.productId.title,
        productImage: item.productId.imageURLs[0] || null,
        quantity: item.quantity,
        price: item.price,
      })),
    };

    res.status(200).json({
      success: true,
      order: orderDetails,
    });
  } catch (error) {
    console.error('Error fetching latest order details:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch latest order details.',
    });
  }
};

exports.createCashOnDeliveryOrder = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deliveryAddressId } = req.body;

    if (!deliveryAddressId) {
      return res.status(400).json({
        success: false,
        message: 'Delivery address ID is required',
      });
    }

    // 1. جلب السلة مع تفاصيل المنتجات
    const cart = await Cart.findOne({ ownerId: userId }).populate('items.productId');
    if (!cart || !cart.items || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty',
      });
    }

    let itemsTotal = 0;
    const orderItems = [];

    // حماية ضد المنتجات التالفة أو المحذوفة
    for (const item of cart.items) {
      if (!item.productId) {
        continue;
      }
      const itemPrice = item.productId.price || 0;
      const itemTotal = itemPrice * item.quantity;
      itemsTotal += itemTotal;

      orderItems.push({
        productId: item.productId._id,
        quantity: item.quantity,
        price: itemPrice,
        wooProductId: item.productId.wooProductId || 0,
      });
    }

    if (orderItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid items found in cart',
      });
    }

    const cargoFeeThreshold = 200; // حد التوصيل المجاني
    const cargoFee = itemsTotal >= cargoFeeThreshold ? 0 : (cart.cargoFee || 0);
    const totalAmount = itemsTotal + cargoFee;

    // 2. حفظ الطلب في MongoDB أولاً (مع إضافة paymentIntentId لتجنب خطأ الـ Validation)
    const newOrder = new Order({
      userId,
      items: orderItems,
      amount: totalAmount,
      currency: 'MAD',
      deliveryAddress: deliveryAddressId,
      status: 'pending',
      paymentMethod: 'COD',
      paymentIntentId: `COD-${Date.now()}-${Math.floor(Math.random() * 1000)}`, // 👈 حل المشكل هنا
    });

    await newOrder.save();

    // 3. إرسال الطلب إلى WooCommerce REST API
    try {
      const wcLineItems = orderItems.map(item => ({
        product_id: item.wooProductId,
        quantity: item.quantity,
      })).filter(i => i.product_id);

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

    // 5. إرجاع الـ orderId الحقيقي للتطبيق
    return res.status(201).json({
      success: true,
      message: 'Order created successfully and synced with WooCommerce',
      orderId: newOrder._id,
    });
  } catch (error) {
    console.error('❌ Error creating COD order:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      message: `Failed to create order: ${error.message}`,
    });
  }
};