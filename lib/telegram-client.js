const { TelegramClient } = require("telegram")
const { StringSession } = require("telegram/sessions")
const input = require("input")
const path = require("path")
const fs = require("fs").promises

class TelegramBot {
  constructor(database, discordForwarder, imageProcessor) {
    this.database = database
    this.discordForwarder = discordForwarder
    this.imageProcessor = imageProcessor
    this.client = null
    this.isConnected = false
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 10
    this.reconnectDelay = 5000
  }

  async init() {
    try {
      const apiId = Number.parseInt(process.env.TELEGRAM_API_ID)
      const apiHash = process.env.TELEGRAM_API_HASH
      const sessionString = process.env.TELEGRAM_SESSION || ""

      if (!apiId || !apiHash) {
        throw new Error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in environment variables")
      }

      console.log("📱 Initializing Telegram client...")

      const session = new StringSession(sessionString)
      this.client = new TelegramClient(session, apiId, apiHash, {
        connectionRetries: 5,
        retryDelay: 2000,
        autoReconnect: true,
        maxConcurrentDownloads: 1,
      })

      await this.client.start({
        phoneNumber: async () => await input.text("📞 Enter your phone number: "),
        password: async () => await input.text("🔑 Enter your 2FA password: "),
        phoneCode: async () => await input.text("🔢 Enter the verification code: "),
        onError: (err) => console.error("❌ Authentication error:", err),
      })

      const me = await this.client.getMe()
      console.log(`✅ Connected to Telegram as: ${me.firstName} ${me.lastName || ""} (@${me.username || "N/A"})`)

      if (!sessionString) {
        console.log("\n" + "=".repeat(60))
        console.log("🔑 AUTHENTICATION SUCCESSFUL!")
        console.log("📋 Copy this session string to your .env file:")
        console.log(`TELEGRAM_SESSION=${this.client.session.save()}`)
        console.log("=".repeat(60) + "\n")
      }

      this.isConnected = true
      this.reconnectAttempts = 0

      this.setupEventHandlers()

      return true
    } catch (error) {
      console.error("❌ Failed to initialize Telegram client:", error.message)
      await this.handleReconnect()
      return false
    }
  }

  async authenticateWithPhone(apiId, apiHash, phoneNumber) {
    // This function is no longer needed with the new authentication method
  }

  setupEventHandlers() {
    // Handle new messages
    this.client.addEventHandler(async (update) => {
      try {
        if (update.className === "UpdateNewMessage") {
          await this.handleNewMessage(update)
        }
      } catch (error) {
        console.error("Error handling update:", error)
      }
    })

    // Handle connection errors
    this.client.addEventHandler(async (update) => {
      if (update.className === "UpdateConnectionState") {
        if (update.state === -1) {
          // Disconnected
          console.log("⚠️ Telegram connection lost, attempting to reconnect...")
          this.isConnected = false
          await this.handleReconnect()
        }
      }
    })
  }

  async handleNewMessage(update) {
    const message = update.message
    if (!message || message.out) return // Skip outgoing messages

    console.log(`[v0] Received message from chat:`, message.peerId)
    console.log(`[v0] Message content:`, message.message?.substring(0, 50) || "No text content")

    let groupId = null
    let topicId = null

    if (message.peerId?.channelId) {
      // For supergroups/channels, use negative ID format
      groupId = -1000000000000 - message.peerId.channelId
    } else if (message.peerId?.chatId) {
      // For regular groups, use negative ID
      groupId = -message.peerId.chatId
    } else if (message.peerId?.userId) {
      // For private messages, use positive ID
      groupId = message.peerId.userId
    }

    console.log(`[v0] Extracted group ID:`, groupId)

    if (message.replyTo?.replyToMsgId) {
      // Check if this is a forum topic message
      try {
        const chat = await this.client.getEntity(message.peerId)
        if (chat.forum) {
          topicId = message.replyTo.replyToMsgId
          console.log(`[v0] Forum topic detected, topic ID:`, topicId)
        }
      } catch (error) {
        console.log(`[v0] Could not determine if chat is forum:`, error.message)
      }
    }

    if (message.replyTo?.replyToTopId) {
      topicId = message.replyTo.replyToTopId
      console.log(`[v0] Topic ID from replyToTopId:`, topicId)
    }

    if (!groupId) {
      console.log(`[v0] Could not extract group ID from message`)
      return
    }

    console.log(`[v0] Checking database for routing: groupId=${groupId}, topicId=${topicId || "NULL"}`)
    const routing = await this.database.getRouting(groupId, topicId)
    console.log(
      `[v0] Database query result:`,
      routing ? `Found webhook: ${routing.DC_Webhook.substring(0, 50)}...` : "No routing found",
    )

    if (!routing) {
      console.log(`📝 No routing configured for group ${groupId}, topic ${topicId || "N/A"}`)
      console.log(
        `💡 To add routing, insert into database: INSERT INTO routing (ID_Groups, ID_Topic, DC_Webhook) VALUES (${groupId}, ${topicId || "NULL"}, 'your_webhook_url')`,
      )
      return
    }

    console.log(`📨 Processing message from group ${groupId}, topic ${topicId || "N/A"}`)

    try {
      // Get sender information
      const sender = await this.client.getEntity(message.fromId?.userId || message.fromId)
      const senderInfo = await this.extractSenderInfo(sender)
      console.log(`[v0] Sender info: ${senderInfo.displayName} (@${senderInfo.username})`)

      // Process message content
      const messageData = await this.processMessage(message, senderInfo)
      console.log(
        `[v0] Message data prepared, content length: ${messageData.content?.length || 0}, files: ${messageData.files?.length || 0}`,
      )

      // Forward to Discord
      console.log(`[v0] Forwarding to Discord webhook...`)
      await this.discordForwarder.sendMessage(routing.DC_Webhook, messageData)

      console.log(`✅ Message forwarded successfully to Discord`)
    } catch (error) {
      console.error(`❌ Error processing message:`, error.message)
      console.error(`❌ Error stack:`, error.stack)
    }
  }

