const axios = require("axios")
const FormData = require("form-data")
const fs = require("fs").promises
const path = require("path")

class DiscordForwarder {
  constructor() {
    this.rateLimitDelay = 1000 // 1 second between requests
    this.lastRequestTime = 0
    this.maxRetries = 3
    this.retryDelay = 2000 // 2 seconds
  }

  async sendMessage(webhookUrl, messageData) {
    try {
      await this.handleRateLimit()

      // Prepare avatar URL
      let avatarUrl = null
      if (messageData.avatarUrl && (await this.fileExists(messageData.avatarUrl))) {
        // Use the provided avatar
        avatarUrl = await this.uploadAvatarToDiscord(messageData.avatarUrl, webhookUrl)
      } else {
        // Use default profile picture
        const defaultPP = path.join(__dirname, "../img", process.env.PP || "PP.png")
        if (await this.fileExists(defaultPP)) {
          avatarUrl = await this.uploadAvatarToDiscord(defaultPP, webhookUrl)
        }
      }

      // Prepare message payload
      const payload = {
        username: messageData.username || "Unknown User",
        avatar_url: avatarUrl,
        content: messageData.content || "",
      }

      // Handle file attachments
      if (messageData.files && messageData.files.length > 0) {
        await this.sendMessageWithFiles(webhookUrl, payload, messageData.files)
      } else {
        // Send text-only message
        await this.sendTextMessage(webhookUrl, payload)
      }

      // Clean up temporary files
      await this.cleanupTempFiles(messageData)

      console.log(`✅ Message sent to Discord successfully`)
    } catch (error) {
      console.error(`❌ Failed to send message to Discord:`, error.message)

      // Clean up temporary files even on error
      await this.cleanupTempFiles(messageData)

      throw error
    }
  }

  async sendTextMessage(webhookUrl, payload) {
    const response = await axios.post(webhookUrl, payload, {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 30000,
    })

    if (response.status !== 204 && response.status !== 200) {
      throw new Error(`Discord API returned status ${response.status}`)
    }
  }

  async sendMessageWithFiles(webhookUrl, payload, files) {
    const form = new FormData()

    // Add JSON payload
    form.append("payload_json", JSON.stringify(payload))

    // Add files
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (await this.fileExists(file.path)) {
        const fileBuffer = await fs.readFile(file.path)
        form.append(`files[${i}]`, fileBuffer, {
          filename: file.name,
          contentType: this.getContentType(file.type),
        })
      }
    }

    const response = await axios.post(webhookUrl, form, {
      headers: {
        ...form.getHeaders(),
      },
      timeout: 60000, // Longer timeout for file uploads
      maxContentLength: 25 * 1024 * 1024, // 25MB max
      maxBodyLength: 25 * 1024 * 1024,
    })

