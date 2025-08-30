const mysql = require("mysql2/promise")
const fs = require("fs").promises
const path = require("path")
require("dotenv").config()

async function setupDatabase() {
  let connection = null

  try {
    console.log("🔄 Setting up database...")

    // Connect to MySQL server (without database)
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || "localhost",
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
    })

    console.log("✅ Connected to MySQL server")

    // Read and execute database creation script
    const createDbScript = await fs.readFile(path.join(__dirname, "../db/01-create-database.sql"), "utf8")
    const createStatements = createDbScript.split(";").filter((stmt) => stmt.trim())

    for (const statement of createStatements) {
      if (statement.trim()) {
        await connection.execute(statement)
      }
    }

    console.log("✅ Database and tables created successfully")

    // Read and execute sample data script
    const insertDataScript = await fs.readFile(path.join(__dirname, "../db/02-insert-routing-data.sql"), "utf8")
    const insertStatements = insertDataScript.split(";").filter((stmt) => stmt.trim())

    for (const statement of insertStatements) {
      if (statement.trim()) {
        await connection.execute(statement)
      }
    }

    console.log("✅ Sample routing data inserted successfully")
    console.log("🎉 Database setup completed!")
  } catch (error) {
    console.error("❌ Database setup failed:", error.message)
    process.exit(1)
  } finally {
    if (connection) {
      await connection.end()
    }
  }
}

// Run setup if called directly
if (require.main === module) {
  setupDatabase()
}

module.exports = setupDatabase
