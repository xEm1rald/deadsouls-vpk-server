import asyncio
from datetime import datetime, UTC, timedelta
from sqlalchemy import String, Float, DateTime, ForeignKey, select, Text, Integer
from sqlalchemy.sql import func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, selectinload
import secrets
from config import DATABASE_URL

# Создаем движок БД и фабрику сессий
engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


# Базовый класс для всех моделей
class Base(DeclarativeBase):
    pass

class GiftCode(Base):
    __tablename__ = 'gift_codes'

    code: Mapped[str] = mapped_column(String(50), primary_key=True)
    subtime: Mapped[int] = mapped_column(Integer, nullable=False) # Количество дней
    usedby: Mapped[int | None] = mapped_column(ForeignKey('users.id', ondelete='SET NULL'), nullable=True)

    user: Mapped["User"] = relationship(back_populates="used_gifts")

class PaymentCryptocloud(Base):
    __tablename__ = 'payments_cryptocloud'

    order_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    invoice_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    status: Mapped[str] = mapped_column(String(50), default='pending')
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), nullable=False)
    product_id: Mapped[str] = mapped_column(String(50), nullable=False)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="cryptocloud_payments")

class PaymentMonobank(Base):
    __tablename__ = 'payments_monobank'

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'))
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default='UAH', nullable=False)
    product_id: Mapped[str] = mapped_column(String(50), nullable=False)
    comment: Mapped[str] = mapped_column(String(255), nullable=True)
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="monobank_payments")

