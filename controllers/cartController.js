// ==========================================
// File: controllers/cart.controller.js
// ==========================================

const Cart = require("../models/Cart")
const Product = require("../models/Product")
const CARGO_FEE_THRESHOLD = 200 // TODO: store in db
const CARGO_FEE = 35 // TODO. TODO: store in db

exports.createEmptyCartForUser = async (userId) => {
  try {
    const newCart = new Cart({
      ownerId: userId,
      items: [],
    })

    await newCart.save()
    return { success: true, cart: newCart }
  } catch (error) {
    console.error("Error creating empty cart for user:", error)
    return { success: false, error }
  }
}

exports.getCart = async (req, res) => {
  try {
    const userId = req.user.id

    const cart = await Cart.findOne({ ownerId: userId }).populate({
      path: 'items.productId',
      select: 'images title cargoWeight stockCount price salePrice',
    })

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found',
      })
    }

    // تصفية العناصر لي مابقاش المنتج ديالهم موجود في القاعدة
    const validItems = cart.items.filter(item => item.productId != null);

    const transformedItems = validItems.map(item => ({
      productId: item.productId._id,
      title: item.productId.title,
      imageURL: item.productId.images && item.productId.images.length > 0 ? item.productId.images[0] : null,
      cargoWeight: item.productId.cargoWeight,
      stockCount: item.productId.stockCount,
      price: item.productId.salePrice ?? item.productId.price,
      quantity: item.quantity,
    }))

    const cargoFee = calculateCargoFee(cart)

    res.status(200).json({
      success: true,
      cart: {
        ownerId: cart.ownerId,
        items: transformedItems,
        updatedAt: cart.updatedAt,
        cargoFee: cargoFee,
      },
      cargoFeeThreshold: CARGO_FEE_THRESHOLD,
    })
  } catch (error) {
    console.error('Error fetching cart:', error)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cart',
      error: error.message,
    })
  }
}

// helper function to return the updated cart
const getTransformedCart = async (userId) => {
  try {
    const cart = await Cart.findOne({ ownerId: userId }).populate({
      path: "items.productId",
      select: "images title cargoWeight stockCount price salePrice",
    })

    if (!cart) {
      return { success: false, message: "Cart not found" }
    }

    const validItems = cart.items.filter(item => item.productId != null);

    const transformedItems = validItems.map((item) => ({
      productId: item.productId._id,
      title: item.productId.title,
      imageURL: item.productId.images && item.productId.images.length > 0 ? item.productId.images[0] : null,
      cargoWeight: item.productId.cargoWeight,
      stockCount: item.productId.stockCount,
      price: item.productId.salePrice ?? item.productId.price,
      quantity: item.quantity,
    }))

    const updatedCargoFee = calculateCargoFee(cart)

    cart.cargoFee = updatedCargoFee
    await cart.save()

    return {
      success: true,
      cart: {
        ownerId: cart.ownerId,
        items: transformedItems,
        updatedAt: cart.updatedAt,
        cargoFee: updatedCargoFee,
      },
    }
  } catch (error) {
    console.error("Error fetching and transforming cart:", error)
    return {
      success: false,
      message: "Failed to fetch cart",
      error: error.message,
    }
  }
}

exports.addItemToCart = async (req, res) => {
  try {
    const { productId, quantity } = req.body
    const userId = req.user.id

    const product = await Product.findById(productId)
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      })
    }

    if (product.stockCount < quantity) {
      return res.status(400).json({
        success: false,
        message: "Insufficient stock for the requested quantity",
      })
    }

    let cart = await Cart.findOne({ ownerId: userId })
    if (!cart) {
      cart = new Cart({ ownerId: userId, items: [] })
    }

    const existingCartItem = cart.items.find((item) =>
      item.productId && item.productId.equals(productId)
    )

    if (existingCartItem) {
      existingCartItem.quantity += quantity

      if (existingCartItem.quantity > product.stockCount) {
        return res.status(400).json({
          success: false,
          message: "Not enough stock to fulfill the cart update",
          updatedQuantity: existingCartItem.quantity - 1,
        })
      }
    } else {
      cart.items.push({ productId, quantity })
    }

    await cart.save()

    const updatedCart = await getTransformedCart(userId)

    if (!updatedCart.success) {
      return res.status(404).json(updatedCart)
    }

    res.status(200).json({
      success: true,
      message: "Item added to cart successfully",
      cart: updatedCart.cart,
      cargoFeeThreshold: CARGO_FEE_THRESHOLD
    })
  } catch (error) {
    console.error("Error adding item to cart:", error)
    res.status(500).json({
      success: false,
      message: "Failed to add item to cart",
      error: error.message,
    })
  }
}

