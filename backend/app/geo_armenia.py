"""Armenia administrative geography — trilingual (Armenian / English / Russian).

Currently only the Armavir marz is populated (owner-supplied canonical list);
other marzes get appended here as they are digitised.

Each entry is a (hy, en, ru) tuple. `combined()` builds a "hy / en / ru" label;
`dicts()` builds per-language option objects (the form shows the current language).
"""

# (Armenian, English, Russian)
REGIONS: list[tuple[str, str, str]] = [
    ("Երևան", "Yerevan", "Ереван"),
    ("Արագածոտն", "Aragatsotn", "Арагацотн"),
    ("Արարատ", "Ararat", "Арарат"),
    ("Արմավիր", "Armavir", "Армавир"),
    ("Գեղարքունիք", "Gegharkunik", "Гегаркуник"),
    ("Կոտայք", "Kotayk", "Котайк"),
    ("Լոռի", "Lori", "Лори"),
    ("Շիրակ", "Shirak", "Ширак"),
    ("Սյունիք", "Syunik", "Сюник"),
    ("Տավուշ", "Tavush", "Тавуш"),
    ("Վայոց Ձոր", "Vayots Dzor", "Вайоц Дзор"),
]

# Armavir marz only (for now) — the single region the lead form offers.
ARMAVIR_REGION: tuple[str, str, str] = ("Արմավիր", "Armavir", "Армавир")

# Armavir marz — towns/cities
ARMAVIR_CITIES: list[tuple[str, str, str]] = [
    ("Արմավիր", "Armavir", "Армавир"),
    ("Վաղարշապատ", "Vagharshapat", "Вагаршапат"),
    ("Մեծամոր", "Metsamor", "Мецамор"),
]