class User(Base):
    __tablename__ = 'users'

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    HWID: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Обновленные поля для Telegram
    # tg_id делаем уникальным (unique=True), чтобы не зарегистрировать одного юзера дважды
    tg_id: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True)

    # Строка JSON. Используем Text, так как JSON может быть больше 255 символов.
    tg_data: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    subscription_end_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    token: Mapped[str | None] = mapped_column(String(255), nullable=True)

    used_gifts: Mapped[list["GiftCode"]] = relationship(back_populates="user")
    cryptocloud_payments: Mapped[list["PaymentCryptocloud"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    monobank_payments: Mapped[list["PaymentMonobank"]] = relationship(back_populates="user",
                                                                      cascade="all, delete-orphan")

# --- Функции для работы с БД ---

async def init_db():
    """Создание таблиц на основе описанных классов (моделей)"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("[+] Таблицы синхронизированы через ORM.")


async def create_new_user(hwid: str = None, tg_id: str = None, tg_data: str = None) -> int:
    """Создает нового пользователя и возвращает его ID"""
    async with async_session() as session:
        new_user = User(
            HWID=hwid,
            tg_id=tg_id,
            tg_data=tg_data
        )
        session.add(new_user)
        await session.commit()
        await session.refresh(new_user)
        print(f"[+] Пользователь создан (ID: {new_user.id}, TG_ID: {tg_id})")
        return new_user.id


async def get_user(
        user_id: int = None,
        hwid: str = None,
        tg_id: str = None,
        include_payments: bool = False
) -> User | None:
    """
    Универсальная функция для получения пользователя.
    Ищет по user_id, hwid ИЛИ tg_id.
    """
    if user_id is None and hwid is None and tg_id is None:
        print("[-] Ошибка: Для поиска нужно указать user_id, hwid или tg_id.")
        return None

    async with async_session() as session:
        query = select(User)

        if user_id is not None:
            query = query.where(User.id == user_id)
        elif hwid is not None:
            query = query.where(User.HWID == hwid)
        elif tg_id is not None:
            query = query.where(User.tg_id == str(tg_id))

        if include_payments:
            query = query.options(
                selectinload(User.cryptocloud_payments),
                selectinload(User.monobank_payments)
            )

        result = await session.execute(query)
        user = result.scalars().first()

        return user


async def get_all_users():
    """Получение всех пользователей (исправлено под новые поля)"""
    async with async_session() as session:
        result = await session.execute(select(User))
        users = result.scalars().all()

        return [
            {
                "id": u.id,
                "HWID": u.HWID,
                "tg_id": u.tg_id,
                "tg_data": u.tg_data,
                "subscription_end_date": u.subscription_end_date
            } for u in users
        ]


async def update_user(
        user_id: int,
        hwid: str = None,
        tg_id: str = None,
        tg_data: str = None,
        subscription_end_date: datetime = None,
        token: str = None
) -> bool:
    """Обновляет данные пользователя."""
    async with async_session() as session:
        user = await session.get(User, user_id)

        if not user:
            print(f"[-] Ошибка: Пользователь с ID {user_id} не найден.")
            return False

        if hwid is not None:
            user.HWID = hwid
        if tg_id is not None:
            user.tg_id = tg_id
        if tg_data is not None:
            user.tg_data = tg_data
        if subscription_end_date is not None:
            user.subscription_end_date = subscription_end_date
        if token is not None:
            user.token = token

        await session.commit()
        print(f"[+] Данные пользователя {user_id} успешно обновлены.")
        return True


async def create_payment(order_id: str, user_id: int, amount: float, currency: str, product_id: str):
    """Создает новую запись о платеже в БД."""
    async with async_session() as session:
        new_payment = PaymentCryptocloud(
            order_id=order_id,
            user_id=user_id,
            amount=amount,
            currency=currency,
            product_id=product_id
        )

        session.add(new_payment)
        await session.commit()
        print(f"[+] Транзакция {order_id} добавлена в БД (Ожидает оплаты).")

async def get_payment(order_id: str) -> PaymentCryptocloud | None:
    """Отримує інформацію про платіж з БД за order_id."""
    async with async_session() as session:
        payment = await session.get(PaymentCryptocloud, order_id)
        return payment

async def update_payment_status(
        order_id: str,
        status: str,
        invoice_id: str = None
) -> bool:
    """Обновляет статус платежа."""
    async with async_session() as session:
        payment = await session.get(PaymentCryptocloud, order_id)

        if not payment:
            print(f"[-] Ошибка: Платеж с order_id {order_id} не найден.")
            return False

        payment.status = status
        if invoice_id is not None:
            payment.invoice_id = invoice_id

        await session.commit()
        print(f"[+] Статус платежа {order_id} изменен на '{status}'.")
        return True


# --- ДОБАВЛЯЕМ ФУНКЦИИ ДЛЯ ПОДАРКОВ И АДМИНКИ ---

async def create_gift_codes(count: int, days: int) -> list[str]:
    """Генерирует гифт-коды пачкой"""
    codes = []
    async with async_session() as session:
        for _ in range(count):
            # Генерируем красивый код вида: DS-A1B2-C3D4-E5F6
            code = f"DS-{secrets.token_hex(2).upper()}-{secrets.token_hex(2).upper()}-{secrets.token_hex(2).upper()}"
            codes.append(code)
            new_gift = GiftCode(code=code, subtime=days)
            session.add(new_gift)

        await session.commit()
    return codes


async def apply_gift_code(user_id: int, code: str) -> dict:
    """Применяет гифт-код к пользователю"""
    async with async_session() as session:
        query = select(GiftCode).where(GiftCode.code == code).with_for_update()
        result = await session.execute(query)
        gift = result.scalar_one_or_none()

        if not gift:
            return {"success": False, "error": "Код не найден"}
        if gift.usedby is not None:
            return {"success": False, "error": "Код уже активирован"}

        user = await session.get(User, user_id)
        if not user:
            return {"success": False, "error": "Пользователь не найден"}

        # Добавляем дни
        if user.subscription_end_date and user.subscription_end_date > datetime.now(UTC):
            user.subscription_end_date += timedelta(days=gift.subtime)
        else:
            user.subscription_end_date = datetime.now(UTC) + timedelta(days=gift.subtime)

        gift.usedby = user.id
        await session.commit()

        return {"success": True, "new_date": str(user.subscription_end_date), "days": gift.subtime}


async def get_all_gift_codes():
    """Получает все коды для админ-бота"""
    async with async_session() as session:
        result = await session.execute(select(GiftCode))
        return result.scalars().all()

async def get_gift_code(code: str) -> GiftCode | None:
    async with async_session() as session:
        # Так как code является primary_key, мы можем использовать session.get()
        gift_code = await session.get(GiftCode, code)
        return gift_code

async def create_monobank_payment(user_id: int, amount: float, product_id: str, comment: str):
    """Создает новую запись о платеже через Monobank в БД."""
    async with async_session() as session:
        new_payment = PaymentMonobank(
            user_id=user_id,
            amount=amount,
            currency="UAH",
            product_id=product_id,
            comment=comment
        )

        session.add(new_payment)
        await session.commit()
        print(f"[+] Транзакция Monobank сохранена в БД (User: {user_id}, Сумма: {amount} UAH).")