exports.deleteItemFromCart = async (req, res) => {
  try {
    const { productId } = req.params
    const userId = req.user.id

    const cart = await Cart.findOne({ ownerId: userId })
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      })
    }

    const itemIndex = cart.items.findIndex((item) =>
      item.productId && item.productId.equals(productId)
    )

    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Item not found in cart",
      })
    }

    cart.items.splice(itemIndex, 1)
    await cart.save()

    const updatedCart = await getTransformedCart(userId)

    if (!updatedCart.success) {
      return res.status(404).json(updatedCart)
    }

    res.status(200).json({
      success: true,
      message: "Item removed from cart successfully",
      cart: updatedCart.cart,
      cargoFeeThreshold: CARGO_FEE_THRESHOLD
    })
  } catch (error) {
    console.error("Error removing item from cart:", error)
    res.status(500).json({
      success: false,
      message: "Failed to remove item from cart",
      error: error.message,
    })
  }
}

exports.decrementQuantity = async (req, res) => {
  try {
    const { productId } = req.body
    const userId = req.user.id

    const cart = await Cart.findOne({ ownerId: userId })
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      })
    }

    const itemIndex = cart.items.findIndex((item) =>
      item.productId && item.productId.equals(productId)
    )

    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Item not found in cart",
      })
    }

    cart.items[itemIndex].quantity -= 1

    if (cart.items[itemIndex].quantity <= 0) {
      cart.items.splice(itemIndex, 1)
    }

    await cart.save()

    const updatedCart = await getTransformedCart(userId)

    if (!updatedCart.success) {
      return res.status(404).json(updatedCart)
    }

    res.status(200).json({
      success: true,
      message: "Quantity decremented successfully",
      cart: updatedCart.cart,
      cargoFeeThreshold: CARGO_FEE_THRESHOLD
    })
  } catch (error) {
    console.error("Error decrementing item quantity in cart:", error)
    res.status(500).json({
      success: false,
      message: "Failed to decrement item quantity",
      error: error.message,
    })
  }
}

exports.addItemToCartOnFeed = async (req, res) => {
  try {
    const { productId } = req.body
    const userId = req.user.id
    const quantity = 1

    const product = await Product.findById(productId)
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      })
    }

    if (product.stockCount < quantity) {
      return res.status(400).json({
        success: false,
        message: "Insufficient stock for the product",
      })
    }

    let cart = await Cart.findOne({ ownerId: userId })
    if (!cart) {
      cart = new Cart({ ownerId: userId, items: [] })
    }

    const existingCartItem = cart.items.find((item) =>
      item.productId && item.productId.equals(productId)
    )

    if (existingCartItem) {
      existingCartItem.quantity += quantity

      if (existingCartItem.quantity > product.stockCount) {
        return res.status(400).json({
          success: false,
          message: "Not enough stock to fulfill the cart update",
        })
      }
    } else {
      cart.items.push({ productId, quantity })
    }

    await cart.save()
    await cart.populate({
      path: 'items.productId',
      select: 'price salePrice',
    })

    cart.cargoFee = calculateCargoFee(cart)
    await cart.save()

    res.status(200).json({
      success: true,
      message: "Item added to cart successfully",
    })
  } catch (error) {
    console.error("Error adding item to cart on feed:", error)
    res.status(500).json({
      success: false,
      message: "Failed to add item to cart",
      error: error.message,
    })
  }
}

exports.getCartProductIds = async (req, res) => {
  try {
    const userId = req.user.id

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
      })
    }

    const cart = await Cart.findOne({ ownerId: userId }).select('items.productId')

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: 'Cart not found',
      })
    }

    const productIds = cart.items
      .filter(item => item.productId != null)
      .map(item => item.productId.toString())

    res.status(200).json({
      success: true,
      productIds,
    })
  } catch (error) {
    console.error('Error fetching cart product IDs:', error.message)
    res.status(500).json({
      success: false,
      message: 'Failed to fetch cart product IDs',
      error: error.message,
    })
  }
}

const calculateCargoFee = (cart) => {
  if (!cart) {
    throw new Error("Cart is required")
  }

  const validItems = cart.items.filter(item => item.productId != null);

  const totalAmount = validItems.reduce((sum, item) => {
    const productPrice = item.productId.salePrice ?? item.productId.price;
    if (typeof productPrice !== "number") {
      return sum;
    }

    return sum + item.quantity * productPrice
  }, 0)

  return totalAmount > CARGO_FEE_THRESHOLD ? 0 : CARGO_FEE
}