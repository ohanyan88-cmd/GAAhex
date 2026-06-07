"""Armenia administrative geography — trilingual (Armenian / English / Russian).

Source: RA 2011 census settlement table (English column extracted from the PDF;
Armenian + Russian rendered to standard forms). Currently only the Armavir marz
is populated — other marzes get appended here as they are digitised.

Each entry is a (hy, en, ru) tuple. `combined()` builds the "hy / en / ru" label
the lead form's Region / City / Village dropdowns store.
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

# Armavir marz — towns/cities
ARMAVIR_CITIES: list[tuple[str, str, str]] = [
    ("Արմավիր (Հոկտեմբերյան)", "Armavir (Hoktemberyan)", "Армавир (Октемберян)"),
    ("Վաղարշապատ (Էջմիածին)", "Vagharshapat (Echmiadzin)", "Вагаршапат (Эчмиадзин)"),
    ("Մեծամոր", "Metsamor", "Мецамор"),
]

# Armavir marz — villages
ARMAVIR_VILLAGES: list[tuple[str, str, str]] = [
    ("Ակնալիճ", "Aknalich", "Акналич"),
    ("Ակնաշեն", "Aknashen", "Акнашен"),
    ("Աղավնատուն", "Aghavnatun", "Агавнатун"),
    ("Ամասիա", "Amasia", "Амасия"),
    ("Ամբերդ", "Amberd", "Амберд"),
    ("Այգեկ", "Aygek", "Айгек"),
    ("Այգեշատ (Արմավիրի)", "Aygeshat (Armavir district)", "Айгешат (Армавирский)"),
    ("Այգեշատ (Էջմիածնի)", "Aygeshat (Echmiadzin district)", "Айгешат (Эчмиадзинский)"),
    ("Ապագա", "Apaga", "Апага"),
    ("Արատաշեն", "Aratashen", "Араташен"),
    ("Արագած", "Aragats", "Арагац"),
    ("Արազափ", "Arazap", "Аразап"),
    ("Արաքս (Արմավիրի)", "Araks (Armavir district)", "Аракс (Армавирский)"),
    ("Արաքս (Էջմիածնի)", "Araks (Echmiadzin district)", "Аракс (Эчмиадзинский)"),
    ("Արգավանդ", "Argavand", "Аргаванд"),
    ("Արգինա", "Argina", "Аргина"),
    ("Արմավիր", "Armavir", "Армавир"),
    ("Արշալույս", "Arshaluys", "Аршалуйс"),
    ("Արտամետ", "Artamet", "Артамет"),
    ("Արտիմետ", "Artimet", "Артимет"),
    ("Արտաշար", "Artashar", "Арташар"),
    ("Արևադաշտ", "Arevadasht", "Аревадашт"),
    ("Արևաշատ", "Arevashat", "Аревашат"),
    ("Արևիկ", "Arevik", "Аревик"),
    ("Բագարան", "Bagaran", "Багаран"),
    ("Բաղրամյան (Բաղրամյանի)", "Baghramyan (Baghramyan district)", "Баграмян (Баграмянский)"),
    ("Բաղրամյան (Էջմիածնի)", "Baghramyan (Echmiadzin district)", "Баграмян (Эчмиадзинский)"),
    ("Բամբակաշատ", "Bambakashat", "Бамбакашат"),
    ("Բերքաշատ", "Berkashat", "Беркашат"),
    ("Գայ", "Gay", "Гай"),
    ("Գետաշեն", "Getashen", "Геташен"),
    ("Գրիբոյեդով", "Griboyedov", "Грибоедов"),
    ("Դալարիկ", "Dalarik", "Даларик"),
    ("Դաշտ", "Dasht", "Дашт"),
    ("Դողս", "Doghs", "Догс"),
    ("Եղեգնուտ", "Yeghegnut", "Егегнут"),
    ("Երասխահուն", "Yeraskhahun", "Ерасхаун"),
    ("Երվանդաշատ", "Yervandashat", "Ервандашат"),
    ("Զարթոնք", "Zartonk", "Зартонк"),
    ("Ժդանով", "Zhdanov", "Жданов"),
    ("Լենուղի", "Lenughi", "Ленуги"),
    ("Լեռնագոգ", "Lernagog", "Лернагог"),
    ("Լեռնամերձ", "Lernamerdz", "Лернамердз"),
    ("Լուկաշին", "Lukashin", "Лукашин"),
    ("Լուսագյուղ", "Lusagyugh", "Лусагюх"),
    ("Խանջյան", "Khandjyan", "Ханджян"),
    ("Խորոնք", "Khoronk", "Хоронк"),
    ("Ծաղկալանջ", "Tsaghkalandj", "Цахкаландж"),
    ("Ծաղկունք", "Tsaghkunk", "Цахкунк"),
    ("Ծիածան", "Tsiatsan", "Циацан"),
    ("Կողբավան", "Koghbavan", "Когбаван"),
    ("Հայթաղ", "Haytagh", "Айтаг"),
    ("Հայկաշեն", "Haykashen", "Айкашен"),
    ("Հայկավան", "Haykavan", "Айкаван"),
    ("Հացիկ", "Hatsik", "Ацик"),
    ("Հոկտեմբեր", "Hoktember", "Октембер"),
    ("Հովտամեջ", "Hovtamech", "Овтамеч"),
    ("Հուշակերտ", "Hushakert", "Ушакерт"),
    ("Ձերժինսկի", "Dzerzhinsky", "Дзержинский"),
    ("Մարգարա", "Margara", "Маргара"),
    ("Մեծամոր", "Metsamor", "Мецамор"),
    ("Մերձավան", "Merdzavan", "Мердзаван"),
    ("Մյասնիկյան", "Myasnikyan", "Мясникян"),
    ("Մրգաշատ", "Mrgashat", "Мргашат"),
    ("Մրգաստան", "Mrgastan", "Мргастан"),
    ("Մուսալեռ", "Musaler", "Мусалер"),
    ("Նալբանդյան", "Nalbandyan", "Налбандян"),
    ("Նոր Արմավիր", "Nor Armavir", "Нор Армавир"),
    ("Նոր Արտագես", "Nor Artages", "Нор Артагес"),
    ("Նոր Կեսարիա", "Nor Kesaria", "Нор Кесария"),
    ("Նորակերտ", "Norakert", "Норакерт"),
    ("Նորապատ", "Norapat", "Норапат"),
    ("Նորավան", "Noravan", "Нораван"),
    ("Շահումյան", "Shahumyan", "Шаумян"),
    ("Շենավան", "Shenavan", "Шенаван"),
    ("Շենիկ", "Shenik", "Шеник"),
    ("Ոսկեհատ", "Voskehat", "Воскеат"),
    ("Փթղունք", "Ptghunk", "Птгунк"),
    ("Ջանֆիդա", "Janfida", "Джанфида"),
    ("Ջրաշեն", "Jrashen", "Джрашен"),
    ("Ջրառատ", "Jrarat", "Джрарат"),
    ("Սամաղար", "Samaghar", "Самагар"),
    ("Սովետական", "Sovetakan", "Советакан"),
    ("Վանանդ", "Vanand", "Вананд"),
    ("Վարդանաշեն", "Vardanashen", "Варданашен"),
    ("Թալվորիկ", "Talvorik", "Талворик"),
    ("Տանձուտ", "Tandzut", "Тандзут"),
    ("Տարոնիկ", "Taronik", "Тароник"),
    ("Փարաքար", "Parakar", "Паракар"),
    ("Թաիրով", "Tairov", "Таиров"),
    ("Փշատավան", "Pshatavan", "Пшатаван"),
    ("Կարակերտ", "Karakert", "Каракерт"),
    ("Ֆերիկ", "Ferik", "Ферик"),
]


def combined(rows: list[tuple[str, str, str]]) -> list[str]:
    """Build the 'hy / en / ru' dropdown labels stored as a field's options."""
    return [f"{hy} / {en} / {ru}" for hy, en, ru in rows]
