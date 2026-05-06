import json
import uuid
import os
from pathlib import Path
import hashlib
import hmac
import time
import base64
import secrets
import httpx
import asyncio
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from datetime import datetime, timedelta, UTC
from fastapi import FastAPI, Request, Form, HTTPException, Depends
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse, PlainTextResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.templating import Jinja2Templates
from contextlib import asynccontextmanager
import uvicorn
import jwt
from pydantic import BaseModel

# Добавленные импорты для Zero-Trust авторизации
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from Crypto.Cipher import AES

import database
import config
from payments import payment
import products
from admin_bot import bot, dp


class PaymentRequest(BaseModel):
    currency: str
    product_id: str

class GiftRequest(BaseModel):
    code: str

# Модели для десктопной авторизации
class ChallengeRequest(BaseModel):
    hwid: str
    version: str


class AuthRequest(BaseModel):
    session_id: str
    hwid: str
    ciphertext: str
    nonce: str
    tag: str
    signature: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[+] Запуск сервера. Инициализация БД...")
    await database.init_db()

    # print("[+] Установка Monobank Webhook...")
    # await payment.Monobank.on_startup()

    # Запускаем бота как фоновую задачу (чтобы он не блокировал веб-сервер)
    print("[+] Запуск Telegram Админ-бота...")
    bot_task = asyncio.create_task(dp.start_polling(bot))

    yield

    print("[-] Сервер остановлен.")


app = FastAPI(title="DeadSouls ItemSettings", lifespan=lifespan)
security = HTTPBearer()

# --- Настройка Rate Limit (Защита от DDoS/Брутфорса) ---
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# --- Временное хранилище для авторизации клиента ---
active_sessions = {}
banned_ips = set()

BASE_DIR = Path(os.path.abspath(os.path.dirname(__file__))) / "static"
templates = Jinja2Templates(directory=str(BASE_DIR / 'templates'))


# Утилита для получения IP клиента (с учетом прокси)
def get_client_ip(request: Request) -> str:
    return request.headers.get("X-Forwarded-For", request.client.host).split(",")[0].strip()


@app.get('/')
@limiter.limit("30/minute")
async def index(request: Request):
    return FileResponse(BASE_DIR / 'templates' / 'index.html')


@app.get('/home')
@limiter.limit("30/minute")
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="home.html",
        context={
            "CLIENT_ID": config.TELEGRAM_CLIENT_ID,
            "REDIRECT_URI": config.TELEGRAM_REDIRECT_URI,
            "FUNPAY_URL": config.FUNPAY_URL,
            "TELEGRAM_AGENT_URL": config.TELEGRAM_AGENT_URL
        }
    )


@app.get('/panel')
@limiter.limit("30/minute")
async def panel(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="panel.html",
        context={
            "CDN_URL": config.CDN_URL,
            "VALVE_HERO_RENDERS_CDN_URL": config.HERO_RENDER_URL
        }
    )

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(UTC) + timedelta(minutes=config.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, config.SECRET_KEY, algorithm=config.ALGORITHM)


async def get_current_user(res: HTTPAuthorizationCredentials = Depends(security)):
    token = res.credentials
    try:
        payload = jwt.decode(token, config.SECRET_KEY, algorithms=[config.ALGORITHM])
        user_id = int(payload.get("sub"))
        user = await database.get_user(user_id=user_id)
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


@app.get("/api/frontend/user_info")
async def get_user_info(current_user: database.User = Depends(get_current_user)):
    return JSONResponse({
        "id": current_user.id,
        "subscription_end_date": str(
            current_user.subscription_end_date) if current_user.subscription_end_date else None,
        "hwid": current_user.HWID
    })

