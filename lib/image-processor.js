const sharp = require("sharp")
const fs = require("fs").promises
const path = require("path")

class ImageProcessor {
  constructor() {
    this.watermarkPath = path.join(__dirname, "../img", process.env.WM || "WM.png")
    this.supportedFormats = ["jpeg", "jpg", "png", "webp", "gif"]
    this.maxImageSize = 8 * 1024 * 1024 // 8MB max for Discord
    this.watermarkCache = null
  }

  async init() {
    try {
      // Check if watermark file exists
      await fs.access(this.watermarkPath)
      console.log(`✅ Watermark file found: ${this.watermarkPath}`)

      // Pre-load and optimize watermark
      await this.loadWatermark()
    } catch (error) {
      console.error(`❌ Watermark file not found: ${this.watermarkPath}`)
      console.error("   Please add your watermark image as img/WM.png")
      throw new Error("Watermark file is required for image processing")
    }
  }

  async loadWatermark() {
    try {
      const watermarkBuffer = await fs.readFile(this.watermarkPath)
      const watermarkImage = sharp(watermarkBuffer)
      const metadata = await watermarkImage.metadata()

      // Optimize watermark for compositing
      this.watermarkCache = {
        buffer: watermarkBuffer,
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
      }

      console.log(`📸 Watermark loaded: ${metadata.width}x${metadata.height} ${metadata.format}`)
    } catch (error) {
      console.error("Error loading watermark:", error.message)
      throw error
    }
  }

  async processImage(inputPath, outputPath = null) {
    try {
      // Generate output path if not provided
      if (!outputPath) {
        const dir = path.dirname(inputPath)
        const name = path.basename(inputPath, path.extname(inputPath))
        const ext = path.extname(inputPath)
        outputPath = path.join(dir, `${name}_watermarked${ext}`)
      }

      // Check if input file exists
      await fs.access(inputPath)

      // Get image metadata
      const inputImage = sharp(inputPath)
      const metadata = await inputImage.metadata()

      console.log(`🖼️ Processing image: ${metadata.width}x${metadata.height} ${metadata.format}`)

      // Check if image format is supported
      if (!this.supportedFormats.includes(metadata.format.toLowerCase())) {
        console.log(`⚠️ Unsupported image format: ${metadata.format}. Skipping watermark.`)
        return inputPath // Return original path without watermark
      }

      // Calculate watermark size (20% of image width, maintaining aspect ratio)
      const watermarkWidth = Math.floor(metadata.width * 0.2)
      const watermarkHeight = Math.floor((watermarkWidth * this.watermarkCache.height) / this.watermarkCache.width)

      // Ensure watermark isn't too large
      const maxWatermarkSize = Math.min(metadata.width * 0.4, metadata.height * 0.4)
      const finalWatermarkWidth = Math.min(watermarkWidth, maxWatermarkSize)
      const finalWatermarkHeight = Math.floor(
        (finalWatermarkWidth * this.watermarkCache.height) / this.watermarkCache.width,
      )

      // Calculate center position
      const left = Math.floor((metadata.width - finalWatermarkWidth) / 2)
      const top = Math.floor((metadata.height - finalWatermarkHeight) / 2)

      // Resize watermark
      const resizedWatermark = await sharp(this.watermarkCache.buffer)
        .resize(finalWatermarkWidth, finalWatermarkHeight, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png() // Convert to PNG for transparency support
        .toBuffer()

      // Apply watermark to image
      const processedImage = await inputImage
        .composite([
          {
            input: resizedWatermark,
            left: left,
            top: top,
            blend: "over",
          },
        ])
        .jpeg({ quality: 90 }) // High quality output
        .toBuffer()

      // Check file size
      if (processedImage.length > this.maxImageSize) {
        console.log("⚠️ Processed image too large, compressing...")
        const compressedImage = await sharp(processedImage).jpeg({ quality: 70 }).toBuffer()

        await fs.writeFile(outputPath, compressedImage)
      } else {
        await fs.writeFile(outputPath, processedImage)
      }

      console.log(`✅ Watermark applied successfully: ${path.basename(outputPath)}`)
      return outputPath
    } catch (error) {
      console.error(`❌ Error processing image ${inputPath}:`, error.message)
      // Return original path if processing fails
      return inputPath
    }
  }

  async processMultipleImages(imagePaths) {
    const results = []

    for (const imagePath of imagePaths) {
      try {
        const processedPath = await this.processImage(imagePath)
        results.push({
          original: imagePath,
          processed: processedPath,
          success: processedPath !== imagePath,
        })
      } catch (error) {
        console.error(`Error processing ${imagePath}:`, error.message)
        results.push({
          original: imagePath,
          processed: imagePath,
          success: false,
          error: error.message,
        })
      }
    }

    return results
  }

  async optimizeImage(inputPath, maxWidth = 1920, maxHeight = 1080, quality = 85) {
    try {
      const inputImage = sharp(inputPath)
      const metadata = await inputImage.metadata()

      // Check if resizing is needed
      if (metadata.width <= maxWidth && metadata.height <= maxHeight) {
        return inputPath // No optimization needed
      }

      const outputPath = inputPath.replace(path.extname(inputPath), "_optimized" + path.extname(inputPath))

      await inputImage
        .resize(maxWidth, maxHeight, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality })
        .toFile(outputPath)

      console.log(`📐 Image optimized: ${metadata.width}x${metadata.height} → ${maxWidth}x${maxHeight}`)
      return outputPath
    } catch (error) {
      console.error("Error optimizing image:", error.message)
      return inputPath
    }
  }

  async createThumbnail(inputPath, width = 300, height = 300) {
    try {
      const outputPath = inputPath.replace(path.extname(inputPath), "_thumb" + path.extname(inputPath))

      await sharp(inputPath)
        .resize(width, height, {
          fit: "cover",
          position: "center",
        })
        .jpeg({ quality: 80 })
        .toFile(outputPath)

      return outputPath
    } catch (error) {
      console.error("Error creating thumbnail:", error.message)
      return null
    }
  }

  async getImageInfo(imagePath) {
    try {
      const metadata = await sharp(imagePath).metadata()
      const stats = await fs.stat(imagePath)

      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: stats.size,
        channels: metadata.channels,
        hasAlpha: metadata.hasAlpha,
      }
    } catch (error) {
      console.error("Error getting image info:", error.message)
      return null
    }
  }

  isImageFile(filePath) {
    const ext = path.extname(filePath).toLowerCase().substring(1)
    return this.supportedFormats.includes(ext)
  }

  async validateWatermark() {
    try {
      await fs.access(this.watermarkPath)
      const metadata = await sharp(this.watermarkPath).metadata()

      if (!metadata.width || !metadata.height) {
        throw new Error("Invalid watermark image")
      }

      return {
        valid: true,
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
      }
    } catch (error) {
      return {
        valid: false,
        error: error.message,
      }
    }
  }

  async cleanup() {
    // Clear watermark cache
    this.watermarkCache = null
    console.log("🧹 Image processor cleaned up")
  }
}

module.exports = ImageProcessor
