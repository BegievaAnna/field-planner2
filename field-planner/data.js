window.PLANNER_DATA = {
  works: {
    green: "Обследование зелёной зоны",
    water: "Наблюдение у водоёма",
    ice: "Исследование водоёма в зимний период"
  },

  cities: {
    moscow: {
      name: "Зелёная зона (Москва)",
      shortName: "Москва",
      lat: 55.7558,
      lon: 37.6173,
      background: "https://i.pinimg.com/originals/92/87/49/9287493411259429783cecf93327e994.jpg"
    },
    spb: {
      name: "Зелёная зона (Санкт-Петербург)",
      shortName: "Санкт-Петербург",
      lat: 59.9343,
      lon: 30.3351,
      background: "https://35photo.pro/photos_temp/sizes/2421/12106088_1500n.jpg"
    }
  },

  sources: {
    S1: {
      organization: "МЧС России",
      material: "Памятка сборщикам дикоросов (о полевых работах)",
      url: "https://kamenrai.gosuslugi.ru/",
      checked: "2026-11-13"
    },
    S2: {
      organization: "МЧС России",
      material: "Правила безопасного поведения у воды",
      url: "https://adm-gorpos.ru/",
      checked: "2026-11-13"
    },
    S3: {
      organization: "МЧС России",
      material: "Памятка о безопасности на льду (тонкий лёд, провал под лёд)",
      url: "https://23.mchs.gov.ru/deyatelnost/press-centr/novosti/5464366",
      checked: "2026-11-13"
    },
    S4: {
      organization: "МЧС России",
      material: "Правила поведения в гололёд",
      url: "https://45.mchs.gov.ru/deyatelnost/press-centr/novosti/5698248",
      checked: "2026-11-13"
    }
  },

  checklist: [
    {
      id: "preparation-1",
      text: "Предупредите родных о маршруте и планируемом времени возвращения.",
      works: ["green", "water", "ice"],
      condition: null,
      source: "S1"
    },
    {
      id: "water-1",
      text: "Не заходите в воду; у обрывистых и подмытых берегов будьте особенно осторожны.",
      works: ["water"],
      condition: null,
      source: "S2"
    },
    {
      id: "near-water-1",
      text: "При наличии водоёма имейте при себе аптечку, фонарик и средство связи.",
      works: ["green", "water"],
      condition: "nearWater",
      source: "S2"
    },
    {
      id: "weather-1",
      text: "Уточните прогноз погоды перед выездом.",
      works: ["green", "water", "ice"],
      condition: null,
      source: "S1"
    },
    {
      id: "ice-1",
      text: "Не выходите на лёд без необходимости: прогулка и фото стоят меньше, чем здоровье и жизнь.",
      works: ["ice"],
      condition: null,
      source: "S3"
    },
    {
      id: "ice-2",
      text: "Обращайте внимание на цвет и структуру льда: серый, матовый, с пузырями, трещинами или водой сверху — опасен.",
      works: ["ice"],
      condition: null,
      source: "S3"
    },
    {
      id: "ice-3",
      text: "Если лёд начал трещать — ложитесь и ползите назад, резкие движения увеличивают риск.",
      works: ["ice"],
      condition: null,
      source: "S3"
    },
    {
      id: "ice-4",
      text: "Если провалились — не паникуйте, опирайтесь на край льда, широко разводите руки, выбирайтесь перекатом.",
      works: ["ice"],
      condition: null,
      source: "S3"
    },
    {
      id: "ice-5",
      text: "Рюкзак или сумку держите так, чтобы можно было быстро сбросить.",
      works: ["ice"],
      condition: null,
      source: "S3"
    },
    {
      id: "ice-6",
      text: "Возьмите заряженный телефон в водонепроницаемом чехле; номер 112 должен быть известен.",
      works: ["ice"],
      condition: null,
      source: "S3"
    },
    {
      id: "ice-slip-1",
      text: "Выбирайте обувь без каблуков, на нескользящей подошве.",
      works: ["ice"],
      condition: null,
      source: "S4"
    },
    {
      id: "ice-slip-2",
      text: "Передвигайтесь осторожно, не торопясь, наступая на всю подошву; руки свободны.",
      works: ["ice"],
      condition: null,
      source: "S4"
    },
    {
      id: "ice-slip-3",
      text: "Не держите руки в карманах — это поможет удержать равновесие на гололёде.",
      works: ["ice"],
      condition: null,
      source: "S4"
    }
  ]
};