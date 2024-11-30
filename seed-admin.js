'use strict'

const { MongoClient } = require('mongodb')
const { randomUUID } = require('crypto')
const generateHash = require('./routes/auth/generate-hash')
const config = require('./plugins/config')

async function seedAdminUser() {
  const uri = config.mongo.uri // MongoDB connection string
  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true })

  try {
    await client.connect()
    const db = client.db(config.mongo.database)
    const users = db.collection('users')

    const adminExists = await users.findOne({ username: 'admin' })

    if (!adminExists) {
      const { hash, salt } = await generateHash('bohdan123')

      const adminUser = {
        _id: randomUUID(),
        username: 'admin',
        email: 'admin@example.com',
        salt,
        hash,
        role: 'admin',
        createdAt: new Date(),
        modifiedAt: new Date(),
      }

      await users.insertOne(adminUser)
      console.log('Admin user created successfully')
    } else {
      console.log('Admin user already exists')
    }
  } catch (error) {
    console.error('Error seeding admin user:', error)
  } finally {
    await client.close()
  }
}

seedAdminUser()
