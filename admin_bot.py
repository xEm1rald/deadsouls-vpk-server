import asyncio
import logging
import math
from datetime import datetime, UTC
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command
from aiogram.types import Message, ReplyKeyboardMarkup, KeyboardButton, InlineKeyboardMarkup, InlineKeyboardButton, \
    CallbackQuery

import config
import database

logging.basicConfig(level=logging.INFO)

bot = Bot(token=config.TELEGRAM_BOT_TOKEN)
dp = Dispatcher()


# Фильтр для админов
def is_admin(user_id: int) -> bool:
    return user_id in config.TELEGRAM_ADMIN_IDS


@dp.message(Command("start"))
async def cmd_start(message: Message):
    if not is_admin(message.from_user.id):
        return

    kb = [
        [
            KeyboardButton(text="/user"),
            KeyboardButton(text="/pay"),
            KeyboardButton(text="/gifts")
        ],
        [
            KeyboardButton(text="/give"),
            KeyboardButton(text="/sethwid"),
            KeyboardButton(text="/resethwid")
        ],
        [
            KeyboardButton(text="/setver"),
            KeyboardButton(text="/ver"),
            KeyboardButton(text="/gen")
        ]
    ]
    keyboard = ReplyKeyboardMarkup(keyboard=kb, resize_keyboard=True)

    help_text = (
        "🛠 *DeadSouls Admin Panel*\n\n"
        "👤 `/user [id]` - Инфо о пользователе\n"
        "💳 `/pay [id]` - Платежи пользователя\n"
        "🎁 `/gifts` - Список кодов\n"
        "➕ `/give [id] [дни]` - Выдать подписку вручную\n"
        "💻 `/sethwid [id] [hwid]` - Сменить HWID вручную\n"
        "🔄 `/resethwid [id]` - Полностью сбросить HWID\n"
        "⚙️ `/setver [app_ver] [tools_ver]` - Сменить версии ПО\n"
        "ℹ️ `/ver` - Посмотреть текущие версии\n"
        "🔑 `/gen [кол-во] [дни]` - Создать гифт-коды"
    )
    await message.answer(help_text, parse_mode="Markdown", reply_markup=keyboard)


@dp.message(Command("user"))
async def cmd_user(message: Message):
    if not is_admin(message.from_user.id): return
    args = message.text.split()
    if len(args) < 2:
        return await message.answer("Формат: `/user [id/tg_id/hwid]`", parse_mode="Markdown")

    query = args[1]

    # Пытаемся найти пользователя по всем полям
    user = None
    if query.isdigit():
        user = await database.get_user(user_id=int(query))
        if not user:
            user = await database.get_user(tg_id=query)
    else:
        user = await database.get_user(hwid=query)

    if not user:
        return await message.answer("❌ Пользователь не найден.")

    status = "🔴 Неактивна"
    if user.subscription_end_date and user.subscription_end_date > datetime.now(UTC):
        status = f"🟢 Активна до {user.subscription_end_date.strftime('%Y-%m-%d %H:%M')}"

    text = (
        f"👤 **Пользователь ID:** {user.id}\n"
        f"🏷 **TG ID:** {user.tg_id or 'Нет'}\n"
        f"💻 **HWID:** `{user.HWID or 'Не привязан'}`\n"
        f"📅 **Регистрация:** {user.created_at.strftime('%Y-%m-%d')}\n"
        f"💎 **Подписка:** {status}\n"
    )

    # Кнопка сброса (первичная)
    reset_kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔄 Сбросить HWID", callback_data=f"ask_resethwid_{user.id}")]
    ]) if user.HWID else None

    await message.answer(text, parse_mode="Markdown", reply_markup=reset_kb)