@app.post("/api/v1/apply_gift")
@limiter.limit("5/minute")
async def api_apply_gift(
        request: Request,
        body: GiftRequest,
        current_user: database.User = Depends(get_current_user)
):
    result = await database.apply_gift_code(current_user.id, body.code.strip())

    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])

    gift_code = await database.get_gift_code(body.code.strip())

    await payment.send_payment_webhook(
        tg_username=json.loads(current_user.tg_data).get("preferred_username", "-- missing --"),
        paid_value="?",
        fields={"gift_code": body.code.strip(), "used_by": gift_code.usedby, "userdb_id": current_user.id},
        product_name=f"Подписка на {gift_code.subtime} дней",
        author_name="Funpay (Gift-code)",
        avatar_url="https://cdn.discordapp.com/attachments/1500110526792073317/1500110555120406624/image_1.png?ex=69f73e53&is=69f5ecd3&hm=4ee976493e0e11c09a5f61034773ceb077e3b493d85133f7b4587e772a7b436b"
    )

    return JSONResponse({
        "success": True,
        "message": f"Успешно добавлено {result['days']} дней!",
        "new_date": result["new_date"]
    })


# ==========================================
# 🛡️ ZERO-TRUST API (Для десктопного клиента)
# ==========================================

@app.post("/api/v1/get_challenge")
@limiter.limit("5/minute")
async def generate_challenge(request: Request, body: ChallengeRequest):
    client_ip = get_client_ip(request)

    if client_ip in banned_ips:
        raise HTTPException(status_code=403, detail="Banned")

    if body.version != config.APP_SECRET_VERSION:
        raise HTTPException(status_code=426, detail="Upgrade Required")

    challenge = secrets.token_hex(16)
    session_id = secrets.token_hex(16)

    active_sessions[session_id] = {
        "challenge": challenge,
        "ip": client_ip,
        "hwid": body.hwid,
        "expires": time.time() + 60
    }

    return {"session_id": session_id, "challenge": challenge}


@app.post("/api/v1/auth")
@limiter.limit("10/minute")
async def authenticate(request: Request, body: AuthRequest):
    client_ip = get_client_ip(request)

    # 1. Проверка сессии (ID, IP, HWID, Время)
    session = active_sessions.get(body.session_id)
    if not session or time.time() > session["expires"]:
        raise HTTPException(status_code=404, detail="Session expired")

    if session["ip"] != client_ip or session["hwid"] != body.hwid:
        raise HTTPException(status_code=403, detail="Security mismatch")

    # 2. Проверка HMAC подписи (ИСПОЛЬЗУЕМ CHALLENGE вместо APP_SECRET_KEY)
    expected_mac = hmac.new(
        (session["challenge"] + config.APP_SECRET_KEY).encode('utf-8'),
        body.ciphertext.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected_mac, body.signature):
        raise HTTPException(status_code=403, detail="Invalid signature")

    # 3. Попытка расшифровки (доказывает, что клиент знает HWID)
    key_material = (session["challenge"] + session["hwid"] + config.APP_SECRET_KEY).encode('utf-8')
    aes_key = hashlib.sha256(key_material).digest()

    try:
        cipher = AES.new(aes_key, AES.MODE_GCM, nonce=base64.b64decode(body.nonce))
        # Нам даже не важно, что внутри, важен сам факт успешной расшифровки (verify)
        cipher.decrypt_and_verify(base64.b64decode(body.ciphertext), base64.b64decode(body.tag))
    except Exception:
        raise HTTPException(status_code=400, detail="Decryption failed (HWID mismatch)")

    # 4. Проверка пользователя в БД только по HWID
    user = await database.get_user(hwid=body.hwid)

    if not user:
        raise HTTPException(status_code=401, detail="HWID not registered")

    # 5. Проверка подписки
    if not user.subscription_end_date or user.subscription_end_date < datetime.now(UTC):
        raise HTTPException(status_code=403, detail="Subscription expired")

    del active_sessions[body.session_id]

    # 6. Возвращаем ключи, которые ожидает C++ клиент
    return {
        "status": "success",
        "subscription_ends": str(user.subscription_end_date),
        "tools_version": config.APP_TOOLS_VERSION
    }


