const Order = require('../models/Order');
const Cart = require('../models/Cart');
const mongoose = require('mongoose');
const axios = require('axios');

const deliveryAddressSchema = new mongoose.Schema({
  userId: String,
  fullName: String,
  phoneNumber: String,
  address: String,
  city: String,
  state: String,
  postalCode: String,
  country: String,
});

const DeliveryAddressTemp = mongoose.models.DeliveryAddress || mongoose.model('DeliveryAddress', deliveryAddressSchema);

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
        select: 'title price images',
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
        select: 'images title',
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
      deliveryAddress: order.deliveryAddress || {},
      items: (order.items || []).map((item) => ({
        productId: item.productId ? item.productId._id : null,
        productTitle: item.productId ? item.productId.title : 'Product Unavailable',
        productImage: (item.productId && item.productId.images && item.productId.images.length > 0) 
          ? item.productId.images[0] 
          : null,
        quantity: item.quantity,
        price: item.price,
      })),
    };

    return res.status(200).json({
      success: true,
      order: orderDetails,
    });
  } catch (error) {
    console.error('❌ Error fetching order details:', error.message, error.stack);
    return res.status(500).json({
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
        select: 'images title',
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
        productImage: (item.productId.images && item.productId.images.length > 0) ? item.productId.images[0] : null,
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

    const deliveryAddress = await DeliveryAddressTemp.findById(deliveryAddressId);

    const cart = await Cart.findOne({ ownerId: userId }).populate('items.productId');
    if (!cart || !cart.items || !cart.items.length) {
      return res.status(400).json({
        success: false,
        message: 'Cart is empty',
      });
    }

    let itemsTotal = 0;
    const orderItems = [];
    const wcLineItems = [];

    for (const item of cart.items) {
      if (!item.productId) continue;
      
      const productDoc = item.productId;
      const itemPrice = productDoc.price || 0;
      const wooId = productDoc.wooProductId ? Number(productDoc.wooProductId) : 0;

      itemsTotal += itemPrice * item.quantity;

      orderItems.push({
        productId: productDoc._id,
        quantity: item.quantity,
        price: itemPrice,
        wooProductId: wooId,
      });

      if (wooId > 0) {
        wcLineItems.push({
          product_id: wooId,
          quantity: item.quantity,
        });
      }
    }

    const cargoFeeThreshold = 200;
    const cargoFee = itemsTotal >= cargoFeeThreshold ? 0 : (cart.cargoFee || 0);
    const totalAmount = itemsTotal + cargoFee;

    if (cargoFee > 0) {
      wcLineItems.push({
        name: 'Cargo Fee',
        total: cargoFee.toString(),
      });
    }

    const newOrder = new Order({
      userId,
      items: orderItems,
      amount: totalAmount,
      currency: 'MAD',
      deliveryAddress: deliveryAddressId,
      status: 'pending',
      paymentMethod: 'COD',
      paymentIntentId: `COD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    });

    await newOrder.save();

    // إرسال الطلب إلى WooCommerce مع بيانات العنوان والزبون بالكامل
    try {
      const clientName = deliveryAddress?.fullName || req.user?.name || req.user?.username || 'Yassine';
      const clientPhone = deliveryAddress?.phoneNumber || req.user?.phone || '0669533686';
      const clientEmail = req.user?.email || 'yassinedoumil96@gmail.com';

      const billingShippingData = {
        first_name: clientName,
        last_name: '',
        address_1: deliveryAddress?.address || '153',
        city: deliveryAddress?.city || 'Casablanca',
        state: deliveryAddress?.state || 'Morocco',
        postcode: deliveryAddress?.postalCode || '20220',
        country: deliveryAddress?.country || 'MA',
        email: clientEmail,
        phone: clientPhone
      };

      const wcOrderData = {
        payment_method: 'cod',
        payment_method_title: 'Cash on Delivery',
        status: 'processing',
        set_paid: false,
        billing: billingShippingData,
        shipping: billingShippingData,
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
      console.log('✅ Order successfully synced with WooCommerce with full address & name!');
    } catch (wcError) {
      console.error('❌ WooCommerce Sync Error Details:', {
        status: wcError.response?.status,
        data: wcError.response?.data,
        message: wcError.message
      });
    }

    cart.items = [];
    await cart.save();

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