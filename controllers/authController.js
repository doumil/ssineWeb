const User = require("../models/User")
const axios = require('axios');
const jwt = require("jsonwebtoken")
const argon2 = require("argon2")
const Subscription = require("../models/Subscription")
const Like = require("../models/Like")
const Cart = require("../models/Cart")
const { createEmptyCartForUser } = require("../controllers/cartController")
// في authController.js
const { syncUserToWooCommerce } = require('../services/woocommerceSync');


async function checkAndSyncFromWooCommerce(email, plainPassword) {
    try {
        const WP_URL = process.env.WP_URL || 'https://ssine.net';
        const CONSUMER_KEY = process.env.WP_CONSUMER_KEY;
        const CONSUMER_SECRET = process.env.WP_CONSUMER_SECRET;

        // طلب جلب العملاء من WooCommerce بالإيميل
        const response = await axios.get(`${WP_URL}/wp-json/wc/v3/customers`, {
            params: { email: email },
            auth: {
                username: CONSUMER_KEY,
                password: CONSUMER_SECRET
            }
        });

        if (response.data && response.data.length > 0) {
            const wpCustomer = response.data[0];
            
            // تشفر الباسورد بـ Argon2 كيفما كيدير التطبيق ديما
            const hashedPassword = await argon2.hash(plainPassword);

            // نكرييو العميل في MongoDB ب نفس المعلومات
            const newUser = new User({
                email: wpCustomer.email,
                userFirstName: wpCustomer.first_name || '',
                userLastName: wpCustomer.last_name || '',
                password: hashedPassword,
                emailVerified: true, // حيت مفعل في الموقع
                signUpSource: 'web_site'
            });

            await newUser.save();
            return newUser;
        }
        return null;
    } catch (error) {
        console.error('Error syncing from WooCommerce during login:', error.message);
        return null;
    }
}
// CREATE USER
exports.createUser = async (req, res) => {
  try {
    // 1. التحقق واش الإيميل كاين مسبقاً (اختياري ولكن مهم)
    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }

    const hashedPassword = await argon2.hash(req.body.password, {
      type: argon2.argon2id,
    })

    const newUser = new User({
      userFirstName: req.body.userFirstName,
      userLastName: req.body.userLastName,
      email: req.body.email,
      password: hashedPassword,
      signUpSource: 'mobile_app' // تحديد أن التسجيل تم من التطبيق
    })

    const savedUser = await newUser.save()

    // Create an empty cart for the user
    const cartResult = await createEmptyCartForUser(savedUser._id)
    if (!cartResult.success) {
      await User.findByIdAndDelete(savedUser._id)
      return res.status(500).json({
        success: false,
        message: "Signup failed: Unable to create user cart.",
      })
    }

    // 🟢 مزامنة المستخدم وإرساله لـ WooCommerce (WordPress)
    try {
      await syncUserToWooCommerce({
        email: req.body.email,
        userFirstName: req.body.userFirstName,
        userLastName: req.body.userLastName,
        plainPassword: req.body.password // الباسورد العادي باش يتم إنشاؤه في الموقع
      });
    } catch (syncError) {
      console.error("Warning: Failed to sync user to WooCommerce:", syncError.message);
      // مكنحبسوش التسجيل إيلا وقع خطأ في المزامنة مع الموقع، باش يقدا المستخدم يدخل للتطبيق عادي
    }

    const accessToken = jwt.sign(
      {
        id: savedUser._id,
        email: savedUser.email,
        userFirstName: savedUser.userFirstName,
        userLastName: savedUser.userLastName,
        emailVerified: savedUser.emailVerified,
      },
      process.env.JWT_SEC,
      //{ expiresIn: "1h" }
    )

    const refreshToken = jwt.sign(
      {
        id: savedUser._id,
      },
      process.env.JWT_REFRESH_SEC,
      //{ expiresIn: "7d" }
    )

    savedUser.refreshToken = refreshToken
    await savedUser.save()

    const { password, ...others } = savedUser._doc

    res.status(201).json({ ...others, isSubscriber: false, accessToken, refreshToken })
  } catch (error) {
    console.error("Error during user signup:", error)
    res.status(500).json({ success: false, message: "Signup failed", error: error.message })
  }
}