@app.post("/api/v1/set")
@limiter.limit("3/minute")
async def set_user_hwid(
    request: Request,
    hwid: str,
    current_user: database.User = Depends(get_current_user)
):
    """
    Привязывает HWID к аккаунту пользователя.
    Срабатывает только если HWID еще не был установлен.
    """
    # Если HWID еще не установлен (None или пустая строка)
    if not current_user.HWID:
        await database.update_user(
            user_id=current_user.id,
            hwid=hwid
        )
        print(f"[+] HWID {hwid} успешно привязан к пользователю {current_user.id}")
    else:
        print(f"[!] Попытка смены HWID для пользователя {current_user.id} проигнорирована.")

    # Всегда возвращаем 200 OK, как и просили
    return JSONResponse({"status": "ok"}, status_code=200)


@app.get("/api/v1/version")
@limiter.limit("15/minute")
async def get_app_version(
    request: Request,
    current_user: database.User = Depends(get_current_user)
):
    return JSONResponse({"app_version": config.APP_TOOLS_VERSION}, status_code=200)

# ==========================================
# FILES MANAGER
# ==========================================

@app.get('/sdk/{path:path}')
@limiter.limit("300/minute")
async def static_assets(request: Request, path: str):
    link = f"{config.CDN_URL.strip('/')}/{path.strip('/')}"
    return RedirectResponse(
        url=link,
        status_code=307,
        headers={"Cache-Control": "public, max-age=3600"} # Кешировать редирект на 1 час
    )

@app.get('/{filename:path}')
@limiter.limit("200/minute")
async def static_assets(request: Request, filename: str):
    try:
        file_path = (BASE_DIR / filename).resolve()
        base_dir_resolved = BASE_DIR.resolve()

        if not file_path.is_relative_to(base_dir_resolved):
            raise HTTPException(status_code=403, detail="Forbidden")

        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        raise HTTPException(status_code=404, detail="File not found")
    except Exception:
        raise HTTPException(status_code=404, detail="File not found")


# ==========================================
# 🌐 WEB API И ПЛАТЕЖИ
# ==========================================

@app.post("/auth/telegram")
@limiter.limit("5/minute")
async def telegram_auth_oidc(request: Request):
    body = await request.json()
    code = body.get("code")

    if not code:
        raise HTTPException(status_code=400, detail="Code is missing")

    auth_header = base64.b64encode(f"{config.TELEGRAM_CLIENT_ID}:{config.TELEGRAM_CLIENT_SECRET}".encode()).decode()

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://oauth.telegram.org/token",
            headers={
                "Authorization": f"Basic {auth_header}",
                "Content-Type": "application/x-www-form-urlencoded"
            },
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": config.TELEGRAM_REDIRECT_URI
            }
        )

    print("[Telegram OIDC] Code exchange response:", response.status_code, response.text)

    if response.status_code != 200:
        return JSONResponse(
            {"success": False, "error": "Failed to exchange code", "details": response.json()},
            status_code=400
        )

    tokens = response.json()
    id_token = tokens.get("id_token")

    decoded_data = jwt.decode(id_token.encode('utf-8'), options={"verify_signature": False})
    tg_sub = str(decoded_data.get("sub"))
    tg_id = decoded_data.get("id")

    print(f"[+] OIDC Вход успешен! TG-ID: {tg_id}")

    user = await database.get_user(tg_id=tg_id)
    if not user:
        user_id = await database.create_new_user(
            tg_id=tg_id,
            tg_data=json.dumps(decoded_data, ensure_ascii=False)
        )
    else:
        user_id = user.id
        await database.update_user(user_id, tg_data=json.dumps(decoded_data))

    access_token = create_access_token(data={"sub": str(user_id)})

    return {"success": True, "access_token": access_token, "token_type": "bearer"}


