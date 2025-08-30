-- Sample routing data for Telegram to Discord forwarder
USE tgdcbridge_js;

-- Insert sample routing configurations
INSERT INTO routing (ID_Groups, ID_Topic, DC_Webhook, Comment) VALUES
(-1001234567890, 1, 'https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN', 'Main group topic 1 to Discord general channel'),
(-1001234567890, 2, 'https://discord.com/api/webhooks/YOUR_WEBHOOK_ID2/YOUR_WEBHOOK_TOKEN2', 'Main group topic 2 to Discord announcements'),
(-1009876543210, NULL, 'https://discord.com/api/webhooks/YOUR_WEBHOOK_ID3/YOUR_WEBHOOK_TOKEN3', 'Secondary group (no topics) to Discord chat');

-- Note: Replace the webhook URLs with your actual Discord webhook URLs
-- Telegram group IDs are negative numbers for supergroups
-- ID_Topic can be NULL for regular groups without topics
