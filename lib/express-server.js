const express = require("express")
const path = require("path")
const fs = require("fs").promises

class ExpressServer {
  constructor() {
    this.app = express()
    this.server = null
    this.host = process.env.HOST || "localhost"
    this.port = process.env.PORT || 3000
  }

  async init() {
    try {
      // Create ava directory if it doesn't exist
      const avaDir = path.join(__dirname, "../ava")
      await fs.mkdir(avaDir, { recursive: true })

      // Serve static files from ava directory
      this.app.use("/ava", express.static(avaDir))

      // Health check endpoint
      this.app.get("/health", (req, res) => {
        res.json({ status: "ok", timestamp: new Date().toISOString() })
      })

      // Start server
      this.server = this.app.listen(this.port, this.host, () => {
        console.log(`🌐 Express server running at http://${this.host}:${this.port}`)
        console.log(`📸 Profile photos will be served from http://${this.host}:${this.port}/ava/`)
      })

      return true
    } catch (error) {
      console.error("❌ Failed to start Express server:", error.message)
      return false
    }
  }

  async stop() {
    if (this.server) {
      this.server.close()
      console.log("🛑 Express server stopped")
    }
  }

  getAvatarUrl(username) {
    return `http://${this.host}:${this.port}/ava/${username}.jpg`
  }
}

module.exports = ExpressServer