@app.post('/payment/cryptocloud')
@limiter.limit("1/minute")
async def cryptocloud_payment(
        request: Request,
        req: PaymentRequest,
        current_user: database.User = Depends(get_current_user)
):
    product = products.get(req.product_id)

    if req.currency.lower() != "usd":
        return HTTPException(detail="Invalid currency", status_code=400)
    if not product:
        return HTTPException(detail="Invalid product", status_code=400)

    try:
        order_id = str(uuid.uuid4())
        response = (await payment
                    .Cryptocloud(
            order_id=order_id,
            amount=int(product.get("prices").get("usd")),
            product=product.get("name")
        )
                    .create_invoice())

        if response.get("status") != "success" or "result" not in response:
            return HTTPException(detail=f"API Error: {response}", status_code=400)

        pay_url = response.get("result", {}).get("link") or response.get("pay_url")

        if not pay_url:
            return HTTPException(detail=f"Error: Payment url not found.\nAPI response: {response}", status_code=404)

        print("[Cryptocloud] {} - Created invoice for {} - {}".format(order_id, int(product.get("prices").get("usd")),
                                                                      product.get("name")))

        await database.create_payment(
            order_id=order_id,
            user_id=current_user.id,
            amount=response.get("result").get("amount"),
            currency=response.get("result").get("fiat_currency"),
            product_id=req.product_id
        )

        return JSONResponse({"url": pay_url})

    except Exception as e:
        print("Error: {}".format(e))
        return HTTPException(status_code=500, detail="Internal error")


@app.post('/payment/cryptocloud/callback')
async def handle_postback_cryptocloud(request: Request):
    try:
        data = await request.json()
    except Exception:
        return PlainTextResponse("Invalid payload", status_code=400)

    status = data.get('status')
    invoice_id = data.get('invoice_id')
    order_id = data.get('order_id')
    token = data.get('token')

    try:
        jwt.decode(token, config.CRYPTOCLOUD_SECRET_KEY, algorithms=['HS256'])

        print(f"[Cryptocloud] {order_id} | {invoice_id} - Invoice Paid closed - {status}")

        end_response = PlainTextResponse("OK", status_code=200)

        await database.update_payment_status(
            order_id=order_id,
            status=status
        )

        payment_db = await database.get_payment(order_id=order_id)
        product = products.get(payment_db.product_id)

        if not product:
            print("[Cryptocloud] Unavailable to give subscription: Invalid product '{}'".format(payment_db.product_id))
            return end_response

        user_db = await database.get_user(user_id=payment_db.user_id)

        if not user_db:
            return end_response

        if user_db.subscription_end_date and user_db.subscription_end_date > datetime.now(UTC):
            new_end_date = user_db.subscription_end_date + timedelta(days=product.get("duration", 0))
        else:
            new_end_date = datetime.now(UTC) + timedelta(days=product.get("duration", 0))

        await database.update_user(
            user_id=user_db.id,
            subscription_end_date=new_end_date
        )

        await payment.send_payment_webhook(
            tg_username=json.loads(user_db.tg_data).get("preferred_username", "-- missing --"),
            fields={"order_id": order_id, "invoice_id": invoice_id, "userdb_id": user_db.id},
            paid_value=f"{payment_db.amount} {payment_db.currency}",
            product_name=product.get('name'),
            author_name="CryptoCloud",
            avatar_url="https://cdn.discordapp.com/attachments/1500110526792073317/1500118140544221224/cc.png?ex=69f74563&is=69f5f3e3&hm=874b0713fb033c8c94cb5b8fba8856f44bd0d5d0cdf11892cd3a09c9dcb58636"
        )

        return end_response
    except jwt.InvalidTokenError:
        return PlainTextResponse("Invalid token", status_code=400)


# @app.post('/payment/monobank')
# @limiter.limit("2/minute")
# async def monobank_payment(
#         request: Request,
#         req: PaymentRequest,
#         current_user: database.User = Depends(get_current_user)
# ):
#     product = products.get(req.product_id)
#
#     if req.currency.lower() != "uah":
#         raise HTTPException(status_code=400, detail="Invalid currency")
#     if not product:
#         raise HTTPException(status_code=400, detail="Invalid product")
#
#     price_uah = product.get("prices", {}).get("uah")
#     if price_uah is None:
#         raise HTTPException(status_code=400, detail="Для этого товара не указана цена в UAH")
#
#     try:
#         link = (payment
#                 .Monobank(
#             user=str(current_user.tg_id),
#             amount=int(price_uah),
#             product=product.get("secure_name")
#         )
#                 .create_link())
#
#         if not link:
#             raise HTTPException(status_code=404, detail="Payment url not found.")
#
#         print("[Monobank] {} - Created url for {} UAH  - {}".format(current_user.id, price_uah, product.get("name")))
#
#         return JSONResponse({"url": link})
#
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))