# --- ПОДТВЕРЖДЕНИЕ СБРОСА HWID ---
@dp.callback_query(F.data.startswith("ask_resethwid_"))
async def ask_resethwid(callback: CallbackQuery):
    if not is_admin(callback.from_user.id): return
    user_id = callback.data.split("_")[2]

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✅ Да, сбросить", callback_data=f"confirm_resethwid_{user_id}"),
            InlineKeyboardButton(text="❌ Отмена", callback_data=f"cancel_resethwid_{user_id}")
        ]
    ])
    await callback.message.edit_reply_markup(reply_markup=kb)


@dp.callback_query(F.data.startswith("cancel_resethwid_"))
async def cancel_resethwid(callback: CallbackQuery):
    if not is_admin(callback.from_user.id): return
    user_id = callback.data.split("_")[2]

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔄 Сбросить HWID", callback_data=f"ask_resethwid_{user_id}")]
    ])
    await callback.message.edit_reply_markup(reply_markup=kb)


@dp.callback_query(F.data.startswith("confirm_resethwid_"))
async def cb_confirm_resethwid(callback: CallbackQuery):
    if not is_admin(callback.from_user.id): return

    user_id = int(callback.data.split("_")[2])
    success = await database.update_user(user_id=user_id, hwid=None)

    if success:
        await callback.answer("✅ HWID успешно сброшен!", show_alert=True)
        user = await database.get_user(user_id=user_id)
        if user:
            status = "🔴 Неактивна"
            if user.subscription_end_date and user.subscription_end_date > datetime.now(UTC):
                status = f"🟢 Активна до {user.subscription_end_date.strftime('%Y-%m-%d %H:%M')}"

            text = (
                f"👤 **Пользователь ID:** {user.id}\n"
                f"🏷 **TG ID:** {user.tg_id or 'Нет'}\n"
                f"💻 **HWID:** `{user.HWID or 'Не привязан'}`\n"
                f"📅 **Регистрация:** {user.created_at.strftime('%Y-%m-%d')}\n"
                f"💎 **Подписка:** {status}\n"
            )
            try:
                await callback.message.edit_text(text, parse_mode="Markdown", reply_markup=None)
            except Exception:
                pass
    else:
        await callback.answer("❌ Ошибка: Пользователь не найден.", show_alert=True)


@dp.message(Command("resethwid"))
async def cmd_resethwid(message: Message):
    if not is_admin(message.from_user.id): return
    args = message.text.split()
    if len(args) < 2:
        return await message.answer("Формат: `/resethwid [user_id]`", parse_mode="Markdown")

    try:
        user_id = int(args[1])
    except ValueError:
        return await message.answer("ID должен быть числом.")

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✅ Подтвердить", callback_data=f"confirm_resethwid_{user_id}"),
            InlineKeyboardButton(text="❌ Отмена", callback_data="delete_msg")
        ]
    ])
    await message.answer(f"⚠️ Вы уверены, что хотите полностью отвязать HWID у пользователя ID **{user_id}**?",
                         parse_mode="Markdown", reply_markup=kb)


# --- ПРОСМОТР И ИЗМЕНЕНИЕ ВЕРСИЙ ---
@dp.message(Command("ver"))
async def cmd_ver(message: Message):
    if not is_admin(message.from_user.id): return
    await message.answer(
        f"📦 **Текущие версии в памяти:**\n"
        f"🔹 **APP_SECRET_VERSION:** `{config.APP_SECRET_VERSION}`\n"
        f"🔹 **APP_TOOLS_VERSION:** `{config.APP_TOOLS_VERSION}`",
        parse_mode="Markdown"
    )


