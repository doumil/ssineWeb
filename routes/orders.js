const express = require('express')
const router = express.Router()
const orderController = require('../controllers/orderController') // تأكد واش سمية الملف orderController ولا order.controller
const { verifyToken } = require('../middleware/verifyToken')

// 1. إنشاء طلب Cash on Delivery جديد وتزامن مع WooCommerce
router.post('/create-cod', verifyToken, orderController.createCashOnDeliveryOrder)

router.get('/get-user-orders', verifyToken, orderController.getUserOrders)

router.get('/get-order-details/:orderId', verifyToken, orderController.getOrderDetails)

router.get('/get-latest-order-details', verifyToken, orderController.getLatestOrderDetails)

router.put('/cancel-order/:orderId', verifyToken, orderController.cancelOrder)

module.exports = router