    if (response.status !== 204 && response.status !== 200) {
      throw new Error(`Discord API returned status ${response.status}`)
    }
  }

  async uploadAvatarToDiscord(avatarPath, webhookUrl) {
    try {
      // For webhook avatars, we need to use a temporary upload or base64
      // Since Discord webhooks don't support direct file uploads for avatars,
      // we'll convert to base64 data URL
      const fileBuffer = await fs.readFile(avatarPath)
      const base64 = fileBuffer.toString("base64")
      const mimeType = this.getMimeType(avatarPath)

      return `data:${mimeType};base64,${base64}`
    } catch (error) {
      console.error("Error preparing avatar:", error.message)
      return null
    }
  }

  async handleRateLimit() {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequestTime

    if (timeSinceLastRequest < this.rateLimitDelay) {
      const waitTime = this.rateLimitDelay - timeSinceLastRequest
      await new Promise((resolve) => setTimeout(resolve, waitTime))
    }

    this.lastRequestTime = Date.now()
  }

  async cleanupTempFiles(messageData) {
    try {
      // Clean up avatar file
      if (messageData.avatarUrl && messageData.avatarUrl.includes("/temp/")) {
        await this.deleteFile(messageData.avatarUrl)
      }

      // Clean up message files
      if (messageData.files) {
        for (const file of messageData.files) {
          if (file.path && file.path.includes("/temp/")) {
            await this.deleteFile(file.path)
          }
        }
      }
    } catch (error) {
      console.error("Error cleaning up temp files:", error.message)
    }
  }

  async deleteFile(filePath) {
    try {
      if (await this.fileExists(filePath)) {
        await fs.unlink(filePath)
        console.log(`🗑️ Cleaned up temp file: ${path.basename(filePath)}`)
      }
    } catch (error) {
      console.error(`Error deleting file ${filePath}:`, error.message)
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  getContentType(fileType) {
    switch (fileType) {
      case "image":
        return "image/jpeg"
      case "video":
        return "video/mp4"
      case "file":
      default:
        return "application/octet-stream"
    }
  }

  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    switch (ext) {
      case ".jpg":
      case ".jpeg":
        return "image/jpeg"
      case ".png":
        return "image/png"
      case ".gif":
        return "image/gif"
      case ".webp":
        return "image/webp"
      case ".mp4":
        return "video/mp4"
      case ".webm":
        return "video/webm"
      case ".pdf":
        return "application/pdf"
      default:
        return "application/octet-stream"
    }
  }

  async retryRequest(requestFn, maxRetries = this.maxRetries) {
    let lastError = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await requestFn()
      } catch (error) {
        lastError = error
        console.log(`⚠️ Request attempt ${attempt} failed: ${error.message}`)

        if (attempt < maxRetries) {
          const delay = this.retryDelay * attempt // Exponential backoff
          console.log(`🔄 Retrying in ${delay}ms...`)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError
  }

  async testWebhook(webhookUrl) {
    try {
      // Get default profile picture path
      const defaultPP = path.join(__dirname, "../img", process.env.PP || "PP.png")
      let avatarUrl = null

      if (await this.fileExists(defaultPP)) {
        avatarUrl = await this.uploadAvatarToDiscord(defaultPP, webhookUrl)
      }

      const testPayload = {
        username: process.env.BDN || "Test Bot",
        content: process.env.SW || "BOT Started",
        avatar_url: avatarUrl,
      }

      await this.sendTextMessage(webhookUrl, testPayload)
      return true
    } catch (error) {
      console.error(`❌ Webhook test failed for ${webhookUrl}:`, error.message)
      return false
    }
  }

  async validateWebhookUrl(webhookUrl) {
    const webhookRegex = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/
    return webhookRegex.test(webhookUrl)
  }

  formatMessage(content, maxLength = 2000) {
    if (!content) return ""

    if (content.length <= maxLength) {
      return content
    }

    // Truncate and add indicator
    return content.substring(0, maxLength - 20) + "\n\n[Message truncated]"
  }

  async getWebhookInfo(webhookUrl) {
    try {
      const response = await axios.get(webhookUrl)
      return {
        id: response.data.id,
        name: response.data.name,
        channelId: response.data.channel_id,
        guildId: response.data.guild_id,
      }
    } catch (error) {
      console.error("Error getting webhook info:", error.message)
      return null
    }
  }

  async testWebhookWithMessage(webhookUrl) {
    try {
      const ppUrl =
        process.env.PP || "https://raw.githubusercontent.com/brianandhikap/tgdcbridge-JS/refs/heads/main/img/PP.png"

      console.log(`📸 Using profile picture: ${ppUrl}`)

      const testPayload = {
        username: process.env.BDN || "Test Bot",
        content: process.env.SW || "BOT Started",
        avatar_url: ppUrl, // Use direct URL for avatar
      }

      const response = await axios.post(webhookUrl, testPayload, {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000,
      })

      if (response.status !== 204 && response.status !== 200) {
        throw new Error(`Discord API returned status ${response.status}`)
      }

      console.log(`✅ Webhook test successful with profile picture from GitHub`)
      return true
    } catch (error) {
      console.error(`❌ Webhook test failed for ${webhookUrl}:`, error.message)
      return false
    }
  }
}

module.exports = DiscordForwarder
