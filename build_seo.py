#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_seo.py — regenerates the SEO layer for tengo-sed.cl

Writes:
  * JSON-LD structured data injected into index.html between the
    <!--SEO-JSONLD--> markers
  * sitemap.xml
  * robots.txt

Run after any change to products_inventory.json:
    python build_seo.py

Why JSON-LD matters here: the catalog is rendered by JavaScript, so the 220
products never appear in the raw HTML. Google executes JS, but most AI crawlers
(GPTBot, ClaudeBot, PerplexityBot, Google-Extended) do not. JSON-LD sits in the
raw HTML, so it is what makes the catalog visible to AI answer engines.
"""
import json, io, os, re
from datetime import date

ROOT   = os.path.dirname(os.path.abspath(__file__))
SITE   = "https://tengo-sed.cl"
PHONE  = "+56992380324"
WA     = "https://wa.me/56992380324"

BRANCHES = [
    {"name": "Tengo Sed",   "street": "Genaro Gallo 2836A",   "lat": -20.2307, "lon": -70.1357},
    {"name": "Los Negros",  "street": "Genaro Gallo 2243",    "lat": -20.2307, "lon": -70.1357},
    {"name": "Red & White", "street": "18 de Septiembre 1578","lat": -20.2140, "lon": -70.1520},
]

HOURS = [
    {"@type": "OpeningHoursSpecification",
     "dayOfWeek": ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"],
     "opens": "12:00", "closes": "01:00"},
    {"@type": "OpeningHoursSpecification",
     "dayOfWeek": ["Friday", "Saturday"],
     "opens": "12:00", "closes": "03:00"},
]

CAT_ES = {
    "cerveza": "Cerveza", "whisky": "Whisky", "vino": "Vino", "pisco": "Pisco",
    "ron": "Ron", "tequila": "Tequila", "gin": "Gin", "vodka": "Vodka",
    "bebidas": "Bebidas", "fernet": "Cócteles", "confites": "Confites",
    "promos": "Promociones", "otro": "Otros",
}


def load(name):
    return json.load(io.open(os.path.join(ROOT, name), encoding="utf-8"))


def build_jsonld():
    inv = load("products_inventory.json")
    items = inv if isinstance(inv, list) else inv.get("products", inv)
    imgmap = load("product_img_map.json")

    # ---- One LocalBusiness per branch -------------------------------------
    stores = []
    for i, b in enumerate(BRANCHES):
        stores.append({
            "@type": "LiquorStore",
            "@id": f"{SITE}/#branch-{i}",
            "name": f"Tengo Sed — {b['name']}" if b["name"] != "Tengo Sed" else "Tengo Sed",
            "image": f"{SITE}/logo.png",
            "telephone": PHONE,
            "priceRange": "$$",
            "currenciesAccepted": "CLP",
            "address": {
                "@type": "PostalAddress",
                "streetAddress": b["street"],
                "addressLocality": "Iquique",
                "addressRegion": "Tarapacá",
                "addressCountry": "CL",
            },
            "geo": {"@type": "GeoCoordinates",
                    "latitude": b["lat"], "longitude": b["lon"]},
            "openingHoursSpecification": HOURS,
            "areaServed": {"@type": "City", "name": "Iquique"},
            "url": SITE,
            "sameAs": [WA],
        })

    # ---- The catalog, so AI crawlers can actually read it ------------------
    offers = []
    for p in items:
        name = p.get("name", "").strip()
        if not name:
            continue
        img = imgmap.get(name)
        entry = {
            "@type": "Product",
            "name": name,
            "category": CAT_ES.get(p.get("cat", ""), p.get("cat", "")),
            "brand": {"@type": "Brand", "name": "Tengo Sed"},
        }
        if p.get("desc"):
            entry["description"] = p["desc"]
        if img:
            entry["image"] = f"{SITE}/products/{img.split('?')[0]}"
        price = p.get("price")
        if isinstance(price, (int, float)) and price > 0:
            entry["offers"] = {
                "@type": "Offer",
                "price": int(price),
                "priceCurrency": "CLP",
                "availability": ("https://schema.org/OutOfStock" if p.get("agotado")
                                 else "https://schema.org/InStock"),
                "url": SITE,
                "seller": {"@id": f"{SITE}/#branch-0"},
                "areaServed": {"@type": "City", "name": "Iquique"},
            }
        offers.append(entry)

    catalog = {
        "@type": "ItemList",
        "@id": f"{SITE}/#catalogo",
        "name": "Catálogo Tengo Sed",
        "numberOfItems": len(offers),
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "item": o}
            for i, o in enumerate(offers)
        ],
    }

    website = {
        "@type": "WebSite",
        "@id": f"{SITE}/#website",
        "url": SITE,
        "name": "Tengo Sed",
        "inLanguage": "es-CL",
        "description": ("Botillería con delivery express en Iquique. Cervezas, "
                        "whisky, pisco, vinos y promociones. Pedidos por WhatsApp."),
    }

    # FAQ — this is the format AI answer engines quote most readily
    faq = {
        "@type": "FAQPage",
        "@id": f"{SITE}/#faq",
        "mainEntity": [
            {"@type": "Question", "name": "¿Hacen delivery de alcohol en Iquique?",
             "acceptedAnswer": {"@type": "Answer", "text":
              "Sí. Tengo Sed hace delivery de licores, cervezas y bebidas en toda "
              "la ciudad de Iquique, con entrega en 30 a 60 minutos. Los pedidos se "
              f"hacen por WhatsApp al {PHONE}."}},
            {"@type": "Question", "name": "¿Hasta qué hora está abierto?",
             "acceptedAnswer": {"@type": "Answer", "text":
              "De domingo a jueves atendemos de 12:00 a 01:00. Viernes y sábado "
              "extendemos hasta las 03:00."}},
            {"@type": "Question", "name": "¿Cómo hago un pedido?",
             "acceptedAnswer": {"@type": "Answer", "text":
              f"Los pedidos se toman por WhatsApp al {PHONE}. Escribe qué "
              "productos necesitas y tu dirección en Iquique, y te confirmamos el "
              "total y el tiempo de entrega."}},
            {"@type": "Question", "name": "¿Dónde están ubicados?",
             "acceptedAnswer": {"@type": "Answer", "text":
              "Tenemos tres sucursales en Iquique: Tengo Sed en Genaro Gallo 2836A, "
              "Los Negros en Genaro Gallo 2243, y Red & White en 18 de Septiembre 1578."}},
            {"@type": "Question", "name": "¿Venden a menores de edad?",
             "acceptedAnswer": {"@type": "Answer", "text":
              "No. La venta de alcohol a menores de 18 años está prohibida por la "
              "Ley de Alcoholes de Chile. Se solicita cédula de identidad al entregar."}},
        ],
    }

    return {"@context": "https://schema.org",
            "@graph": stores + [website, catalog, faq]}


def inject(html_path, payload):
    s = io.open(html_path, encoding="utf-8").read()
    block = ('<!--SEO-JSONLD-->\n<script type="application/ld+json">\n'
             + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
             + '\n</script>\n<!--/SEO-JSONLD-->')
    if "<!--SEO-JSONLD-->" in s:
        s = re.sub(r"<!--SEO-JSONLD-->.*?<!--/SEO-JSONLD-->", lambda m: block, s, flags=re.S)
    else:
        s = s.replace("</head>", block + "\n</head>", 1)
    io.open(html_path, "w", encoding="utf-8", newline="").write(s)
    return len(block)


def write_sitemap():
    today = date.today().isoformat()
    urls = [(SITE + "/", "1.0", "daily"), (SITE + "/store.html", "0.8", "daily")]
    body = "\n".join(
        f"  <url>\n    <loc>{u}</loc>\n    <lastmod>{today}</lastmod>\n"
        f"    <changefreq>{c}</changefreq>\n    <priority>{p}</priority>\n  </url>"
        for u, p, c in urls)
    io.open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8", newline="").write(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + body + "\n</urlset>\n")


def write_robots():
    # AI crawlers are allowed on purpose: being cited in AI answers is a goal.
    io.open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8", newline="").write(
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /catalog-editor.html\n"
        "Disallow: /stamp-agent.html\n"
        "Disallow: /catalog-print\n"
        "Disallow: /*.json$\n\n"
        "# AI answer engines — explicitly welcome\n"
        "User-agent: GPTBot\nAllow: /\n\n"
        "User-agent: OAI-SearchBot\nAllow: /\n\n"
        "User-agent: ChatGPT-User\nAllow: /\n\n"
        "User-agent: ClaudeBot\nAllow: /\n\n"
        "User-agent: Claude-Web\nAllow: /\n\n"
        "User-agent: PerplexityBot\nAllow: /\n\n"
        "User-agent: Google-Extended\nAllow: /\n\n"
        "User-agent: Applebot-Extended\nAllow: /\n\n"
        f"Sitemap: {SITE}/sitemap.xml\n")


if __name__ == "__main__":
    data = build_jsonld()
    n = inject(os.path.join(ROOT, "index.html"), data)
    write_sitemap()
    write_robots()
    prods = next(x for x in data["@graph"] if x.get("@type") == "ItemList")
    print(f"JSON-LD injected: {n:,} bytes")
    print(f"  branches      : {sum(1 for x in data['@graph'] if x.get('@type')=='LiquorStore')}")
    print(f"  products      : {prods['numberOfItems']}")
    print(f"  FAQ entries   : {len(next(x for x in data['@graph'] if x.get('@type')=='FAQPage')['mainEntity'])}")
    print("sitemap.xml + robots.txt written")
