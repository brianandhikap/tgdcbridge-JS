const fs = require("fs").promises
const path = require("path")
const Utils = require("./utils")

class MediaHandler {
  constructor(imageProcessor) {
    this.imageProcessor = imageProcessor
    this.tempDir = path.join(__dirname, "../temp")
    this.maxFileSize = 25 * 1024 * 1024 // 25MB Discord limit
    this.supportedImageFormats = ["jpg", "jpeg", "png", "gif", "webp"]
    this.supportedVideoFormats = ["mp4", "webm", "mov", "avi"]
    this.supportedAudioFormats = ["mp3", "wav", "ogg", "m4a"]
  }

  async processMediaFile(filePath, messageId) {
    try {
      const fileInfo = await this.getFileInfo(filePath)

      if (!fileInfo) {
        throw new Error("Could not get file information")
      }

      console.log(`📁 Processing ${fileInfo.type} file: ${fileInfo.name} (${Utils.formatFileSize(fileInfo.size)})`)

      // Check file size
      if (fileInfo.size > this.maxFileSize) {
        console.log(`⚠️ File too large (${Utils.formatFileSize(fileInfo.size)}), attempting compression...`)

        if (fileInfo.type === "image") {
          return await this.compressImage(filePath, messageId)
        } else if (fileInfo.type === "video") {
          console.log("⚠️ Video file too large and compression not implemented")
          return null
        } else {
          console.log("⚠️ File too large for Discord")
          return null
        }
      }

      // Process based on file type
      switch (fileInfo.type) {
        case "image":
          return await this.processImage(filePath, messageId)
        case "video":
          return await this.processVideo(filePath, messageId)
        case "audio":
          return await this.processAudio(filePath, messageId)
        default:
          return await this.processDocument(filePath, messageId)
      }
    } catch (error) {
      console.error(`Error processing media file ${filePath}:`, error.message)
      return null
    }
  }

  async processImage(filePath, messageId) {
    try {
      // Apply watermark if it's an image
      const watermarkedPath = await this.imageProcessor.processImage(filePath)

      return {
        type: "image",
        originalPath: filePath,
        processedPath: watermarkedPath,
        name: path.basename(watermarkedPath),
        size: (await fs.stat(watermarkedPath)).size,
      }
    } catch (error) {
      console.error("Error processing image:", error.message)
      return {
        type: "image",
        originalPath: filePath,
        processedPath: filePath,
        name: path.basename(filePath),
        size: (await fs.stat(filePath)).size,
      }
    }
  }

  async processVideo(filePath, messageId) {
    try {
      // For now, just return the video as-is
      // Future enhancement: video compression/thumbnail generation
      return {
        type: "video",
        originalPath: filePath,
        processedPath: filePath,
        name: path.basename(filePath),
        size: (await fs.stat(filePath)).size,
      }
    } catch (error) {
      console.error("Error processing video:", error.message)
      return null
    }
  }

  async processAudio(filePath, messageId) {
    try {
      return {
        type: "audio",
        originalPath: filePath,
        processedPath: filePath,
        name: path.basename(filePath),
        size: (await fs.stat(filePath)).size,
      }
    } catch (error) {
      console.error("Error processing audio:", error.message)
      return null
    }
  }

  async processDocument(filePath, messageId) {
    try {
      return {
        type: "document",
        originalPath: filePath,
        processedPath: filePath,
        name: path.basename(filePath),
        size: (await fs.stat(filePath)).size,
      }
    } catch (error) {
      console.error("Error processing document:", error.message)
      return null
    }
  }

  async compressImage(filePath, messageId, targetSize = 8 * 1024 * 1024) {
    try {
      console.log("🗜️ Compressing image to fit Discord limits...")

      let quality = 85
      let compressed = false
      let outputPath = filePath

      while (quality > 20) {
        const tempPath = path.join(this.tempDir, `compressed_${messageId}_${Date.now()}.jpg`)

        await this.imageProcessor.optimizeImage(filePath, 1920, 1080, quality)

        const stats = await fs.stat(tempPath)
        if (stats.size <= targetSize) {
          outputPath = tempPath
          compressed = true
          console.log(`✅ Image compressed to ${Utils.formatFileSize(stats.size)} at ${quality}% quality`)
          break
        }

        // Clean up failed attempt
        try {
          await fs.unlink(tempPath)
        } catch {}

        quality -= 15
      }

      if (!compressed) {
        console.log("⚠️ Could not compress image to acceptable size")
        return null
      }

      return {
        type: "image",
        originalPath: filePath,
        processedPath: outputPath,
        name: path.basename(outputPath),
        size: (await fs.stat(outputPath)).size,
      }
    } catch (error) {
      console.error("Error compressing image:", error.message)
      return null
    }
  }

  async getFileInfo(filePath) {
    try {
      const stats = await fs.stat(filePath)
      const ext = path.extname(filePath).toLowerCase().substring(1)
      const name = path.basename(filePath)

      let type = "document"
      if (this.supportedImageFormats.includes(ext)) {
        type = "image"
      } else if (this.supportedVideoFormats.includes(ext)) {
        type = "video"
      } else if (this.supportedAudioFormats.includes(ext)) {
        type = "audio"
      }

      return {
        name,
        size: stats.size,
        type,
        extension: ext,
        path: filePath,
        created: stats.birthtime,
        modified: stats.mtime,
      }
    } catch (error) {
      console.error(`Error getting file info for ${filePath}:`, error.message)
      return null
    }
  }

  async createMediaThumbnail(filePath) {
    try {
      const fileInfo = await this.getFileInfo(filePath)

      if (fileInfo.type === "image") {
        return await this.imageProcessor.createThumbnail(filePath)
      } else if (fileInfo.type === "video") {
        // Future enhancement: video thumbnail generation
        console.log("Video thumbnail generation not implemented")
        return null
      }

      return null
    } catch (error) {
      console.error("Error creating thumbnail:", error.message)
      return null
    }
  }

  async validateMediaFile(filePath) {
    try {
      const fileInfo = await this.getFileInfo(filePath)

      if (!fileInfo) {
        return { valid: false, reason: "Could not read file" }
      }

      if (fileInfo.size === 0) {
        return { valid: false, reason: "File is empty" }
      }

      if (fileInfo.size > this.maxFileSize) {
        return {
          valid: false,
          reason: `File too large (${Utils.formatFileSize(fileInfo.size)} > ${Utils.formatFileSize(this.maxFileSize)})`,
        }
      }

      return { valid: true, fileInfo }
    } catch (error) {
      return { valid: false, reason: error.message }
    }
  }

  async cleanupProcessedFiles(mediaResults) {
    for (const result of mediaResults) {
      try {
        // Clean up processed files that are different from originals
        if (result.processedPath !== result.originalPath) {
          await fs.unlink(result.processedPath)
          console.log(`🗑️ Cleaned up processed file: ${path.basename(result.processedPath)}`)
        }

        // Clean up original temporary files
        if (result.originalPath.includes("/temp/")) {
          await fs.unlink(result.originalPath)
          console.log(`🗑️ Cleaned up temp file: ${path.basename(result.originalPath)}`)
        }
      } catch (error) {
        console.error(`Error cleaning up file ${result.processedPath}:`, error.message)
      }
    }
  }
}

module.exports = MediaHandler