// LOGIN USER
exports.loginUser = async (req, res) => {
  try {
    let user = await User.findOne({ email: req.body.email });

    // 1. إيلا ما كاينش في MongoDB، نتحققو واش كاين في WordPress (WooCommerce) ونزلوه
    if (!user) {
      user = await checkAndSyncFromWooCommerce(req.body.email, req.body.password);
    }

    if (!user) return res.status(401).json("Wrong Login Details");

    // 2. التحقق من الباسورد بـ Argon2
    const isPasswordValid = await argon2.verify(user.password, req.body.password);
    if (!isPasswordValid) {
      return res.status(401).json("Wrong Login Details");
    }

    // 🟢 3. محاولة مزامنة اليوزر مع WooCommerce في حال لم يكن مسجلاً هناك من قبل
    try {
      await syncUserToWooCommerce({
        email: user.email,
        userFirstName: user.userFirstName || '',
        userLastName: user.userLastName || '',
        plainPassword: req.body.password // الباسورد العادي اللي دخليه في الـ Login
      });
    } catch (wooError) {
      console.log("Note during login sync: User might already exist in WooCommerce or sync skipped.");
    }

    // 4. التحقق واش اليوزر عنده اشتراك نشط
    const activeSubscription = await Subscription.findOne({
      userId: user._id,
      isActive: true,
      status: "active",
    });

    const isSubscriber = !!activeSubscription;

    // 5. توليد Access Token
    const accessToken = jwt.sign(
      {
        id: user._id,
        email: user.email,
        userFirstName: user.userFirstName,
        userLastName: user.userLastName,
        emailVerified: user.emailVerified,
      },
      process.env.JWT_SEC
    );

    let refreshToken;

    try {
      jwt.verify(user.refreshToken, process.env.JWT_REFRESH_SEC);
      refreshToken = user.refreshToken;
    } catch (error) {
      refreshToken = jwt.sign({ id: user._id }, process.env.JWT_REFRESH_SEC);
      user.refreshToken = refreshToken;
      await user.save();
    }

    const likedProducts = await Like.find({ userId: user._id }).select("productId");
    const likedProductIds = likedProducts.map((like) => like.productId.toString());

    const cart = await Cart.findOne({ ownerId: user._id }).select("items");
    const cartItemIds = cart ? cart.items.map((item) => item.productId.toString()) : [];

    const { password, stripeCustomerId, ...others } = user._doc;

    return res.status(200).json({
      ...others,
      isSubscriber,
      accessToken,
      refreshToken,
      likedProductIds,
      cartItemIds,
    });

  } catch (error) {
    console.error("Error logging in user:", error.message);
    return res.status(500).json(error);
  }
};

// REFRESH TOKEN
exports.refreshToken = async (req, res) => {
  const { token } = req.body

  if (!token) {
    return res.status(403).json("Refresh token is required")
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SEC)
    const user = await User.findById(decoded.id)

    if (!user || user.refreshToken !== token) {
      return res.status(403).json("Invalid refresh token")
    }

    const newAccessToken = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SEC,
      //{ expiresIn: "1h" }
    )

    const newRefreshToken = jwt.sign(
      { id: user._id },
      process.env.JWT_REFRESH_SEC,
      //{ expiresIn: "7d" }
    )

    user.refreshToken = newRefreshToken
    await user.save()

    res.status(200).json({ accessToken: newAccessToken, refreshToken: newRefreshToken })
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error: error.message })
  }
}

// LOGOUT USER
exports.logoutUser = async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email })
    if (!user) return res.status(403).json("User not found")

    user.refreshToken = ""
    await user.save()

    res.status(200).json("User logged out")
  } catch (error) {
    res.status(500).json(error)
  }
}

// CHECK TOKENS
exports.checkTokens = async (req, res) => {
  const { accessToken, refreshToken } = req.body

  if (!accessToken || !refreshToken) {
    return res.status(400).json({
      success: false,
      message: "Access token and refresh token are required",
    })
  }

  try {
    jwt.verify(accessToken, process.env.JWT_SEC, async (err) => {
      if (!err) {
        return res.status(200).json({
          success: true,
          message: "Access token is still valid",
          accessToken,
          refreshToken,
        })
      }

      const user = await User.findOne({ refreshToken })
      if (!user) {
        return res.status(403).json({
          success: false,
          message: "Invalid refresh token",
        })
      }

      jwt.verify(refreshToken, process.env.JWT_REFRESH_SEC, async (err) => {
        if (err) {
          return res.status(403).json({
            success: false,
            message: "Invalid or expired refresh token",
          })
        }

        const newAccessToken = jwt.sign(
          {
            id: user._id,
            email: user.email,
            userFirstName: user.userFirstName,
            userLastName: user.userLastName,
            emailVerified: user.emailVerified,
          },
          process.env.JWT_SEC,
          //{ expiresIn: "1h" }
        )

        const newRefreshToken = jwt.sign(
          { id: user._id },
          process.env.JWT_REFRESH_SEC,
          //{ expiresIn: "7d" }
        )

        user.refreshToken = newRefreshToken
        await user.save()

        return res.status(200).json({
          success: true,
          message: "Access token refreshed",
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
        })
      })
    })
  } catch (error) {
    console.error("Error in checkTokens function:", error)
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    })
  }
}

