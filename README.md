## ⚙️ Конфигурация окружения (.env)

Для запуска проекта необходимо создать файл `.env` в корневой директории и заполнить его по шаблону ниже.

- [**Telegram BotFather**](https://t.me/BotFather)
- [**Monobank API**](https://api.monobank.ua/index.html)
- [**Cryptocloud Dashboard**](https://app.cryptocloud.plus/)

```py
DOMAIN="https://your-domain.com"

# === DATABASE ===
DATABASE_URL="postgresql+asyncpg://user:password@localhost:5432/dbname"
SDK_URL="https://your.sdk.url"
HERO_RENDER_BASE="https://cdn.steamstatic.com/apps/dota2/videos/dota_react/heroes/renders"

# === AUTH ===
TELEGRAM_BOT_TOKEN="your_bot_token"
TELEGRAM_CLIENT_ID="your_client_id"
TELEGRAM_CLIENT_SECRET="your_client_secret"
TELEGRAM_REDIRECT_URI="/home"
TELEGRAM_ADMIN_IDS="[111, 333]"
TELEGRAM_AGENT_URL="https://t.me/username"

SECRET_KEY="replace_with_32_character_secret"

# === PAYMENTS ===
MONOBANK_RAW_URL="https://send.monobank.ua/jar/xxxx"
MONOBANK_TOKEN="your_monobank_token"
MONOBANK_WEBHOOK_URL="/payment/monobank/callback_secure_string"

CRYPTOCLOUD_API_KEY="your_api_key"
CRYPTOCLOUD_SHOP_ID="your_shop_id"
CRYPTOCLOUD_SECRET_KEY="your_secret_key"

FUNPAY_URL="https://funpay.com/users/0000000"

DISCORD_PAYMENT_INFO_WEBHOOK="https://discord.com/api/webhooks/xxxx/xxxx"

# === APP INFO ===
APP_SECRET_VERSION="1.0"
APP_SECRET_KEY="replace_with_32_character_secret"
APP_TOOLS_VERSION="1.0"
```