@dp.message(Command("setver"))
async def cmd_setver(message: Message):
    if not is_admin(message.from_user.id): return
    args = message.text.split()
    if len(args) < 3:
        return await message.answer(
            f"📌 **Формат изменения:** `/setver [app_version] [tools_version]`\n"
            f"💡 *Пример:* `/setver 1.0.5 2.1`",
            parse_mode="Markdown"
        )

    app_ver = args[1]
    tools_ver = args[2]

    kb = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✅ Обновить", callback_data=f"c_setver_{app_ver}|{tools_ver}"),
            InlineKeyboardButton(text="❌ Отмена", callback_data="delete_msg")
        ]
    ])

    await message.answer(
        f"⚠️ **Вы уверены, что хотите сменить версии?**\n\n"
        f"Новая APP_SECRET_VERSION: `{app_ver}`\n"
        f"Новая APP_TOOLS_VERSION: `{tools_ver}`",
        parse_mode="Markdown",
        reply_markup=kb
    )


@dp.callback_query(F.data.startswith("c_setver_"))
async def confirm_setver(callback: CallbackQuery):
    if not is_admin(callback.from_user.id): return

    data = callback.data.replace("c_setver_", "")
    app_ver, tools_ver = data.split("|")

    # Обновляем переменные в памяти (без записи в .env)
    await database.set_setting("APP_SECRET_VERSION", app_ver)
    await database.set_setting("APP_TOOLS_VERSION", tools_ver)

    config.APP_SECRET_VERSION = app_ver
    config.APP_TOOLS_VERSION = tools_ver

    await callback.message.edit_text(
        f"✅ **Версии успешно обновлены (в оперативной памяти)!**\n\n"
        f"🔹 **APP_SECRET_VERSION:** `{config.APP_SECRET_VERSION}`\n"
        f"🔹 **APP_TOOLS_VERSION:** `{config.APP_TOOLS_VERSION}`",
        parse_mode="Markdown"
    )


@dp.callback_query(F.data == "delete_msg")
async def cb_delete_msg(callback: CallbackQuery):
    if not is_admin(callback.from_user.id): return
    try:
        await callback.message.delete()
    except Exception:
        pass


@dp.message(Command("give"))
async def cmd_give(message: Message):
    if not is_admin(message.from_user.id): return
    args = message.text.split()
    if len(args) < 3:
        return await message.answer("Формат: `/give [user_id] [дни]`", parse_mode="Markdown")

    try:
        user_id = int(args[1])
        days = int(args[2])
    except ValueError:
        return await message.answer("ID и дни должны быть числами.")

    user = await database.get_user(user_id=user_id)
    if not user:
        return await message.answer("❌ Пользователь не найден.")

    from datetime import timedelta
    if user.subscription_end_date and user.subscription_end_date > datetime.now(UTC):
        new_date = user.subscription_end_date + timedelta(days=days)
    else:
        new_date = datetime.now(UTC) + timedelta(days=days)

    await database.update_user(user_id=user.id, subscription_end_date=new_date)
    await message.answer(
        f"✅ Пользователю **{user.id}** добавлено {days} дней. Теперь до: {new_date.strftime('%Y-%m-%d %H:%M')}",
        parse_mode="Markdown")


@dp.message(Command("sethwid"))
async def cmd_sethwid(message: Message):
    if not is_admin(message.from_user.id): return
    args = message.text.split()
    if len(args) < 3:
        return await message.answer("Формат: `/sethwid [user_id] [hwid/None]`", parse_mode="Markdown")

    try:
        user_id = int(args[1])
    except ValueError:
        return await message.answer("ID должен быть числом.")

    hwid = args[2]
    if hwid.lower() == "none":
        hwid = None

    success = await database.update_user(user_id=user_id, hwid=hwid)
    if success:
        await message.answer(f"✅ HWID пользователя {user_id} изменен на: `{hwid}`", parse_mode="Markdown")
    else:
        await message.answer("❌ Пользователь не найден.")


@dp.message(Command("gen"))
async def cmd_gen(message: Message):
    if not is_admin(message.from_user.id): return
    args = message.text.split()
    if len(args) < 3:
        return await message.answer("Формат: `/gen [кол-во] [дни]`", parse_mode="Markdown")

    try:
        count = int(args[1])
        days = int(args[2])
    except ValueError:
        return await message.answer("Укажите числа.")

    if count > 50:
        return await message.answer("Максимум 50 кодов за раз.")

    codes = await database.create_gift_codes(count, days)

    text = f"✅ Создано {count} кодов на {days} дней:\n\n"
    text += "\n".join([f"`{c}`" for c in codes])

    await message.answer(text, parse_mode="Markdown")


