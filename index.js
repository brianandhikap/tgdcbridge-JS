const Database = require("./lib/database")
const TelegramBot = require("./lib/telegram-client")
const DiscordForwarder = require("./lib/discord-forwarder")
const ImageProcessor = require("./lib/image-processor")
const Utils = require("./lib/utils")
require("dotenv").config()

class TelegramDiscordForwarder {
  constructor() {
    this.database = null
    this.telegramClient = null
    this.discordForwarder = null
    this.imageProcessor = null
    this.isRunning = false
    this.cleanupInterval = null
  }

  async init() {
    try {
      console.log("🚀 Starting Telegram to Discord Forwarder...")
      console.log("=".repeat(50))

      // Validate environment variables
      if (!Utils.validateEnvironmentVariables()) {
        process.exit(1)
      }

      // Create directory structure
      await Utils.createDirectoryStructure()
      await Utils.setupDefaultFiles()

      // Initialize database
      console.log("📊 Initializing database connection...")
      this.database = new Database()
      await this.database.init()

      // Initialize image processor
      console.log("🖼️ Initializing image processor...")
      this.imageProcessor = new ImageProcessor()
      await this.imageProcessor.init()

      // Initialize Discord forwarder
      console.log("🔗 Initializing Discord forwarder...")
      this.discordForwarder = new DiscordForwarder()

      // Test webhook connections
      await this.testWebhookConnections()

      // Initialize Telegram client
      console.log("📱 Initializing Telegram client...")
      this.telegramClient = new TelegramBot(this.database, this.discordForwarder, this.imageProcessor)
      await this.telegramClient.init()

      // Setup cleanup routines
      this.setupCleanupRoutines()

      // Setup graceful shutdown
      this.setupGracefulShutdown()

      this.isRunning = true
      console.log("=".repeat(50))
      console.log("✅ Telegram to Discord Forwarder is now running!")
      console.log("📝 Monitoring configured groups and topics...")
      console.log("🔄 Press Ctrl+C to stop the forwarder")
      console.log("=".repeat(50))

      // Keep the application running
      await this.keepAlive()
    } catch (error) {
      console.error("❌ Failed to initialize forwarder:", error.message)
      await Utils.logError(error, "Initialization")
      process.exit(1)
    }
  }

  async testWebhookConnections() {
    try {
      console.log("🧪 Testing webhook connections...")
      const routings = await this.database.getAllRoutings()

      if (routings.length === 0) {
        console.log("⚠️ No routing configurations found in database")
        console.log("   Please add routing configurations to the database")
        return
      }

      let successCount = 0
      for (const routing of routings) {
        if (this.discordForwarder.validateWebhookUrl(routing.DC_Webhook)) {
          const startupMessage = process.env.SW || "BOT Started"
          const testResult = await this.discordForwarder.testWebhookWithMessage(routing.DC_Webhook, startupMessage)
          if (testResult) {
            successCount++
            console.log(`✅ Webhook test passed for group ${routing.ID_Groups}`)
          } else {
            console.log(`❌ Webhook test failed for group ${routing.ID_Groups}`)
          }
        } else {
          console.log(`❌ Invalid webhook URL for group ${routing.ID_Groups}`)
        }
      }

      console.log(`📊 Webhook tests completed: ${successCount}/${routings.length} passed`)
    } catch (error) {
      console.error("Error testing webhooks:", error.message)
    }
  }

  setupCleanupRoutines() {
    // Clean up temporary files every hour
    this.cleanupInterval = setInterval(
      async () => {
        try {
          console.log("🧹 Running cleanup routine...")
          const tempDir = require("path").join(__dirname, "temp")
          await Utils.cleanupOldFiles(tempDir, 1) // Clean files older than 1 hour

          const logsDir = require("path").join(__dirname, "logs")
          await Utils.cleanupOldFiles(logsDir, 24 * 7) // Clean logs older than 7 days

          console.log("✅ Cleanup routine completed")
        } catch (error) {
          console.error("Error during cleanup:", error.message)
        }
      },
      60 * 60 * 1000,
    ) // Every hour
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      console.log(`\n📴 Received ${signal}, shutting down gracefully...`)
      this.isRunning = false

      try {
        // Clear cleanup interval
        if (this.cleanupInterval) {
          clearInterval(this.cleanupInterval)
        }

        // Disconnect Telegram client
        if (this.telegramClient) {
          await this.telegramClient.disconnect()
        }

        // Close database connection
        if (this.database) {
          await this.database.close()
        }

        // Cleanup image processor
        if (this.imageProcessor) {
          await this.imageProcessor.cleanup()
        }

        // Final cleanup
        const tempDir = require("path").join(__dirname, "temp")
        await Utils.cleanupOldFiles(tempDir, 0) // Clean all temp files

        console.log("✅ Graceful shutdown completed")
        process.exit(0)
      } catch (error) {
        console.error("Error during shutdown:", error.message)
        process.exit(1)
      }
    }

    process.on("SIGINT", () => shutdown("SIGINT"))
    process.on("SIGTERM", () => shutdown("SIGTERM"))
    process.on("SIGQUIT", () => shutdown("SIGQUIT"))

    // Handle uncaught exceptions
    process.on("uncaughtException", async (error) => {
      console.error("💥 Uncaught Exception:", error.message)
      await Utils.logError(error, "Uncaught Exception")
      await shutdown("UNCAUGHT_EXCEPTION")
    })

    process.on("unhandledRejection", async (reason, promise) => {
      console.error("💥 Unhandled Rejection at:", promise, "reason:", reason)
      await Utils.logError(new Error(reason), "Unhandled Rejection")
    })
  }

  async keepAlive() {
    // Keep the application running and monitor health
    while (this.isRunning) {
      try {
        // Check if Telegram client is still connected
        if (!this.telegramClient.isReady()) {
          console.log("⚠️ Telegram client not ready, attempting reconnection...")
          await this.telegramClient.init()
        }

        // Health check every 30 seconds
        await new Promise((resolve) => setTimeout(resolve, 30000))
      } catch (error) {
        console.error("Error in keep alive loop:", error.message)
        await Utils.logError(error, "Keep Alive")
        await new Promise((resolve) => setTimeout(resolve, 5000)) // Wait 5 seconds before retry
      }
    }
  }

  async getStatus() {
    return {
      isRunning: this.isRunning,
      telegramConnected: this.telegramClient ? this.telegramClient.isReady() : false,
      databaseConnected: this.database ? true : false,
      imageProcessorReady: this.imageProcessor ? true : false,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
    }
  }
}

// Create and start the forwarder
const forwarder = new TelegramDiscordForwarder()

// Start the application
forwarder.init().catch((error) => {
  console.error("💥 Fatal error:", error.message)
  process.exit(1)
})

// Export for testing purposes
module.exports = TelegramDiscordForwarder
