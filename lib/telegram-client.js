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
    console.log("🔧 Setting up Telegram event handlers...")

    // Handle new messages
    this.client.addEventHandler(async (update) => {
      try {
        console.log(`📥 [DEBUG] Received update: ${update.className}`)
        if (update.className === "UpdateNewMessage") {
          await this.handleNewMessage(update)
        } else if (update.className === "UpdateNewChannelMessage") {
          await this.handleNewChannelMessage(update)
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
    console.log(`\n📨 [DEBUG] Processing new message...`)

    const message = update.message
    if (!message) {
      console.log(`   ❌ No message object in update`)
      return
    }

    if (message.out) {
      console.log(`   ⏭️ Skipping outgoing message`)
      return
    }

    console.log(`🔍 [DEBUG] New message received:`)
    console.log(`   Chat ID: ${message.peerId?.channelId || message.peerId?.chatId || message.peerId?.userId}`)
    console.log(`   Message ID: ${message.id}`)
    console.log(`   Content: ${message.message?.substring(0, 100) || "No text content"}...`)
    console.log(`   From ID: ${message.fromId?.userId || message.fromId}`)
    console.log(`   Reply To: ${JSON.stringify(message.replyTo)}`)

    let groupId = null
    let topicId = null

    if (message.peerId?.channelId) {
      // For supergroups/channels, use negative ID format
      groupId = -1000000000000 - message.peerId.channelId
      console.log(`   🏢 Channel/Supergroup detected: ${message.peerId.channelId} -> ${groupId}`)
    } else if (message.peerId?.chatId) {
      // For regular groups, use negative ID
      groupId = -message.peerId.chatId
      console.log(`   👥 Regular group detected: ${message.peerId.chatId} -> ${groupId}`)
    } else if (message.peerId?.userId) {
      // For private messages, use positive ID
      groupId = message.peerId.userId
      console.log(`   👤 Private message detected: ${message.peerId.userId} -> ${groupId}`)
    }

    if (message.replyTo?.replyToMsgId) {
      try {
        const chat = await this.client.getEntity(message.peerId)
        console.log(`   📋 Chat info: ${chat.className}, forum: ${chat.forum || false}`)
        if (chat.forum) {
          topicId = message.replyTo.replyToMsgId
          console.log(`   📌 Forum topic detected from replyToMsgId: ${topicId}`)
        }
      } catch (error) {
        console.log(`   ⚠️ Could not get chat entity: ${error.message}`)
      }
    }

    if (message.replyTo?.replyToTopId) {
      topicId = message.replyTo.replyToTopId
      console.log(`   📌 Topic ID from replyToTopId: ${topicId}`)
    }

    if (!topicId && message.replyTo) {
      console.log(`   🔍 Trying alternative topic detection...`)
      console.log(`   Reply object keys: ${Object.keys(message.replyTo)}`)

      // Check for other possible topic indicators
      if (message.replyTo.forumTopic) {
        topicId = message.replyTo.forumTopic
        console.log(`   📌 Topic ID from forumTopic: ${topicId}`)
      }
    }

    if (!groupId) {
      console.log(`   ❌ Could not extract group ID from message`)
      return
    }

    console.log(`\n🔍 [DATABASE] Querying routing for:`)
    console.log(`   Group ID: ${groupId}`)
    console.log(`   Topic ID: ${topicId || "NULL"}`)

    const routing = await this.database.getRouting(groupId, topicId)

    if (routing) {
      console.log(`   ✅ Found routing: ${routing.DC_Webhook.substring(0, 50)}...`)
      console.log(`   Comment: ${routing.Comment || "No comment"}`)

      console.log(`\n📨 [PROCESSING] Message from group ${groupId}, topic ${topicId || "N/A"}`)

      try {
        // Get sender information with fallback
        console.log(`   🔍 Getting sender information...`)
        let senderInfo
        try {
          const sender = await this.client.getEntity(message.fromId?.userId || message.fromId)
          senderInfo = await this.extractSenderInfo(sender)
        } catch (error) {
          console.log(`   ⚠️ Could not get sender entity: ${error.message}`)
          console.log(`   🔄 Using fallback sender information...`)
          senderInfo = await this.createFallbackSenderInfo(message.fromId?.userId || message.fromId)
        }

        console.log(`   👤 Sender: ${senderInfo.displayName} (@${senderInfo.username})`)
        console.log(`   🖼️ Avatar: ${senderInfo.avatarUrl ? "Available" : "Using default"}`)

        // Process message content
        console.log(`   📝 Processing message content...`)
        const messageData = await this.processMessage(message, senderInfo)
        console.log(`   📊 Content length: ${messageData.content?.length || 0}`)
        console.log(`   📎 Files: ${messageData.files?.length || 0}`)

        // Forward to Discord
        console.log(`   🚀 Forwarding to Discord...`)
        await this.discordForwarder.sendMessage(routing.DC_Webhook, messageData)

        console.log(`   ✅ Message forwarded successfully!`)
      } catch (error) {
        console.error(`   ❌ Error processing message: ${error.message}`)
        console.error(`   📋 Error stack: ${error.stack}`)
      }
    } else {
      console.log(`   ❌ No routing found`)
      console.log(`\n💡 [HELP] To add routing for this message:`)
      console.log(
        `   SQL: INSERT INTO routing (ID_Groups, ID_Topic, DC_Webhook, Comment) VALUES (${groupId}, ${topicId || "NULL"}, 'YOUR_WEBHOOK_URL', 'Optional comment');`,
      )

      try {
        const allRoutings = await this.database.getAllRoutings()
        //console.log(`\n📋 [INFO] Current database routings:`)
        if (allRoutings.length === 0) {
          console.log(`   No routings configured yet`)
        } else {
          allRoutings.forEach((r, i) => {
            //console.log(
            //  `   ${i + 1}. Group: ${r.ID_Groups}, Topic: ${r.ID_Topic || "NULL"}, Webhook: ${r.DC_Webhook.substring(0, 30)}...`,
            //)
          })
        }
      } catch (error) {
        console.log(`   ⚠️ Could not fetch existing routings: ${error.message}`)
      }
    }
  }

  async handleNewChannelMessage(update) {
    console.log(`\n📨 [DEBUG] Processing new channel message...`)

    const message = update.message
    if (!message) {
      console.log(`   ❌ No message object in update`)
      return
    }

    if (message.out) {
      console.log(`   ⏭️ Skipping outgoing message`)
      return
    }

    console.log(`🔍 [DEBUG] New channel message received:`)
    console.log(`   Chat ID: ${message.peerId?.channelId || message.peerId?.chatId || message.peerId?.userId}`)
    console.log(`   Message ID: ${message.id}`)
    console.log(`   Content: ${message.message?.substring(0, 100) || "No text content"}...`)
    console.log(`   From ID: ${message.fromId?.userId || message.fromId}`)
    console.log(`   Reply To: ${JSON.stringify(message.replyTo)}`)

    let groupId = null
    let topicId = null

    if (message.peerId?.channelId) {
      // For supergroups/channels, use negative ID format
      groupId = -1000000000000 - message.peerId.channelId
      console.log(`   🏢 Channel/Supergroup detected: ${message.peerId.channelId} -> ${groupId}`)
    }

    if (message.replyTo?.replyToMsgId) {
      try {
        const chat = await this.client.getEntity(message.peerId)
        console.log(`   📋 Chat info: ${chat.className}, forum: ${chat.forum || false}`)
        if (chat.forum) {
          topicId = message.replyTo.replyToMsgId
          console.log(`   📌 Forum topic detected from replyToMsgId: ${topicId}`)
        }
      } catch (error) {
        console.log(`   ⚠️ Could not get chat entity: ${error.message}`)
      }
    }

    if (message.replyTo?.replyToTopId) {
      topicId = message.replyTo.replyToTopId
      console.log(`   📌 Topic ID from replyToTopId: ${topicId}`)
    }

    if (!groupId) {
      console.log(`   ❌ Could not extract group ID from message`)
      return
    }

    console.log(`\n🔍 [DATABASE] Querying routing for:`)
    console.log(`   Group ID: ${groupId}`)
    console.log(`   Topic ID: ${topicId || "NULL"}`)

    const routing = await this.database.getRouting(groupId, topicId)

    if (routing) {
      console.log(`   ✅ Found routing: ${routing.DC_Webhook.substring(0, 50)}...`)
      console.log(`   Comment: ${routing.Comment || "No comment"}`)

      console.log(`\n📨 [PROCESSING] Message from group ${groupId}, topic ${topicId || "N/A"}`)

      try {
        // Get sender information with fallback
        console.log(`   🔍 Getting sender information...`)
        let senderInfo
        try {
          const sender = await this.client.getEntity(message.fromId?.userId || message.fromId)
          senderInfo = await this.extractSenderInfo(sender)
        } catch (error) {
          console.log(`   ⚠️ Could not get sender entity: ${error.message}`)
          console.log(`   🔄 Using fallback sender information...`)
          senderInfo = await this.createFallbackSenderInfo(message.fromId?.userId || message.fromId)
        }

        console.log(`   👤 Sender: ${senderInfo.displayName} (@${senderInfo.username})`)
        console.log(`   🖼️ Avatar: ${senderInfo.avatarUrl ? "Available" : "Using default"}`)

        // Process message content
        console.log(`   📝 Processing message content...`)
        const messageData = await this.processMessage(message, senderInfo)
        console.log(`   📊 Content length: ${messageData.content?.length || 0}`)
        console.log(`   📎 Files: ${messageData.files?.length || 0}`)

        // Forward to Discord
        console.log(`   🚀 Forwarding to Discord...`)
        await this.discordForwarder.sendMessage(routing.DC_Webhook, messageData)

        console.log(`   ✅ Message forwarded successfully!`)
      } catch (error) {
        console.error(`   ❌ Error processing message: ${error.message}`)
        console.error(`   📋 Error stack: ${error.stack}`)
      }
    } else {
      console.log(`   ❌ No routing found`)

      //console.log(`\n💡 [HELP] To add routing for this message:`)
      //console.log(
      //  `   SQL: INSERT INTO routing (ID_Groups, ID_Topic, DC_Webhook, Comment) VALUES (${groupId}, ${topicId || "NULL"}, 'YOUR_WEBHOOK_URL', 'Optional comment');`,
      //)

      try {
        const allRoutings = await this.database.getAllRoutings()
        //console.log(`\n📋 [INFO] Current database routings:`)
        if (allRoutings.length === 0) {
          console.log(`   No routings configured yet`)
        } else {
          allRoutings.forEach((r, i) => {
            //console.log(
            //  `   ${i + 1}. Group: ${r.ID_Groups}, Topic: ${r.ID_Topic || "NULL"}, Webhook: ${r.DC_Webhook.substring(0, 30)}...`,
            //)
          })
        }
      } catch (error) {
        console.log(`   ⚠️ Could not fetch existing routings: ${error.message}`)
      }
    }
  }

  async createFallbackSenderInfo(userId) {
    const host = process.env.HOST || "localhost"
    const port = process.env.PORT || 3000

    const avatarFilename = `${userId}.jpg`
    const avatarUrl = `http://${host}:${port}/ava/${avatarFilename}`

    // Copy default profile picture to ava folder with userId as filename
    try {
      const avaDir = path.join(__dirname, "../ava")
      await fs.mkdir(avaDir, { recursive: true })

      const userAvatarPath = path.join(avaDir, avatarFilename)
      const ppPath = path.join(__dirname, "../ava/pp.jpg")

      try {
        await fs.access(userAvatarPath)
      } catch {
        // Copy PP.png to ava/{userId}.jpg if it doesn't exist
        try {
          const ppBuffer = await fs.readFile(ppPath)
          await fs.writeFile(userAvatarPath, ppBuffer)
          console.log(`   📋 Copied default profile picture to ${avatarFilename}`)
        } catch (error) {
          console.log(`   ⚠️ Could not copy default profile picture: ${error.message}`)
        }
      }
    } catch (error) {
      console.log(`   ⚠️ Error setting up default avatar: ${error.message}`)
    }

    return {
      username: `user_${userId || "unknown"}`,
      displayName: `User ${userId || "Unknown"}`,
      avatarUrl: avatarUrl,
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
        if (sender.photo) {
          console.log(`   📸 Downloading profile photo for ${senderInfo.username}...`)

          const buffer = await this.client.downloadProfilePhoto(sender, { isBig: true })

          if (buffer) {
            // Save to ava folder with username as filename
            const avaDir = path.join(__dirname, "../ava")
            await fs.mkdir(avaDir, { recursive: true })

            const filename = `${sender.id}.jpg`
            const filePath = path.join(avaDir, filename)

            await fs.writeFile(filePath, buffer)

            // Generate hosted URL
            const host = process.env.HOST || "localhost"
            const port = process.env.PORT || 3000
            senderInfo.avatarUrl = `http://${host}:${port}/ava/${filename}`

            console.log(`   ✅ Profile photo saved and hosted at: ${senderInfo.avatarUrl}`)
          }
        } else {
          console.log(`   ℹ️ No profile photo available for ${senderInfo.username}, using default`)
        }
      } catch (error) {
        console.log(`⚠️ Could not get profile photo for ${senderInfo.username}: ${error.message}`)
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
