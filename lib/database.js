const mysql = require("mysql2/promise")

class Database {
  constructor() {
    this.pool = null
    this.init()
  }

  async init() {
    try {
      this.pool = mysql.createPool({
        host: process.env.MYSQL_HOST || "localhost",
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        acquireTimeout: 60000,
        timeout: 60000,
        reconnect: true,
      })

      // Test connection
      const connection = await this.pool.getConnection()
      console.log("✅ MySQL database connected successfully")
      connection.release()
    } catch (error) {
      console.error("❌ Database connection failed:", error.message)
      process.exit(1)
    }
  }

  async getRouting(groupId, topicId = null) {
    try {
      const [rows] = await this.pool.execute(
        "SELECT * FROM routing WHERE ID_Groups = ? AND (ID_Topic = ? OR (ID_Topic IS NULL AND ? IS NULL))",
        [groupId, topicId, topicId],
      )
      return rows[0] || null
    } catch (error) {
      console.error("Error getting routing:", error)
      return null
    }
  }

  async getAllRoutings() {
    try {
      const [rows] = await this.pool.execute("SELECT * FROM routing ORDER BY created_at DESC")
      return rows
    } catch (error) {
      console.error("Error getting all routings:", error)
      return []
    }
  }

  async addRouting(groupId, topicId, webhookUrl, comment = null) {
    try {
      const [result] = await this.pool.execute(
        "INSERT INTO routing (ID_Groups, ID_Topic, DC_Webhook, Comment) VALUES (?, ?, ?, ?)",
        [groupId, topicId, webhookUrl, comment],
      )
      return result.insertId
    } catch (error) {
      console.error("Error adding routing:", error)
      return null
    }
  }

  async updateRouting(id, groupId, topicId, webhookUrl, comment = null) {
    try {
      const [result] = await this.pool.execute(
        "UPDATE routing SET ID_Groups = ?, ID_Topic = ?, DC_Webhook = ?, Comment = ? WHERE id = ?",
        [groupId, topicId, webhookUrl, comment, id],
      )
      return result.affectedRows > 0
    } catch (error) {
      console.error("Error updating routing:", error)
      return false
    }
  }

  async deleteRouting(id) {
    try {
      const [result] = await this.pool.execute("DELETE FROM routing WHERE id = ?", [id])
      return result.affectedRows > 0
    } catch (error) {
      console.error("Error deleting routing:", error)
      return false
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end()
      console.log("📦 Database connection closed")
    }
  }
}

module.exports = Database
