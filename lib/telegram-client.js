const { TelegramClient } = require("telegram")
const { StringSession } = require("telegram/sessions")
const path = require("path")
const fs = require("fs").promises
const readline = require("readline")

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
      const sessionString = process.env.TELEGRAM_SESSION
      const phoneNumber = process.env.TELEGRAM_PHONE

      if (!apiId || !apiHash) {
        throw new Error("Missing TELEGRAM_API_ID or TELEGRAM_API_HASH in environment variables")
      }

      if (!sessionString || sessionString.trim() === "") {
        if (!phoneNumber) {
          throw new Error(
            "TELEGRAM_SESSION is empty and TELEGRAM_PHONE is not provided. Please add TELEGRAM_PHONE to .env file.",
          )
        }

        console.log("📱 No session string found. Starting phone verification process...")
        const newSessionString = await this.authenticateWithPhone(apiId, apiHash, phoneNumber)

        console.log("\n" + "=".repeat(60))
        console.log("🔑 AUTHENTICATION SUCCESSFUL!")
        console.log("📋 Copy this session string to your .env file:")
        console.log(`TELEGRAM_SESSION=${newSessionString}`)
        console.log("=".repeat(60) + "\n")

        // Use the new session string for this session
        const session = new StringSession(newSessionString)
        this.client = new TelegramClient(session, apiId, apiHash, {
          connectionRetries: 5,
          retryDelay: 2000,
          autoReconnect: true,
          maxConcurrentDownloads: 1,
        })
      } else {
        const session = new StringSession(sessionString)
        this.client = new TelegramClient(session, apiId, apiHash, {
          connectionRetries: 5,
          retryDelay: 2000,
          autoReconnect: true,
          maxConcurrentDownloads: 1,
        })
      }

      console.log("🔄 Connecting to Telegram...")
      await this.client.connect()

      const me = await this.client.getMe()
      console.log(`✅ Connected to Telegram as: ${me.firstName} ${me.lastName || ""} (@${me.username || "N/A"})`)

      this.isConnected = true
      this.reconnectAttempts = 0

      this.setupEventHandlers()

      return true
    } catch (error) {
      console.error("❌ Failed to initialize Telegram client:", error.message)
      if (error.message.includes("TELEGRAM_SESSION is empty") || error.message.includes("TELEGRAM_PHONE")) {
        console.log("💡 Please update your .env file with the required credentials and restart the application.")
        process.exit(1)
      }
      await this.handleReconnect()
      return false
    }
  }

  async authenticateWithPhone(apiId, apiHash, phoneNumber) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve))

    try {
      // Create temporary client for authentication
      const tempSession = new StringSession("")
      const tempClient = new TelegramClient(tempSession, apiId, apiHash, {
        connectionRetries: 5,
        retryDelay: 2000,
      })

      await tempClient.connect()
      console.log("📞 Sending verification code to:", phoneNumber)

      // Send code request
      const result = await tempClient.sendCode({
        apiId: apiId,
        apiHash: apiHash,
        phoneNumber: phoneNumber,
        settings: {
          allowFlashcall: false,
          currentNumber: false,
          allowAppHash: true,
        },
      })

      // Ask for verification code
      const code = await question("🔢 Enter the verification code you received: ")

      // Sign in with the code
      try {
        await tempClient.signInUser({
          phoneNumber: phoneNumber,
          phoneCodeHash: result.phoneCodeHash,
          phoneCode: code,
        })
      } catch (error) {
        if (error.message.includes("SESSION_PASSWORD_NEEDED")) {
          // Two-factor authentication is enabled
          const password = await question("🔐 Two-factor authentication detected. Enter your password: ")
          await tempClient.signInUser({
            password: password,
          })
        } else {
          throw error
        }
      }

      // Get the session string
      const sessionString = tempClient.session.save()

      await tempClient.disconnect()
      rl.close()

      return sessionString
    } catch (error) {
      rl.close()
      throw new Error(`Authentication failed: ${error.message}`)
    }
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

    const chatId = message.peerId?.channelId || message.peerId?.chatId || message.peerId?.userId
    if (!chatId) return

    // Convert to negative ID for supergroups (Telegram convention)
    const groupId = message.peerId?.channelId ? -1000000000000 - message.peerId.channelId : chatId

    // Get topic ID if it's a forum message
    let topicId = null
    if (message.replyTo?.replyToMsgId && message.replyTo?.forumTopic) {
      topicId = message.replyTo.replyToTopMsgId
    }

    // Check if we have routing for this group/topic
    const routing = await this.database.getRouting(groupId, topicId)
    if (!routing) {
      console.log(`📝 No routing found for group ${groupId}, topic ${topicId}`)
      return
    }

    console.log(`📨 Processing message from group ${groupId}, topic ${topicId || "N/A"}`)

    try {
      // Get sender information
      const sender = await this.client.getEntity(message.fromId?.userId || message.fromId)
      const senderInfo = await this.extractSenderInfo(sender)

      // Process message content
      const messageData = await this.processMessage(message, senderInfo)

      // Forward to Discord
      await this.discordForwarder.sendMessage(routing.DC_Webhook, messageData)

      console.log(`✅ Message forwarded successfully to Discord`)
    } catch (error) {
      console.error(`❌ Error processing message:`, error.message)
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
