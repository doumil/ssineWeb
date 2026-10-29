require('dotenv').config()

const express = require('express')
const app = express()
const bodyParser = require('body-parser')
const mongoose = require('mongoose')
const rateLimit = require('express-rate-limit')
const { USE_REDIS } = require('./config/env')
const createRedisClient = require('./services/redisClient')
const cronJobs = require('./cronJobs')

const { syncReviewsFromWooCommerce } = require('./services/woocommerceSync');

const authRoute = require('./routes/auth')
const dealsRoute = require('./routes/deals')
const categoryRoute = require('./routes/categories')
const productsRoute = require('./routes/products')
const cartRoute = require('./routes/cart')
const paymentRoute = require('./routes/payments')
const addressRoute = require('./routes/address')
const ordersRoute = require('./routes/orders')
const subscriptionsRoute = require('./routes/subscriptions')
const trialProductsRoute = require('./routes/trialProducts')
const trialsRoute = require('./routes/trials')
const reviewsRoute = require('./routes/reviews')
const aiSuggestionsRoute = require('./routes/aiSuggestions')
const likesRoute = require('./routes/likes')
const trendingSearchesRoute = require('./routes/searchTrends')
const userProfilesRoute = require('./routes/userProfiles')
const webhooksRoute = require('./routes/webhooks')

app.set('trust proxy', 1)

const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: 'Too many requests!',
})

const paymentLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,
  message: 'Too many requests!.',
})

app.use(globalLimiter)

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

app.use('/api/payments', paymentLimiter, paymentRoute)

app.use('/api', authRoute)
app.use('/api/deals', dealsRoute)
app.use('/api/categories', categoryRoute)
app.use('/api/products', productsRoute)
app.use('/api/carts', cartRoute)
app.use('/api/address', addressRoute)
app.use('/api/orders', ordersRoute)
app.use('/api/subscriptions', subscriptionsRoute)
app.use('/api/trialProducts', trialProductsRoute)
app.use('/api/trials', trialsRoute)
app.use('/api/reviews', reviewsRoute)
app.use('/api/aiSuggestions', aiSuggestionsRoute)
app.use('/api/likes', likesRoute)
app.use('/api/trendingSearches', trendingSearchesRoute)
app.use('/api/userProfiles', userProfilesRoute)
app.use('/api/webhooks', webhooksRoute)

const PORT = process.env.PORT || 5001

// 1️⃣ Démarrer immédiatement le serveur HTTP pour que Render détecte le port ouvert
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
})

// 2️⃣ Récupérer la variable d'environnement (compatible MONGODB_URI et MONGO_URI)
const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI

if (!mongoURI) {
  console.error('❌ ERREUR CRITIQUE: Ni MONGODB_URI ni MONGO_URI ne sont définis dans les variables d’environnement !')
}

// 3️⃣ Se connecter à MongoDB en arrière-plan
mongoose
  .connect(mongoURI)
  .then(async () => {
    console.log('✅ Connected to MongoDB successfully!')

    try {
      await syncReviewsFromWooCommerce()
      console.log('✅ Synchronised WooCommerce reviews successfully!')
    } catch (syncErr) {
      console.error('❌ Sync WooCommerce reviews error:', syncErr.message)
    }

    try {
      const AdminJS = (await import('adminjs')).default
      const expressModule = await import('@adminjs/express')
      const AdminJSExpress = expressModule.default || expressModule
      const mongooseModule = await import('@adminjs/mongoose')
      const AdminJSMongoose = mongooseModule.default || mongooseModule

      AdminJS.registerAdapter(AdminJSMongoose)

      const admin = new AdminJS({
        databases: [mongoose],
        rootPath: '/admin',
      })

      const adminRouter = AdminJSExpress.buildRouter(admin)
      app.use(admin.options.rootPath, adminRouter)
      console.log('AdminJS started at /admin')
    } catch (err) {
      console.log('AdminJS failed to load:', err.message)
    }

    if (USE_REDIS) {
      createRedisClient()
    }
  })
  .catch((err) => {
    console.error('❌ MongoDB Connection Error:', err)
  })