# Telegram to Discord Forwarder

A real-time message forwarder that automatically forwards messages from Telegram groups/topics to Discord channels using webhooks. Features include automatic watermarking of images, profile picture preservation, and 24/7 operation with automatic reconnection.

## Features

- ✅ **Real-time forwarding** - Messages are forwarded instantly
- 🖼️ **Image watermarking** - Automatically adds watermarks to images
- 👤 **Profile preservation** - Maintains original usernames and profile pictures
- 📁 **Multi-media support** - Forwards text, images, videos, and files
- 🔄 **Auto-reconnection** - Handles connection drops gracefully
- 📊 **Database routing** - Flexible group/topic to webhook mapping
- 🧹 **Auto cleanup** - Manages temporary files automatically
- 📝 **Comprehensive logging** - Detailed logs for monitoring and debugging

## Prerequisites

- Node.js 18.0.0 or higher
- MySQL database
- Telegram API credentials
- Discord webhook URLs

## Installation

1. **Clone or download the project**
   ```bash
   git clone https://github.com/brianandhikap/tgdcbridge-JS
   cd tgdcbridge-JS
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Setup environment variables**
   Copy `env.example` to `.env` file and fill in your credentials:
   ```env
   # Telegram Configuration
   TELEGRAM_API_ID=your_api_id
   TELEGRAM_API_HASH=your_api_hash
   TELEGRAM_SESSION=your_session_string

   # MySQL Database
   MYSQL_HOST=localhost
   MYSQL_USER=your_username
   MYSQL_PASSWORD=your_password
   MYSQL_DATABASE=tgdcbridge_JS

   # Default Photo Profile
   PP=PP.png

   # Watermark
   WM=WM.png
   ```

4. **Setup database**
   ```bash
   npm run setup-db
   ```

5. **Add your images**
   - Place your default profile picture as `img/PP.png`
   - Place your watermark image as `img/WM.png`

## Configuration

### Getting Telegram Credentials

1. **API ID and Hash:**
   - Go to https://my.telegram.org/apps
   - Create a new application
   - Copy `api_id` and `api_hash`

2. **Session String:**
   - Use a session string generator or create one programmatically
   - The session string authenticates your bot with Telegram

### Setting up Discord Webhooks

1. Go to your Discord server settings
2. Navigate to Integrations → Webhooks
3. Create a new webhook for each channel you want to forward to
4. Copy the webhook URL

### Database Configuration

The routing table maps Telegram groups/topics to Discord webhooks:

```sql
INSERT INTO routing (ID_Groups, ID_Topic, DC_Webhook, Comment) VALUES
(-1001234567890, 1, 'https://discord.com/api/webhooks/YOUR_WEBHOOK_URL', 'Main group topic 1'),
(-1001234567890, 2, 'https://discord.com/api/webhooks/YOUR_WEBHOOK_URL2', 'Main group topic 2'),
(-1009876543210, NULL, 'https://discord.com/api/webhooks/YOUR_WEBHOOK_URL3', 'Regular group');
```

**Important Notes:**
- Telegram group IDs are negative numbers for supergroups
- Use `NULL` for `ID_Topic` if the group doesn't use topics
- Replace webhook URLs with your actual Discord webhook URLs

## Usage

### Starting the Forwarder

```bash
# Production
npm start

# Development (with auto-restart)
npm run dev
```

### Testing

```bash
# Test database setup
npm run setup-db

# Test watermark functionality
node scripts/test-watermark.js
```

## File Structure

```
telegram-discord-forwarder/
├── img/                          # Images directory
│   ├── PP.png                   # Default profile picture
│   └── WM.png                   # Watermark image
├── db/                          # Database scripts
│   ├── 01-create-database.sql   # Database creation
│   └── 02-insert-routing-data.sql # Sample routing data
├── lib/                         # Core libraries
│   ├── database.js              # Database connection and queries
│   ├── telegram-client.js       # Telegram API client
│   ├── discord-forwarder.js     # Discord webhook handler
│   ├── image-processor.js       # Image processing and watermarking
│   ├── media-handler.js         # Media file processing
│   └── utils.js                 # Utility functions
├── scripts/                     # Utility scripts
│   ├── setup-database.js        # Database setup script
│   └── test-watermark.js        # Watermark testing
├── temp/                        # Temporary files (auto-created)
├── logs/                        # Log files (auto-created)
├── index.js                     # Main application entry point
├── .env                         # Environment variables
├── package.json                 # Node.js dependencies
└── README.md                    # This file
```

## How It Works

1. **Connection**: The app connects to Telegram using your API credentials
2. **Monitoring**: It monitors configured groups and topics for new messages
3. **Processing**: When a message arrives:
   - Extracts sender information (username, profile picture)
   - Downloads and processes media files
   - Adds watermarks to images
   - Uses default profile picture if sender has none
4. **Forwarding**: Sends the processed message to the corresponding Discord webhook
5. **Cleanup**: Automatically cleans up temporary files

## Troubleshooting

### Common Issues

1. **"Missing Telegram API credentials"**
   - Ensure all Telegram environment variables are set correctly
   - Verify your session string is valid

2. **"Database connection failed"**
   - Check MySQL server is running
   - Verify database credentials in `.env`
   - Run `npm run setup-db` to create the database

3. **"Watermark file not found"**
   - Ensure `img/WM.png` exists
   - Check the file path in `WM` environment variable

4. **"Webhook test failed"**
   - Verify Discord webhook URLs are correct
   - Check Discord server permissions
   - Ensure webhooks haven't been deleted

### Logs

- Application logs are displayed in the console
- Error logs are saved to `logs/error_YYYY-MM-DD.log`
- Check logs for detailed error information

## Performance

- **Memory usage**: ~50-100MB typical
- **CPU usage**: Low, spikes during media processing
- **Network**: Depends on message volume and media size
- **Storage**: Temporary files are cleaned automatically

## Security

- Keep your `.env` file secure and never commit it to version control
- Use strong MySQL passwords
- Regularly rotate your Telegram session string
- Monitor Discord webhook usage

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review the logs for error details
3. Create an issue with detailed information about your problem

---

**Note**: This forwarder is designed for legitimate use cases. Ensure you comply with Telegram's and Discord's Terms of Service when using this tool.
