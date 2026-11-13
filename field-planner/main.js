(function () {
  "use strict";

  const STORAGE_KEY = "planner.plans.v1";
  const PLAN_ID_PREFIX = "plan_";
  const THEME_KEY = "planner.theme.v1";

  // ── Состояние API ──
  const API_BASE = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
  const API_TIMEOUT_MS = 15000;

  let isFetching = false;
  let apiAbortController = null;
  let currentCityKey = "moscow";

  // ── Состояние планировщика ──
  let currentPlanId = null;
  let lastSavedSnapshot = null;
  let savedPlans = [];
  let storageParseError = null;
  let rawCorruptedData = null;
  let successTimerId = null;

  let checkStates = {};
  let formState = {
    title: "",
    city: "moscow",
    date: "",
    workType: "green",
    nearWater: false
  };

  // ── DOM-элементы ──
  const form = document.getElementById("planForm");
  const titleInput = document.getElementById("planTitle");
  const placeSelect = document.getElementById("planPlace");
  const dateInput = document.getElementById("planDate");
  const workTypeSelect = document.getElementById("workType");
  const nearWaterCheckbox = document.getElementById("nearWater");
  const newPlanBtn = document.getElementById("newPlanBtn");
  const printPlanBtn = document.getElementById("printPlanBtn");
  const formError = document.getElementById("formError");
  const checklistEl = document.getElementById("checklist");
  const summaryEl = document.getElementById("summaryContent");
  const currentPlanCard = document.getElementById("currentPlanCard");
  const currentPlanContent = document.getElementById("currentPlanContent");
  const sourcesList = document.getElementById("sourcesList");
  const plansListEl = document.getElementById("plansList");
  const plansListMessage = document.getElementById("plansListMessage");
  const plansCount = document.getElementById("plansCount");
  const printReport = document.getElementById("printReport");

  const refreshWeatherBtn = document.getElementById("refreshWeatherBtn");
  const weatherStatus = document.getElementById("weatherStatus");
  const weatherTemp = document.getElementById("weatherTemp");
  const weatherWind = document.getElementById("weatherWind");
  const weatherHumidity = document.getElementById("weatherHumidity");
  const weatherDataTime = document.getElementById("weatherDataTime");
  const weatherLoadTime = document.getElementById("weatherLoadTime");
  const monitoringPlaceName = document.getElementById("monitoringPlaceName");
  const monitoringCoords = document.getElementById("monitoringCoords");
  const monitoringCard = document.getElementById("monitoringSection");

  const htmlEl = document.documentElement;
  const themeToggleBtn = document.getElementById("themeToggle");

  function init() {
    initTheme();
    loadPlansFromStorage();
    renderSources();
    bindPlannerEvents();
    bindWeatherEvents();
    bindPrintEvents();
    bindThemeEvents();
    syncFormStateFromDOM();
    renderChecklist();
    updateSummary();
    renderPlansList();
    renderCurrentPlan();
    applyCity(currentCityKey);
    fetchWeather();
  }

  function bindPlannerEvents() {
    form.addEventListener("submit", handleSubmit);
    form.addEventListener("input", handleFormChange);
    form.addEventListener("change", handleFormChange);
    newPlanBtn.addEventListener("click", handleNewPlan);
    printPlanBtn.addEventListener("click", handlePrintPlan);
  }

  function bindWeatherEvents() {
    refreshWeatherBtn.addEventListener("click", function () {
      fetchWeather();
    });
  }

  function bindPrintEvents() {
    window.addEventListener("afterprint", function () {
      document.body.classList.remove("print-mode");
    });
  }

  function bindThemeEvents() {
    if (!themeToggleBtn) return;
    themeToggleBtn.addEventListener("click", function () {
      const current = htmlEl.getAttribute("data-theme") || "light";
      applyTheme(current === "dark" ? "light" : "dark");
    });
  }

  // ── Тема ──
  function applyTheme(theme) {
    htmlEl.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) { /* ignore */ }
    const icon = themeToggleBtn ? themeToggleBtn.querySelector(".theme-icon") : null;
    if (icon) icon.textContent = theme === "dark" ? "☀️" : "🌙";
    if (themeToggleBtn) {
      themeToggleBtn.setAttribute(
        "aria-label",
        theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"
      );
    }
  }

  function initTheme() {
    let saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch (e) {
      saved = null;
    }
    let theme;
    if (saved === "light" || saved === "dark") {
      theme = saved;
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      theme = "dark";
    } else {
      theme = "light";
    }
    applyTheme(theme);
  }

  // ── Город ──
  function applyCity(cityKey) {
    const data = window.PLANNER_DATA;
    if (!data || !data.cities[cityKey]) return;
    const city = data.cities[cityKey];
    currentCityKey = cityKey;

    if (monitoringPlaceName) monitoringPlaceName.textContent = city.shortName;
    if (monitoringCoords) monitoringCoords.textContent = city.lat + ", " + city.lon;

    if (monitoringCard && city.background) {
      monitoringCard.style.setProperty("--monitoring-bg", "url('" + city.background + "')");
    }
  }

  // ── Мониторинг ──
  function setWeatherStatus(text, type) {
    if (!weatherStatus) return;
    if (!text) {
      weatherStatus.hidden = true;
      weatherStatus.className = "weather-status";
      weatherStatus.textContent = "";
      return;
    }
    weatherStatus.hidden = false;
    weatherStatus.className = "weather-status is-" + type;
    weatherStatus.textContent = text;
  }

  function clearWeatherValues() {
    if (weatherTemp) weatherTemp.textContent = "—";
    if (weatherWind) weatherWind.textContent = "—";
    if (weatherHumidity) weatherHumidity.textContent = "—";
    if (weatherDataTime) weatherDataTime.textContent = "—";
    if (weatherLoadTime) weatherLoadTime.textContent = "—";
  }

  function formatNumberOrDash(value, unit) {
    if (value === null || value === undefined) return "—";
    const num = Number(value);
    if (Number.isNaN(num)) return "—";
    const formatted = num % 1 === 0 ? num.toString() : num.toFixed(1);
    return formatted + (unit ? " " + unit : "");
  }

  function formatIsoOrDash(iso) {
    if (!iso || typeof iso !== "string") return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function updateWeatherDisplay(data) {
    const details = data &&
      data.properties &&
      Array.isArray(data.properties.timeseries) &&
      data.properties.timeseries[0] &&
      data.properties.timeseries[0].data &&
      data.properties.timeseries[0].data.instant &&
      data.properties.timeseries[0].data.instant.details;

    if (!details) {
      clearWeatherValues();
      setWeatherStatus("Сервис вернул пустой или неожиданный ответ. Показатели недоступны.", "empty");
      return;
    }

    const temp = details.air_temperature;
    const wind = details.wind_speed;
    const humidity = details.relative_humidity;

    const tempOk = typeof temp === "number" && !Number.isNaN(temp);
    const windOk = typeof wind === "number" && !Number.isNaN(wind);
    const humidityOk = typeof humidity === "number" && !Number.isNaN(humidity);

    if (!tempOk && !windOk && !humidityOk) {
      clearWeatherValues();
      setWeatherStatus("В ответе нет ожидаемых числовых показателей. Данные не отображены.", "empty");
      return;
    }

    if (weatherTemp) weatherTemp.textContent = tempOk ? formatNumberOrDash(temp, "°C") : "—";
    if (weatherWind) weatherWind.textContent = windOk ? formatNumberOrDash(wind, "м/с") : "—";
    if (weatherHumidity) weatherHumidity.textContent = humidityOk ? formatNumberOrDash(humidity, "%") : "—";

    const metaUpdated = data.properties.meta && data.properties.meta.updated_at;
    if (weatherDataTime) weatherDataTime.textContent = metaUpdated ? formatIsoOrDash(metaUpdated) : "—";
    if (weatherLoadTime) weatherLoadTime.textContent = formatIsoOrDash(new Date().toISOString());

    setWeatherStatus(null);
  }

  async function fetchWeather() {
    if (isFetching) return;
    isFetching = true;
    refreshWeatherBtn.disabled = true;
    setWeatherStatus("Загрузка данных…", "loading");

    apiAbortController = new AbortController();
    const timeoutId = setTimeout(function () {
      if (apiAbortController) apiAbortController.abort();
    }, API_TIMEOUT_MS);

    const data = window.PLANNER_DATA;
    const city = data.cities[currentCityKey];
    if (!city) {
      clearTimeout(timeoutId);
      isFetching = false;
      refreshWeatherBtn.disabled = false;
      setWeatherStatus("Город не выбран.", "error");
      return;
    }

    try {
      const url = API_BASE + "?lat=" + city.lat + "&lon=" + city.lon;
      const response = await fetch(url, {
        headers: { "Accept": "application/json" },
        signal: apiAbortController.signal
      });

      if (!response.ok) {
        throw new Error("HTTP " + response.status + " " + response.statusText);
      }

      const payload = await response.json();
      updateWeatherDisplay(payload);
    } catch (err) {
      if (err.name === "AbortError") {
        setWeatherStatus("Превышено время ожидания (15 секунд). Проверьте сеть и нажмите «Обновить данные» ещё раз.", "error");
      } else if (err instanceof TypeError && String(err.message).toLowerCase().includes("fetch")) {
        setWeatherStatus("Не удалось выполнить запрос. Проверьте подключение к интернету. Чек-лист и сохранённые планы продолжают работать.", "error");
      } else {
        setWeatherStatus("Ошибка загрузки данных: " + (err.message || "неизвестная ошибка") + ". Чек-лист и сохранённые планы не затронуты.", "error");
      }
    } finally {
      clearTimeout(timeoutId);
      apiAbortController = null;
      isFetching = false;
      refreshWeatherBtn.disabled = false;
    }
  }

  // ── Печать ──
  function handlePrintPlan() {
    if (!validateForm()) return;
    syncFormStateFromDOM();
    buildPrintReport();
    document.body.classList.add("print-mode");
    window.print();
    setTimeout(function () {
      document.body.classList.remove("print-mode");
    }, 1000);
  }

  function buildPrintReport() {
    const data = window.PLANNER_DATA;
    if (!data || !printReport) return;

    const title = titleInput.value.trim();
    const cityKey = placeSelect.value;
    const city = data.cities[cityKey];
    const place = city ? city.name : cityKey;
    const date = dateInput.value;
    const workType = workTypeSelect.value;
    const workLabel = data.works[workType] || workType;
    const nearWater = nearWaterCheckbox.checked;

    const applicablePoints = data.checklist.filter(isPointApplicable);
    const donePoints = applicablePoints.filter(function (p) { return checkStates[p.id]; });
    const remainingPoints = applicablePoints.filter(function (p) { return !checkStates[p.id]; });

    printReport.innerHTML = "";

    const h1 = document.createElement("h1");
    h1.textContent = "План выездных работ";
    printReport.appendChild(h1);

    const note = document.createElement("p");
    note.className = "print-muted";
    note.textContent = "Отчёт сформирован по текущему состоянию формы и чек-листа на момент печати. Время сохранения плана не связано со временем запроса к API.";
    printReport.appendChild(note);

    addPrintSection(printReport, "Параметры плана", function (wrap) {
      addPrintField(wrap, "Название", title);
      addPrintField(wrap, "Место", place);
      addPrintField(wrap, "Дата", date);
      addPrintField(wrap, "Вид работ", workLabel);
      addPrintField(wrap, "Рядом есть водоём", nearWater ? "да" : "нет");
    });

    addPrintSection(printReport, "Чек-лист подготовки", function (wrap) {
      const doneH = document.createElement("h3");
      doneH.textContent = "Выполнено: " + donePoints.length + " из " + applicablePoints.length;
      wrap.appendChild(doneH);

      if (donePoints.length === 0) {
        const p = document.createElement("p");
        p.textContent = "Нет выполненных пунктов.";
        wrap.appendChild(p);
      } else {
        const ul = document.createElement("ul");
        donePoints.forEach(function (p) {
          ul.appendChild(makePrintChecklistItem(p, true));
        });
        wrap.appendChild(ul);
      }

      const remH = document.createElement("h3");
      remH.textContent = "Осталось: " + remainingPoints.length;
      wrap.appendChild(remH);

      if (remainingPoints.length === 0) {
        const p = document.createElement("p");
        p.textContent = "Все применимые пункты отмечены.";
        wrap.appendChild(p);
      } else {
        const ul = document.createElement("ul");
        remainingPoints.forEach(function (p) {
          ul.appendChild(makePrintChecklistItem(p, false));
        });
        wrap.appendChild(ul);
      }
    });

    addPrintSection(printReport, "Текущие погодные данные (не прогноз)", function (wrap) {
      const city = data.cities[cityKey];
      const p1 = document.createElement("p");
      p1.textContent = "Место: " + (city ? city.shortName : cityKey) + " (" + (city ? city.lat + ", " + city.lon : "") + "). Источник: MET Norway Locationforecast 2.0.";
      wrap.appendChild(p1);

      const tempText = weatherTemp ? weatherTemp.textContent.trim() : "—";
      const windText = weatherWind ? weatherWind.textContent.trim() : "—";
      const humText = weatherHumidity ? weatherHumidity.textContent.trim() : "—";
      const dataTimeText = weatherDataTime ? weatherDataTime.textContent.trim() : "—";
      const loadTimeText = weatherLoadTime ? weatherLoadTime.textContent.trim() : "—";

      const hasAny = tempText !== "—" || windText !== "—" || humText !== "—";

      if (!hasAny) {
        const none = document.createElement("p");
        none.textContent = "Данные API отсутствуют или ещё не загружены.";
        wrap.appendChild(none);
      } else {
        const ul = document.createElement("ul");
        ul.appendChild(makePrintLine("Температура", tempText));
        ul.appendChild(makePrintLine("Ветер", windText));
        ul.appendChild(makePrintLine("Влажность", humText));
        wrap.appendChild(ul);

        const dt = document.createElement("p");
        dt.textContent = "Время данных API: " + (dataTimeText === "—" ? "не указано" : dataTimeText);
        wrap.appendChild(dt);

        const lt = document.createElement("p");
        lt.textContent = "Время загрузки данных: " + (loadTimeText === "—" ? "не указано" : loadTimeText);
        wrap.appendChild(lt);
      }

      const warn = document.createElement("p");
      warn.className = "print-warning";
      warn.textContent = "Это текущие данные, а не прогноз на выбранную дату выезда. Сведения API имеют своё время и место.";
      wrap.appendChild(warn);
    });

    addPrintSection(printReport, "Источники", function (wrap) {
      const dl = document.createElement("dl");
      Object.keys(data.sources).forEach(function (key) {
        const source = data.sources[key];

        const dt = document.createElement("dt");
        dt.textContent = "Источник " + key + " — " + source.organization;
        dl.appendChild(dt);

        const dd = document.createElement("dd");

        const mat = document.createElement("div");
        mat.textContent = source.material;
        dd.appendChild(mat);

        const link = document.createElement("a");
        link.href = source.url;
        link.textContent = source.url;
        dd.appendChild(link);

        const checked = document.createElement("div");
        checked.className = "print-muted";
        checked.textContent = "Проверено: " + source.checked;
        dd.appendChild(checked);

        dl.appendChild(dd);
      });
      wrap.appendChild(dl);
    });

    addPrintSection(printReport, "Ограничения", function (wrap) {
      const p = document.createElement("p");
      p.className = "print-warning";
      p.textContent = "Учебный инструмент подготовки, не разрешение на проведение работ. Количество отмеченных пунктов не означает, что работы безопасны. Текущие сведения API не являются прогнозом на дату выезда. Планы сохраняются только в этом браузере.";
      wrap.appendChild(p);
    });
  }

  function addPrintSection(container, heading, fillFn) {
    const section = document.createElement("section");
    section.className = "print-section";
    const h2 = document.createElement("h2");
    h2.textContent = heading;
    section.appendChild(h2);
    fillFn(section);
    container.appendChild(section);
  }

  function addPrintField(wrap, label, value) {
    const p = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = label + ": ";
    p.appendChild(strong);
    p.appendChild(document.createTextNode(value));
    wrap.appendChild(p);
  }

  function makePrintChecklistItem(point, done) {
    const li = document.createElement("li");
    li.className = "print-checklist-item";
    li.textContent = (done ? "✓ " : "— ") + point.text;
    const src = document.createElement("span");
    src.className = "print-muted";
    src.textContent = " (источник " + point.source + ")";
    li.appendChild(src);
    return li;
  }

  function makePrintLine(label, value) {
    const li = document.createElement("li");
    const strong = document.createElement("strong");
    strong.textContent = label + ": ";
    li.appendChild(strong);
    li.appendChild(document.createTextNode(value === "—" ? "нет данных" : value));
    return li;
  }

  // ── Планировщик ──
  function isValidPlan(obj) {
    if (!obj || typeof obj !== "object") return false;
    if (typeof obj.id !== "string" || !obj.id) return false;
    if (typeof obj.title !== "string" || !obj.title.trim()) return false;
    if (typeof obj.city !== "string") return false;
    const data = window.PLANNER_DATA;
    if (!data || !data.cities[obj.city]) return false;
    if (typeof obj.date !== "string") return false;
    if (!data.works[obj.workType]) return false;
    if (typeof obj.nearWater !== "boolean") return false;
    if (!obj.checkStates || typeof obj.checkStates !== "object") return false;
    const keys = Object.keys(obj.checkStates);
    for (let i = 0; i < keys.length; i++) {
      if (typeof obj.checkStates[keys[i]] !== "boolean") return false;
    }
    if (typeof obj.savedAt !== "string") return false;
    if (isNaN(Date.parse(obj.savedAt))) return false;
    return true;
  }

  function loadPlansFromStorage() {
    savedPlans = [];
    storageParseError = null;
    rawCorruptedData = null;

    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      storageParseError = "Не удалось обратиться к хранилищу браузера. Возможно, оно отключено.";
      return;
    }

    if (raw === null) return;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      storageParseError = "Сохранённые планы повреждены: не удалось разобрать данные.";
      rawCorruptedData = raw;
      return;
    }

    if (!Array.isArray(parsed)) {
      storageParseError = "Сохранённые планы повреждены: неверный формат данных.";
      rawCorruptedData = raw;
      return;
    }

    // Миграция: старые планы без city → moscow
    savedPlans = parsed.map(function (plan) {
      if (plan && typeof plan === "object" && !plan.city) {
        plan.city = "moscow";
      }
      return plan;
    });
  }

  function persistPlans() {
    if (storageParseError && rawCorruptedData !== null) {
      const ok = window.confirm(
        "В хранилище найдены повреждённые данные. Сохранение заменит их новым списком. Продолжить?"
      );
      if (!ok) return false;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedPlans));
      storageParseError = null;
      rawCorruptedData = null;
      return true;
    } catch (e) {
      showError("Не удалось сохранить данные в браузере. Возможно, хранилище переполнено или отключено.");
      return false;
    }
  }

  function getCurrentSnapshot() {
    return {
      title: titleInput.value.trim(),
      city: placeSelect.value,
      date: dateInput.value,
      workType: workTypeSelect.value,
      nearWater: nearWaterCheckbox.checked,
      checkStates: Object.assign({}, checkStates)
    };
  }

  function isEmptySnapshot(s) {
    if (s.title) return false;
    if (s.date) return false;
    if (s.nearWater) return false;
    if (s.workType !== "green") return false;
    if (s.city !== "moscow") return false;
    const keys = Object.keys(s.checkStates || {});
    for (let i = 0; i < keys.length; i++) {
      if (s.checkStates[keys[i]]) return false;
    }
    return true;
  }

  function snapshotsEqual(a, b) {
    if (!a || !b) return a === b;
    if (a.title !== b.title) return false;
    if (a.city !== b.city) return false;
    if (a.date !== b.date) return false;
    if (a.workType !== b.workType) return false;
    if (a.nearWater !== b.nearWater) return false;
    const setA = a.checkStates || {};
    const setB = b.checkStates || {};
    const keys = new Set(Object.keys(setA).concat(Object.keys(setB)));
    let equal = true;
    keys.forEach(function (k) {
      if (Boolean(setA[k]) !== Boolean(setB[k])) equal = false;
    });
    return equal;
  }

  function hasUnsavedChanges() {
    const current = getCurrentSnapshot();
    if (lastSavedSnapshot === null) {
      return !isEmptySnapshot(current);
    }
    return !snapshotsEqual(current, lastSavedSnapshot);
  }

  function confirmDiscardIfDirty(actionLabel) {
    if (!hasUnsavedChanges()) return true;
    return window.confirm(
      "Есть несохранённые изменения. " + actionLabel + " приведёт к их потере. Продолжить?"
    );
  }

  function syncFormStateFromDOM() {
    formState.title = titleInput.value;
    formState.city = placeSelect.value;
    formState.date = dateInput.value;
    formState.workType = workTypeSelect.value;
    formState.nearWater = nearWaterCheckbox.checked;
    applyCity(formState.city);
  }

  function handleFormChange() {
    syncFormStateFromDOM();
    renderChecklist();
    updateSummary();
    renderCurrentPlan();
    hideError();
  }

  function isPointApplicable(point) {
    if (point.works.indexOf(formState.workType) === -1) return false;
    if (point.condition === "nearWater" && !formState.nearWater) return false;
    return true;
  }

  function renderChecklist() {
    const data = window.PLANNER_DATA;
    if (!data) return;

    const applicablePoints = data.checklist.filter(isPointApplicable);
    checklistEl.innerHTML = "";

    applicablePoints.forEach(function (point) {
      const li = document.createElement("li");
      li.className = "checklist-item";

      const label = document.createElement("label");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.id = point.id;
      checkbox.checked = Boolean(checkStates[point.id]);

      checkbox.addEventListener("change", function () {
        checkStates[point.id] = checkbox.checked;
        updateSummary();
        renderCurrentPlan();
      });

      const textSpan = document.createElement("span");
      textSpan.textContent = point.text;

      const sourceSpan = document.createElement("span");
      sourceSpan.className = "source-ref";
      const source = data.sources[point.source];
      if (source) {
        const link = document.createElement("a");
        link.href = source.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Источник " + point.source;
        sourceSpan.appendChild(link);
        sourceSpan.appendChild(document.createTextNode(" — " + source.organization));
      } else {
        sourceSpan.textContent = "Источник " + point.source;
      }

      const textWrapper = document.createElement("span");
      textWrapper.appendChild(textSpan);
      textWrapper.appendChild(sourceSpan);

      label.appendChild(checkbox);
      label.appendChild(textWrapper);

      li.appendChild(label);
      checklistEl.appendChild(li);
    });
  }

  function updateSummary() {
    const data = window.PLANNER_DATA;
    if (!data) return;

    const applicablePoints = data.checklist.filter(isPointApplicable);
    const total = applicablePoints.length;

    let done = 0;
    applicablePoints.forEach(function (point) {
      if (checkStates[point.id]) done++;
    });

    const remaining = total - done;

    const p = document.createElement("p");
    p.textContent = "Выполнено: " + done + " из " + total + ". Осталось: " + remaining + ".";

    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = "Сводка обновляется при изменении формы, но это не означает сохранение плана.";

    summaryEl.innerHTML = "";
    summaryEl.appendChild(p);
    summaryEl.appendChild(note);

    if (total > 0) {
      const list = document.createElement("ul");
      applicablePoints.forEach(function (point) {
        const li = document.createElement("li");
        li.textContent = (checkStates[point.id] ? "✓ " : "— ") + point.text;
        list.appendChild(li);
      });
      summaryEl.appendChild(list);
    }
  }

  function validateForm() {
    const title = titleInput.value.trim();
    const date = dateInput.value;

    if (!title) {
      showError("Введите название плана (не только пробелы).");
      titleInput.focus();
      return false;
    }

    if (!date) {
      showError("Выберите дату.");
      dateInput.focus();
      return false;
    }

    hideError();
    return true;
  }

  function showError(message) {
    if (successTimerId !== null) {
      clearTimeout(successTimerId);
      successTimerId = null;
    }
    formError.className = "error";
    formError.textContent = message;
    formError.hidden = false;
  }

  function hideError() {
    formError.hidden = true;
    formError.textContent = "";
    formError.className = "error";
    if (successTimerId !== null) {
      clearTimeout(successTimerId);
      successTimerId = null;
    }
  }

  function showSaveSuccess(message) {
    hideError();
    formError.className = "success";
    formError.textContent = message;
    formError.hidden = false;
    successTimerId = setTimeout(function () {
      formError.hidden = true;
      formError.textContent = "";
      formError.className = "error";
      successTimerId = null;
    }, 3000);
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!validateForm()) return;
    saveCurrentPlan();
  }

  function saveCurrentPlan() {
    syncFormStateFromDOM();
    const snapshot = getCurrentSnapshot();
    const now = new Date().toISOString();

    if (currentPlanId === null) {
      const newPlan = {
        id: PLAN_ID_PREFIX + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
        title: snapshot.title,
        city: snapshot.city,
        date: snapshot.date,
        workType: snapshot.workType,
        nearWater: snapshot.nearWater,
        checkStates: snapshot.checkStates,
        savedAt: now
      };
      const prevPlans = savedPlans;
      savedPlans = savedPlans.concat([newPlan]);
      if (!persistPlans()) {
        savedPlans = prevPlans;
        return;
      }
      currentPlanId = newPlan.id;
      lastSavedSnapshot = snapshot;
      renderPlansList();
      renderCurrentPlan();
      showSaveSuccess("План сохранён в этом браузере.");
      return;
    }

    let idx = -1;
    for (let i = 0; i < savedPlans.length; i++) {
      if (savedPlans[i] && savedPlans[i].id === currentPlanId) {
        idx = i;
        break;
      }
    }

    if (idx === -1) {
      currentPlanId = null;
      saveCurrentPlan();
      return;
    }

    const existing = savedPlans[idx];
    const updated = Object.assign({}, existing, {
      title: snapshot.title,
      city: snapshot.city,
      date: snapshot.date,
      workType: snapshot.workType,
      nearWater: snapshot.nearWater,
      checkStates: snapshot.checkStates,
      savedAt: now
    });

    const prevPlans = savedPlans;
    const newPlans = savedPlans.slice();
    newPlans[idx] = updated;
    savedPlans = newPlans;

    if (!persistPlans()) {
      savedPlans = prevPlans;
      return;
    }

    lastSavedSnapshot = snapshot;
    renderPlansList();
    renderCurrentPlan();
    showSaveSuccess("Изменения сохранены в этом браузере.");
  }

  function handleNewPlan() {
    if (!confirmDiscardIfDirty("Создание нового плана")) return;
    resetToNewPlan();
    renderPlansList();
  }

  function resetToNewPlan() {
    form.reset();
    titleInput.value = "";
    dateInput.value = "";
    placeSelect.value = "moscow";
    workTypeSelect.value = "green";
    nearWaterCheckbox.checked = false;
    checkStates = {};
    currentPlanId = null;
    lastSavedSnapshot = null;
    hideError();
    syncFormStateFromDOM();
    renderChecklist();
    updateSummary();
    renderCurrentPlan();
    applyCity("moscow");
  }

  function handleOpenPlan(id) {
    if (!confirmDiscardIfDirty("Открытие другого плана")) return;

    let plan = null;
    for (let i = 0; i < savedPlans.length; i++) {
      if (savedPlans[i] && savedPlans[i].id === id) {
        plan = savedPlans[i];
        break;
      }
    }

    if (!plan || !isValidPlan(plan)) {
      showError("Не удалось открыть план: запись повреждена.");
      return;
    }

    titleInput.value = plan.title;
    dateInput.value = plan.date;
    placeSelect.value = plan.city;
    workTypeSelect.value = plan.workType;
    nearWaterCheckbox.checked = plan.nearWater;
    checkStates = Object.assign({}, plan.checkStates);

    currentPlanId = plan.id;
    lastSavedSnapshot = {
      title: plan.title,
      city: plan.city,
      date: plan.date,
      workType: plan.workType,
      nearWater: plan.nearWater,
      checkStates: Object.assign({}, plan.checkStates)
    };

    hideError();
    syncFormStateFromDOM();
    renderChecklist();
    updateSummary();
    renderCurrentPlan();
    renderPlansList();
    applyCity(plan.city);
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleDeletePlan(index) {
    const plan = savedPlans[index];
    if (!plan) return;

    const isCurrent = Boolean(plan.id) && plan.id === currentPlanId;
    let confirmMessage;

    if (isValidPlan(plan)) {
      const data = window.PLANNER_DATA;
      const city = data.cities[plan.city];
      const workLabel = data.works[plan.workType] || plan.workType;
      confirmMessage = "Удалить план «" + plan.title + "» (" + plan.date + ", " + (city ? city.name : plan.city) + ", " + workLabel + ")?";
      if (isCurrent && hasUnsavedChanges()) {
        confirmMessage = "Есть несохранённые изменения. " + confirmMessage;
      }
    } else {
      confirmMessage = "Удалить повреждённую запись?";
    }

    if (!window.confirm(confirmMessage)) return;

    const prevPlans = savedPlans;
    const newPlans = savedPlans.slice();
    newPlans.splice(index, 1);
    savedPlans = newPlans;

    if (!persistPlans()) {
      savedPlans = prevPlans;
      return;
    }

    if (isCurrent) {
      resetToNewPlan();
    }
    renderPlansList();
    renderCurrentPlan();
  }

  function renderPlansList() {
    plansListEl.innerHTML = "";
    plansListMessage.innerHTML = "";

    if (plansCount) {
      if (savedPlans.length > 0 && !storageParseError) {
        plansCount.hidden = false;
        plansCount.textContent = String(savedPlans.length);
      } else {
        plansCount.hidden = true;
        plansCount.textContent = "";
      }
    }

    if (storageParseError) {
      const p = document.createElement("p");
      p.className = "error";
      p.textContent = storageParseError;
      plansListMessage.appendChild(p);

      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = "Сохранение заменит повреждённые данные после подтверждения.";
      plansListMessage.appendChild(note);
      return;
    }

    if (savedPlans.length === 0) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "Пока нет сохранённых планов. Заполните форму и нажмите «Сохранить план».";
      plansListMessage.appendChild(p);
      return;
    }

    savedPlans.forEach(function (plan, index) {
      const li = document.createElement("li");
      li.className = "plan-item";

      if (isValidPlan(plan)) {
        if (plan.id === currentPlanId) li.className += " is-current";

        const info = document.createElement("div");
        info.className = "plan-info";

        const titleEl = document.createElement("div");
        titleEl.className = "plan-title";
        titleEl.textContent = plan.title;
        info.appendChild(titleEl);

        const data = window.PLANNER_DATA;
        const city = data.cities[plan.city];
        const workLabel = data.works[plan.workType] || plan.workType;
        const metaEl = document.createElement("div");
        metaEl.className = "plan-meta";
        metaEl.textContent = plan.date + " · " + (city ? city.name : plan.city) + " · " + workLabel + (plan.nearWater ? " · рядом водоём" : "");
        info.appendChild(metaEl);

        const savedEl = document.createElement("div");
        savedEl.className = "plan-saved";
        savedEl.textContent = "Сохранён: " + formatDateTime(plan.savedAt);
        info.appendChild(savedEl);

        li.appendChild(info);

        const actions = document.createElement("div");
        actions.className = "plan-actions";

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "btn-secondary";
        openBtn.textContent = "Открыть";
        openBtn.addEventListener("click", function () { handleOpenPlan(plan.id); });
        actions.appendChild(openBtn);

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn-danger";
        delBtn.textContent = "Удалить";
        delBtn.addEventListener("click", function () { handleDeletePlan(index); });
        actions.appendChild(delBtn);

        li.appendChild(actions);
      } else {
        const info = document.createElement("div");
        info.className = "plan-info";

        const titleEl = document.createElement("div");
        titleEl.className = "plan-title";
        titleEl.textContent = "Повреждённая запись";
        info.appendChild(titleEl);

        const metaEl = document.createElement("div");
        metaEl.className = "plan-meta";
        metaEl.style.color = "var(--error-text)";
        metaEl.textContent = "Запись не соответствует формату и не может быть открыта.";
        info.appendChild(metaEl);

        li.appendChild(info);

        const actions = document.createElement("div");
        actions.className = "plan-actions";

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn-danger";
        delBtn.textContent = "Удалить";
        delBtn.addEventListener("click", function () { handleDeletePlan(index); });
        actions.appendChild(delBtn);

        li.appendChild(actions);
      }

      plansListEl.appendChild(li);
    });
  }

  function formatDateTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    function pad(n) { return String(n).padStart(2, "0"); }
    return pad(d.getDate()) + "." + pad(d.getMonth() + 1) + "." + d.getFullYear() +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function renderCurrentPlan() {
    if (currentPlanId === null) {
      currentPlanCard.hidden = true;
      return;
    }

    let plan = null;
    for (let i = 0; i < savedPlans.length; i++) {
      if (savedPlans[i] && savedPlans[i].id === currentPlanId) {
        plan = savedPlans[i];
        break;
      }
    }

    if (!plan || !isValidPlan(plan)) {
      currentPlanCard.hidden = true;
      return;
    }

    const data = window.PLANNER_DATA;
    const city = data.cities[plan.city];

    currentPlanContent.innerHTML = "";
    addField("Название", plan.title);
    addField("Место", city ? city.name : plan.city);
    addField("Дата", plan.date);
    addField("Вид работ", data.works[plan.workType] || plan.workType);
    addField("Рядом водоём", plan.nearWater ? "да" : "нет");
    addField("Сохранён", formatDateTime(plan.savedAt));

    if (hasUnsavedChanges()) {
      const note = document.createElement("p");
      note.className = "hint warning";
      note.textContent = "Есть несохранённые изменения. Нажмите «Сохранить план».";
      currentPlanContent.appendChild(note);
    }

    currentPlanCard.hidden = false;
  }

  function addField(label, value) {
    const p = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = label + ": ";
    p.appendChild(strong);
    p.appendChild(document.createTextNode(value));
    currentPlanContent.appendChild(p);
  }

  function renderSources() {
    const data = window.PLANNER_DATA;
    if (!data || !data.sources) return;

    sourcesList.innerHTML = "";
    const dl = document.createElement("dl");

    Object.keys(data.sources).forEach(function (key) {
      const source = data.sources[key];

      const dt = document.createElement("dt");
      dt.textContent = "Источник " + key;
      dl.appendChild(dt);

      const dd = document.createElement("dd");

      const org = document.createElement("div");
      org.textContent = source.organization;
      dd.appendChild(org);

      const material = document.createElement("div");
      material.textContent = source.material;
      dd.appendChild(material);

      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = source.url;
      dd.appendChild(link);

      const checked = document.createElement("div");
      checked.className = "hint";
      checked.textContent = "Проверено: " + source.checked;
      dd.appendChild(checked);

      dl.appendChild(dd);
    });

    sourcesList.appendChild(dl);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();