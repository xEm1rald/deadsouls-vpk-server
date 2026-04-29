import asyncio
from datetime import datetime
from sqlalchemy import String, Float, DateTime, ForeignKey, select, Text
from sqlalchemy.sql import func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, selectinload
from config import DATABASE_URL

# Создаем движок БД и фабрику сессий
engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


# Базовый класс для всех моделей
class Base(DeclarativeBase):
    pass


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

    user: Mapped["User"] = relationship(back_populates="payments")


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

    payments: Mapped[list["PaymentCryptocloud"]] = relationship(back_populates="user", cascade="all, delete-orphan")


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
            query = query.options(selectinload(User.payments))

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