# def verify_mono_signature(x_sign_base64: str, body_bytes: bytes) -> bool:
#     try:
#         # 1. Декодируем подпись из Base64
#         signature = base64.b64decode(x_sign_base64)
#
#         # 2. Загружаем публичный ключ Monobank
#         public_key = serialization.load_pem_public_key(
#             config.MONOBANK_TOKEN.encode('utf-8')
#         )
#
#         # 3. Проверяем подпись (Monobank использует ECDSA с SHA256)
#         public_key.verify(
#             signature,
#             body_bytes,
#             ec.ECDSA(hashes.SHA256())
#         )
#         return True
#     except Exception as e:
#         print(f"[Monobank] Ошибка верификации подписи: {e}")
#         return False

# @app.post('/payment/monobank/callback')
# async def handle_postback_monobank(request: Request):
#     raw = await request.body()
#     print(request.headers)
#     x_sign = request.headers.get("X-Sign")
#     print(x_sign)
#
#     if not x_sign or not verify_mono_signature(x_sign, raw):
#         return PlainTextResponse("Forbidden", status_code=403)
#
#     end_response = PlainTextResponse("OK", status_code=200)
#
#     try:
#         data = json.loads(raw)
#
#         if data.get("type") != "StatementItem":
#             return end_response
#
#         comment = data.get('data', {}).get("statementItem", {}).get("comment", None)
#         if not comment:
#             return end_response
#
#         operation_amount = int(data.get('data', {}).get("statementItem", {}).get("operationAmount", 0))
#         user, product = comment.split(" | ")
#
#         product_data = {p.get("secure_name"): p for p in products.get_list().values()}.get(product)
#
#         if not product_data:
#             print("Invalid product")
#             return end_response
#
#         if product_data.get("prices", {}).get("uah") != int(operation_amount * 0.01):
#             return end_response
#
#         print(
#             f"[Monobank] {user} paid {int(operation_amount * 0.01)} UAH for {product_data.get('name')} - successfully")
#
#         try:
#             user = int(user)
#         except:
#             print("[Monobank] Unavailable to give subscription: Invalid user '{}'".format(user))
#             return end_response
#
#         user_db = await database.get_user(tg_id=str(user))
#         if not user_db:
#             print("[Monobank] Unavailable to give subscription: User not exists '{}'".format(user))
#
#         if user_db.subscription_end_date and user_db.subscription_end_date > datetime.now(UTC):
#             new_end_date = user_db.subscription_end_date + timedelta(days=product_data.get("duration", 0))
#         else:
#             new_end_date = datetime.now(UTC) + timedelta(days=product_data.get("duration", 0))
#
#         await database.update_user(
#             user_id=user_db.id,
#             subscription_end_date=new_end_date
#         )
#
#         await database.create_monobank_payment(
#             user_id=user_db.id,
#             amount=operation_amount * 0.01,
#             product_id=product,  # Сюда запишется secure_name тарифа
#             comment=comment
#         )
#
#         await payment.send_payment_webhook(
#             tg_username=json.loads(user_db.tg_data).get("preferred_username", "-- missing --"),
#             order_id="-1",
#             amount=int(operation_amount * 0.01),
#             currency="UAH",
#             product_name=product_data.get('name'),
#             user_id=user_db.id or str(user),
#             author_name="Monobank",
#             avatar_url="https://send.monobank.ua/img/favicon/android/android-icon-144x144.png"
#         )
#
#         return end_response
#
#     except Exception as e:
#         print(f"Error processing Monobank callback: {str(e)}")
#         return end_response



if __name__ == '__main__':
    print("------------------------------------------")
    print("DeadSouls ItemSettings Site is Running! (FastAPI)")
    print("Open your browser and go to: http://127.0.0.1:80")
    print("------------------------------------------")
    uvicorn.run(app, host='0.0.0.0', port=80)