@dp.message(Command("gifts"))
async def cmd_gifts(message: Message):
    if not is_admin(message.from_user.id): return

    text, kb = await get_gifts_page_content(0)
    await message.answer(text, parse_mode="Markdown", reply_markup=kb)


@dp.callback_query(F.data.startswith("giftpage_"))
async def cb_gifts_page(callback: CallbackQuery):
    if not is_admin(callback.from_user.id):
        return await callback.answer("Доступ запрещен.", show_alert=True)

    page = int(callback.data.split("_")[1])
    text, kb = await get_gifts_page_content(page)

    try:
        await callback.message.edit_text(text, parse_mode="Markdown", reply_markup=kb)
    except Exception:
        pass

    await callback.answer()


@dp.message(Command("pay"))
async def cmd_pay(message: Message):
    if not is_admin(message.from_user.id): return
    args = message.text.split()
    if len(args) < 2:
        return await message.answer("Формат: `/pay [user_id]`", parse_mode="Markdown")

    user = await database.get_user(user_id=int(args[1]), include_payments=True)
    if not user:
        return await message.answer("❌ Пользователь не найден.")

    all_payments = user.cryptocloud_payments + user.monobank_payments

    if not all_payments:
        return await message.answer("У пользователя нет платежей.")

    all_payments.sort(key=lambda x: x.date, reverse=True)

    lines = []
    for p in all_payments:
        p_id = getattr(p, 'order_id', getattr(p, 'id', 'Unknown'))
        gateway = "☁️ CryptoCloud" if hasattr(p, 'order_id') else "🐈 Monobank"
        status = getattr(p, 'status', 'Успешно')

        lines.append(
            f"💳 {gateway} | 🆔 `{p_id}`\n💰 {p.amount} {p.currency} | Статус: {status}\n📅 {p.date.strftime('%Y-%m-%d %H:%M')}")

    text = f"💳 *Платежи User {user.id}:*\n\n" + "\n\n".join(lines)
    await message.answer(text, parse_mode="Markdown")


async def get_gifts_page_content(page: int):
    gifts = await database.get_all_gift_codes()
    gifts.reverse()

    PAGE_SIZE = 30
    total_codes = len(gifts)
    total_pages = math.ceil(total_codes / PAGE_SIZE) if total_codes > 0 else 1

    if page < 0: page = 0
    if page >= total_pages: page = total_pages - 1

    start_idx = page * PAGE_SIZE
    end_idx = min((page + 1) * PAGE_SIZE, total_codes)

    page_gifts = gifts[start_idx:end_idx]

    lines = []
    for g in page_gifts:
        status = f"✅ Активировал ID: {g.usedby}" if g.usedby else "⏳ Доступен"
        lines.append(f"`{g.code}` | {g.subtime} дн. | {status}")

    if not lines:
        text = "🎁 Кодов пока нет."
        kb = None
    else:
        text = (
                   f"🎁 *База Гифт-кодов*\n"
                   f"📊 Всего кодов: *{total_codes}*\n"
                   f"📄 Показаны: *{start_idx + 1}-{end_idx}* (Страница {page + 1}/{total_pages})\n\n"
               ) + "\n".join(lines)

        buttons = []
        if page > 0:
            buttons.append(InlineKeyboardButton(text="⬅️ Назад", callback_data=f"giftpage_{page - 1}"))
        if page < total_pages - 1:
            buttons.append(InlineKeyboardButton(text="Вперед ➡️", callback_data=f"giftpage_{page + 1}"))

        kb = InlineKeyboardMarkup(inline_keyboard=[buttons]) if buttons else None

    return text, kb