  async extractSenderInfo(sender) {
    const senderInfo = {
      username: "Unknown User",
      displayName: "Unknown User",
      avatarUrl: null,
    }

    if (sender) {
      // Get username and display name
      senderInfo.username = sender.username || `user_${sender.id}`
      senderInfo.displayName = sender.firstName || sender.title || "Unknown User"

      if (sender.lastName) {
        senderInfo.displayName += ` ${sender.lastName}`
      }

      // Get profile photo
      try {
        const photos = await this.client.getUserPhotos(sender, { limit: 1 })
        if (photos.length > 0) {
          const photo = photos[0]
          const buffer = await this.client.downloadMedia(photo, { thumb: 2 })

          // Save temporarily and return path
          const tempPath = path.join(__dirname, "../temp", `avatar_${sender.id}.jpg`)
          await fs.mkdir(path.dirname(tempPath), { recursive: true })
          await fs.writeFile(tempPath, buffer)
          senderInfo.avatarUrl = tempPath
        }
      } catch (error) {
        console.log(`⚠️ Could not get profile photo for ${senderInfo.username}:`, error.message)
      }
    }

    return senderInfo
  }

  async processMessage(message, senderInfo) {
    const messageData = {
      username: senderInfo.displayName,
      avatarUrl: senderInfo.avatarUrl,
      content: "",
      embeds: [],
      files: [],
    }

    // Process text content
    if (message.message) {
      messageData.content = message.message
    }

    // Process media
    if (message.media) {
      try {
        const mediaData = await this.processMedia(message.media, message.id)
        if (mediaData) {
          if (mediaData.type === "photo") {
            const watermarkedPath = await this.imageProcessor.processImage(mediaData.path)
            messageData.files.push({
              name: mediaData.filename,
              path: watermarkedPath,
              type: "image",
            })
          } else if (mediaData.type === "document") {
            messageData.files.push({
              name: mediaData.filename,
              path: mediaData.path,
              type: "file",
            })
          } else if (mediaData.type === "video") {
            messageData.files.push({
              name: mediaData.filename,
              path: mediaData.path,
              type: "video",
            })
          }
        }
      } catch (error) {
        console.error("Error processing media:", error.message)
        messageData.content += "\n[Media could not be processed]"
      }
    }

    return messageData
  }

  async processMedia(media, messageId) {
    const tempDir = path.join(__dirname, "../temp")
    await fs.mkdir(tempDir, { recursive: true })

    try {
      if (media.className === "MessageMediaPhoto") {
        const buffer = await this.client.downloadMedia(media)
        const filename = `photo_${messageId}_${Date.now()}.jpg`
        const filePath = path.join(tempDir, filename)
        await fs.writeFile(filePath, buffer)

        return {
          type: "photo",
          filename,
          path: filePath,
        }
      } else if (media.className === "MessageMediaDocument") {
        const document = media.document
        const buffer = await this.client.downloadMedia(media)

        let filename = `file_${messageId}_${Date.now()}`
        let type = "document"

        // Get original filename if available
        if (document.attributes) {
          for (const attr of document.attributes) {
            if (attr.className === "DocumentAttributeFilename") {
              filename = attr.fileName
              break
            } else if (attr.className === "DocumentAttributeVideo") {
              type = "video"
              if (!filename.includes(".")) {
                filename += ".mp4"
              }
            }
          }
        }

        const filePath = path.join(tempDir, filename)
        await fs.writeFile(filePath, buffer)

        return {
          type,
          filename,
          path: filePath,
        }
      }
    } catch (error) {
      console.error("Error downloading media:", error.message)
      return null
    }

    return null
  }

  async handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("❌ Max reconnection attempts reached. Exiting...")
      process.exit(1)
    }

    this.reconnectAttempts++
    console.log(`🔄 Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`)

    await new Promise((resolve) => setTimeout(resolve, this.reconnectDelay))

    try {
      if (this.client) {
        await this.client.disconnect()
      }
      await this.init()
    } catch (error) {
      console.error("Reconnection failed:", error.message)
      await this.handleReconnect()
    }
  }

  async disconnect() {
    try {
      if (this.client && this.isConnected) {
        await this.client.disconnect()
        console.log("📦 Telegram client disconnected")
      }
    } catch (error) {
      console.error("Error disconnecting Telegram client:", error.message)
    }
  }

  isReady() {
    return this.isConnected && this.client
  }
}

module.exports = TelegramBot
