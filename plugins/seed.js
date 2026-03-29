'use strict'

const fp = require('fastify-plugin')
const { hashPassword } = require('../routes/auth/generate-hash')

module.exports = fp(async function seedPlugin(fastify) {
    fastify.log.info("Checking database for initial seed data...")

    const usersCollection = fastify.mongo.db.collection('users')
    const adminExists = await usersCollection.findOne({ email: fastify.config.ADMIN_EMAIL })

    if (!adminExists) {
        fastify.log.info("No admin user found. Seeding default admin account...")
        const hash = await hashPassword(fastify.config.ADMIN_PASSWORD)

        await usersCollection.insertOne({
            email: fastify.config.ADMIN_EMAIL,
            hash: hash,
            role: 'admin',
            createdAt: new Date(),
            updatedAt: new Date()
        })

        fastify.log.info("Default admin account seeded successfully!")
    } else {
        fastify.log.info("Admin account already exists. Skipping seed.")
    }

}, {
    name: 'seed-plugin',
    dependencies: ['db-plugin', 'application-config'],
    decorators: { fastify: ['mongo', 'config'] }
})