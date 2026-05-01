import urllib.parse
import httpx

from .cryptocloud_sdk import AsyncCryptoCloudSDK
from datetime import datetime, UTC

from config import MONOBANK_RAW_URL, MONOBANK_TOKEN, MONOBANK_WEBHOOK_URL, CRYPTOCLOUD_SHOP_ID, CRYPTOCLOUD_API_KEY, DISCORD_PAYMENT_INFO_WEBHOOK


cryptocloud_client = AsyncCryptoCloudSDK(CRYPTOCLOUD_API_KEY)


class Cryptocloud:
    def __init__(self, order_id: str, amount: int, product: str):
        self.order_id = order_id
        self.amount = amount
        self.product = product.lower()

    async def create_invoice(self) -> dict:
        return await cryptocloud_client.create_invoice({
            "amount": self.amount,
            "shop_id": CRYPTOCLOUD_SHOP_ID,
            "currency": "USD",
            "order_id": str(self.order_id)
        })


class Monobank:
    PAYMENT_TEXT = "{} | {}"

    def __init__(self, user: str, amount: int, product: str):
        self.user = user.lower()
        self.amount = amount
        self.product = product.lower()

    def create_link(self) -> str:
        text = self.PAYMENT_TEXT.format(self.user, self.product)
        return MONOBANK_RAW_URL + "?a={}&t={}".format(self.amount, urllib.parse.quote(text))

    @staticmethod
    async def on_startup() -> None:
        api_endpoint = "https://api.monobank.ua/personal/webhook"

        headers = {"X-Token": MONOBANK_TOKEN}
        payload = {"webHookUrl": MONOBANK_WEBHOOK_URL}


        async with httpx.AsyncClient() as client:
            response = await client.request("POST", api_endpoint, headers=headers, json=payload)
            if response.json().get("status") != 'ok':
                print("[-] Ошибка при регистрации вебхука Monobank:", response.text)
            else:
                print("[+] Вебхук Monobank успешно зарегистрирован.")


class Funpay:
    PAYMENT_TEXT = "{} | {}"

    def __init__(self, user: str, amount: int, product: str):
        self.user = user.lower()
        self.amount = amount
        self.product = product.lower()

    def create_link(self) -> str:
        text = self.PAYMENT_TEXT.format(self.user, self.product)
        return "https://test.paypal.payment.link/test" + "?a={}&t={}".format(self.amount, urllib.parse.quote(text))


async def send_payment_webhook(
    tg_username: str,
    order_id: str = "",
    invoice_id: str = "",
    amount: float = "",
    currency: str = "",
    product_name: str = "",
    user_id: str | int = "",
    author_name: str = "DeadSouls Billing",
    avatar_url: str = "https://i.imgur.com/AfFp7pu.png"
):
    # Формируем структуру Embed
    embed = {
        "title": "Successfully Payment",
        "description": f"User paid **{amount} {currency}** for **{product_name}** \n",
        "color": 0x2ecc71,  # Зеленый цвет
        "fields": [
            {
                "name": "user_db",
                "value": f"`{user_id}`",
                "inline": True
            },
            {
                "name": "order_id",
                "value": f"`{order_id}`",
                "inline": True
            },
            {
                "name": "invoice_id",
                "value": f"`{invoice_id}`",
                "inline": True
            },
            {
                "name": "tg_username",
                "value": f"[@{tg_username}](https://t.me/{tg_username})",
                "inline": True
            },
        ],
        "author": {
            "name": author_name,
            "icon_url": avatar_url
        }
    }

    payload = {
        "embeds": [embed]
    }

    # Отправляем запрос асинхронно, чтобы не тормозить основной сервер
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(DISCORD_PAYMENT_INFO_WEBHOOK , json=payload)
            response.raise_for_status()
            print(f"[+] Вебхук об оплате order_id={order_id} отправлен в Discord")
        except Exception as e:
            print(f"[-] Ошибка отправки вебхука в Discord: {e}")
