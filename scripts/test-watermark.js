const ImageProcessor = require("../lib/image-processor")
const path = require("path")
require("dotenv").config()

async function testWatermark() {
  console.log("🧪 Testing watermark functionality...")

  try {
    const processor = new ImageProcessor()
    await processor.init()

    // Validate watermark
    const validation = await processor.validateWatermark()
    if (!validation.valid) {
      console.error("❌ Watermark validation failed:", validation.error)
      return
    }

    console.log("✅ Watermark validation passed")
    console.log(`   Size: ${validation.width}x${validation.height}`)
    console.log(`   Format: ${validation.format}`)

    // Test with a sample image (you would need to provide a test image)
    const testImagePath = path.join(__dirname, "../img/test-image.jpg")

    try {
      await require("fs").promises.access(testImagePath)
      console.log("🖼️ Test image found, processing...")

      const processedPath = await processor.processImage(testImagePath)
      console.log(`✅ Test image processed: ${processedPath}`)

      const imageInfo = await processor.getImageInfo(processedPath)
      console.log("📊 Processed image info:", imageInfo)
    } catch (error) {
      console.log("ℹ️ No test image found at img/test-image.jpg")
      console.log("   Add a test image to fully test watermark functionality")
    }

    await processor.cleanup()
    console.log("🎉 Watermark test completed successfully!")
  } catch (error) {
    console.error("❌ Watermark test failed:", error.message)
  }
}

// Run test if called directly
if (require.main === module) {
  testWatermark()
}

module.exports = testWatermark
