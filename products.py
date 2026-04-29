import json


def _load_static_data() -> dict:
    with open('static/data/products.json', encoding="utf-8") as json_file:
        data = json.load(json_file)
    return data


PRODUCTS = _load_static_data()


def get_list() -> dict:
    return PRODUCTS

def get(product_id: int | str) -> dict | None:
    return PRODUCTS.get(str(product_id), None)
