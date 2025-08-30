-- Create database for Telegram to Discord forwarder
CREATE DATABASE IF NOT EXISTS tgdcbridge_js;
USE tgdcbridge_js;

-- Create routing table for Telegram groups to Discord webhooks
CREATE TABLE IF NOT EXISTS routing (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ID_Groups BIGINT NOT NULL COMMENT 'Telegram Group ID',
    ID_Topic INT DEFAULT NULL COMMENT 'Telegram Topic ID (optional for topic groups)',
    DC_Webhook TEXT NOT NULL COMMENT 'Discord Webhook URL',
    Comment TEXT DEFAULT NULL COMMENT 'Optional note/description',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_group_topic (ID_Groups, ID_Topic)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