# Armavir marz — villages (owner-supplied canonical list)
ARMAVIR_VILLAGES: list[tuple[str, str, str]] = [
    ("Աղավնատուն", "Aghavnatun", "Агавнатун"),
    ("Ակնալիճ", "Aknalich", "Акналич"),
    ("Ակնաշեն", "Aknashen", "Акнашен"),
    ("Ալաշկերտ", "Alashkert", "Алашкерт"),
    ("Ամասիա", "Amasia", "Амасиа"),
    ("Ամբերդ", "Amberd", "Амберд"),
    ("Ապագա", "Apaga", "Апага"),
    ("Արագած", "Aragats", "Арагац"),
    ("Արաքս (Արմավիր)", "Araks (Armavir)", "Аракс (Армавир)"),
    ("Արաքս (Վաղարշապատ)", "Araks (Vagharshapat)", "Аракс (Вагаршапат)"),
    ("Արատաշեն", "Aratashen", "Араташен"),
    ("Արազափ", "Arazap", "Аразап"),
    ("Արևադաշտ", "Arevadasht", "Аревадашт"),
    ("Արևաշատ", "Arevashat", "Аревашат"),
    ("Արևիկ", "Arevik", "Аревик"),
    ("Արգավանդ", "Argavand", "Аргаванд"),
    ("Արգինա", "Argina", "Аргина"),
    ("Արմավիր", "Armavir (village)", "Армавир"),
    ("Արշալույս", "Arshaluys", "Аршалуйс"),
    ("Արտամետ", "Artamet", "Артамет"),
    ("Արտաշար", "Artashar", "Арташар"),
    ("Արտիմետ", "Artimet", "Артимет"),
    ("Այգեկ", "Aygek", "Айгек"),
    ("Այգեշատ (Արմավիր)", "Aygeshat (Armavir)", "Айгешат (Армавир)"),
    ("Այգեշատ (Վաղարշապատ)", "Aygeshat (Vagharshapat)", "Айгешат (Вагаршапат)"),
    ("Այգեվան", "Aygevan", "Айгеван"),
    ("Բագարան", "Bagaran", "Багаран"),
    ("Բաղրամյան (Արմավիր)", "Baghramyan (Armavir)", "Баграмян (Армавир)"),
    ("Բաղրամյան (Վաղարշապատ)", "Baghramyan (Vagharshapat)", "Баграмян (Вагаршапат)"),
    ("Բամբակաշատ", "Bambakashat", "Бамбакашат"),
    ("Բերքաշատ", "Berkashat", "Беркашат"),
    ("Դալարիկ", "Dalarik", "Даларик"),
    ("Դաշտ", "Dasht", "Дашт"),
    ("Դողս", "Doghs", "Догс"),
    ("Ֆերիկ", "Ferik", "Ферик"),
    ("Գայ", "Gai", "Гай"),
    ("Գեղակերտ", "Geghakert", "Гегакерт"),
    ("Գետաշեն", "Getashen", "Геташен"),
    ("Գրիբոյեդով", "Griboyedov", "Грибоедов"),
    ("Հացիկ", "Hatsik", "Ацик"),
    ("Հայկաշեն", "Haykashen", "Айкашен"),
    ("Հայկավան", "Haykavan", "Айкаван"),
    ("Հայթաղ", "Haytagh", "Айтаг"),
    ("Հովտամեջ", "Hovtamej", "Овтамедж"),
    ("Հուշակերտ", "Hushakert", "Ушакерт"),
    ("Ջանֆիդա", "Janfida", "Джанфида"),
    ("Ջրառատ", "Jrarat", "Джрарат"),
    ("Ջրարբի", "Jrarbi", "Джрарби"),
    ("Ջրաշեն", "Jrashen", "Джрашен"),
    ("Քարակերտ", "Karakert", "Каракерт"),
    ("Խանջյան", "Khanjyan", "Ханджян"),
    ("Խորոնք", "Khoronk", "Хоронк"),
    ("Կողբավան", "Koghbavan", "Кохбаван"),
    ("Կյուրաքյան", "Kyurakyan", "Кюрякян"),
    ("Լենուղի", "Lenughi", "Ленуги"),
    ("Լեռնագոգ", "Lernagog", "Лернагог"),
    ("Լեռնամերձ", "Lernamerdz", "Лернамердз"),
    ("Լուկաշին", "Lukashin", "Лукашин"),
    ("Լուսագյուղ", "Lusagyugh", "Лусагюх"),
    ("Մարգարա", "Margara", "Маргара"),
    ("Մայիսյան", "Mayisyan", "Маисян"),
    ("Մերձավան", "Merdzavan", "Мердзаван"),
    ("Մրգաստան", "Mrgastan", "Мргастан"),
    ("Մրգաշատ", "Mrgashat", "Мргашат"),
    ("Մուղամ", "Mugam", "Мугам"),
    ("Մուսալեռ", "Musaler", "Мусалер"),
    ("Մյասնիկյան", "Myasnikyan", "Мясникян"),
    ("Նալբանդյան", "Nalbandyan", "Налбандян"),
    ("Նորակերտ", "Norakert", "Норакерт"),
    ("Նոր Արմավիր", "Nor Armavir", "Нор Армавир"),
    ("Նոր Արտագերս", "Nor Artagers", "Нор Артагерс"),
    ("Նոր Կեսարիա", "Nor Kesaria", "Нор Кесария"),
    ("Նորապատ", "Norapat", "Норапат"),
    ("Նորավան", "Noravan", "Нораван"),
    ("Փարաքար", "Parakar", "Паракар"),
    ("Թաիրով", "Tairov", "Таиров"),
    ("Փշատավան", "Pshatavan", "Пшатаван"),
    ("Պտղունք", "Ptghunk", "Птхунк"),
    ("Սարդարապատ", "Sardarapat", "Сардарапат"),
    ("Շահումյան", "Shahumyan", "Шаумян"),
    ("Շահումյանի թռչնաֆաբրիկա", "Shahumyani Trchnafabrika", "Птицефабрика Шаумяна"),
    ("Շենավան", "Shenavan", "Шенаван"),
    ("Շենիկ", "Shenik", "Шеник"),
    ("Տալվորիկ", "Talvorik", "Талворик"),
    ("Թանձուտ", "Tandzut", "Тандзут"),
    ("Տարոնիկ", "Taronik", "Тароник"),
    ("Ծաղկալանջ", "Tsaghkalanj", "Цахкаландж"),
    ("Ծաղկունք", "Tsaghkunk", "Цахкунк"),
    ("Ցիածան", "Tsiatsan", "Циацан"),
    ("Վանանդ", "Vanand", "Вананд"),
    ("Վարդանաշեն", "Vardanashen", "Варданашен"),
    ("Ոսկեհատ", "Voskehat", "Воскехат"),
    ("Եղեգնուտ", "Yeghegnut", "Егегнут"),
    ("Երասխահուն", "Yeraskhahun", "Ераскахун"),
    ("Երվանդաշատ", "Yervandashat", "Ервандашат"),
    ("Զարթոնք", "Zartonk", "Зартонк"),
]


def combined(rows: list[tuple[str, str, str]]) -> list[str]:
    """Build the 'hy / en / ru' dropdown labels stored as a field's options."""
    return [f"{hy} / {en} / {ru}" for hy, en, ru in rows]


def dicts(rows: list[tuple[str, str, str]]) -> list[dict[str, str]]:
    """Per-language option objects — the form shows only the current system language."""
    return [{"hy": hy, "en": en, "ru": ru} for hy, en, ru in rows]
