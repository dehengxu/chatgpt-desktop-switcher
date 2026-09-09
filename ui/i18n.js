const STORAGE_KEY = "switcher-locale";
const FALLBACK_LOCALE = "en";
const SUPPORTED_LOCALES = ["ja", "en"];

const dictionaries = new Map();
let currentLocale = FALLBACK_LOCALE;

function detectLocale() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && SUPPORTED_LOCALES.includes(stored)) {
    return stored;
  }
  const language = (navigator.language || "").toLowerCase();
  if (language.startsWith("ja")) {
    return "ja";
  }
  return FALLBACK_LOCALE;
}

async function loadDictionary(locale) {
  const response = await fetch(`./locales/${locale}.json`);
  if (!response.ok) {
    throw new Error(`failed to load locales/${locale}.json`);
  }
  return response.json();
}

export async function initI18n() {
  for (const locale of new Set([detectLocale(), FALLBACK_LOCALE])) {
    dictionaries.set(locale, await loadDictionary(locale));
  }
  currentLocale = detectLocale();
  applyTranslations();
}

export function getLocale() {
  return currentLocale;
}

export function t(key, params = {}) {
  const text =
    dictionaries.get(currentLocale)?.[key] ??
    dictionaries.get(FALLBACK_LOCALE)?.[key] ??
    key;
  return text.replace(/\{(\w+)\}/g, (token, name) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : token,
  );
}

export function applyTranslations() {
  document.documentElement.lang = currentLocale;
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  }
}

export async function setLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    return;
  }
  if (!dictionaries.has(locale)) {
    dictionaries.set(locale, await loadDictionary(locale));
  }
  currentLocale = locale;
  window.localStorage.setItem(STORAGE_KEY, locale);
  applyTranslations();
}

export async function toggleLocale() {
  await setLocale(currentLocale === "ja" ? "en" : "ja");
}
