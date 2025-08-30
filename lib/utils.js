const fs = require("fs").promises
const path = require("path")

class Utils {
  static async ensureDirectoryExists(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true })
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error
      }
    }
  }

  static async cleanupOldFiles(directory, maxAgeHours = 24) {
    try {
      const files = await fs.readdir(directory)
      const now = Date.now()
      const maxAge = maxAgeHours * 60 * 60 * 1000 // Convert to milliseconds

      for (const file of files) {
        const filePath = path.join(directory, file)
        const stats = await fs.stat(filePath)

        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath)
          console.log(`🗑️ Cleaned up old file: ${file}`)
        }
      }
    } catch (error) {
      console.error("Error cleaning up old files:", error.message)
    }
  }

  static formatFileSize(bytes) {
    if (bytes === 0) return "0 Bytes"

    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  static sanitizeFilename(filename) {
    // Remove or replace invalid characters
    return filename
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, "_")
      .substring(0, 100) // Limit length
  }

  static async createDirectoryStructure() {
    const directories = [
      path.join(__dirname, "../temp"),
      path.join(__dirname, "../img"),
      path.join(__dirname, "../logs"),
    ]

    for (const dir of directories) {
      await Utils.ensureDirectoryExists(dir)
    }

    console.log("📁 Directory structure created")
  }

  static validateEnvironmentVariables() {
    const required = [
      "TELEGRAM_API_ID",
      "TELEGRAM_API_HASH",
      "TELEGRAM_PHONE", // Added TELEGRAM_PHONE as required
      "MYSQL_HOST",
      "MYSQL_USER",
      "MYSQL_PASSWORD",
      "MYSQL_DATABASE",
      "SW", // Start webhook message
      "BDN", // Bot default name
    ]

    const missing = required.filter((key) => !process.env[key])

    if (missing.length > 0) {
      console.error("❌ Missing required environment variables:")
      missing.forEach((key) => console.error(`  - ${key}`))
      return false
    }

    if (!process.env.TELEGRAM_SESSION) {
      console.log("📱 TELEGRAM_SESSION is empty - will prompt for phone verification")
    }

    console.log("✅ All required environment variables are set")
    return true
  }

  static async setupDefaultFiles() {
    const imgDir = path.join(__dirname, "../img")
    await Utils.ensureDirectoryExists(imgDir)

    // Create placeholder files if they don't exist
    const defaultPP = path.join(imgDir, "PP.png")
    const defaultWM = path.join(imgDir, "WM.png")

    try {
      await fs.access(defaultPP)
    } catch {
      console.log("⚠️ Default profile picture (PP.png) not found in img/ directory")
      console.log("   Please add your default profile picture as img/PP.png")
    }

    try {
      await fs.access(defaultWM)
    } catch {
      console.log("⚠️ Watermark image (WM.png) not found in img/ directory")
      console.log("   Please add your watermark image as img/WM.png")
    }
  }

  static getTimestamp() {
    return new Date().toISOString().replace("T", " ").substring(0, 19)
  }

  static async logError(error, context = "") {
    const logDir = path.join(__dirname, "../logs")
    await Utils.ensureDirectoryExists(logDir)

    const logFile = path.join(logDir, `error_${new Date().toISOString().split("T")[0]}.log`)
    const logEntry = `[${Utils.getTimestamp()}] ${context}: ${error.message}\n${error.stack}\n\n`

    try {
      await fs.appendFile(logFile, logEntry)
    } catch (logError) {
      console.error("Failed to write to log file:", logError.message)
    }
  }
}

module.exports = Utils
