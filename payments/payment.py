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
    paid_value: str = "",
    product_name: str = "",
    author_name: str = "DeadSouls Billing",
    avatar_url: str = "https://i.imgur.com/AfFp7pu.png",
    fields: dict = None,
    color: int = 0x2ecc71
):

    if fields:
        fields = [{"name": k, "value": f"`{v}`", "inline": True} for k, v in fields.items()]

    payload = {
        "embeds": [
            {
                "title": "Successful Payment",
                "description": f"**[@{tg_username}](https://t.me/{tg_username})** paid **{paid_value}** for **{product_name}** \n",
                "color": color,
                "fields": fields,
                "author": {
                    "name": author_name,
                    "icon_url": avatar_url
                }
            }
        ],

    }

    # Отправляем запрос асинхронно, чтобы не тормозить основной сервер
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(DISCORD_PAYMENT_INFO_WEBHOOK , json=payload)
            response.raise_for_status()
            print(f"[+] Вебхук об оплате order_id={order_id} отправлен в Discord")
        except Exception as e:
            print(f"[-] Ошибка отправки вебхука в Discord: {e}")
