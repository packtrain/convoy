import * as chrono from "chrono-node"
import { format, isBefore, parse, startOfDay } from "date-fns"
import { enGB, enUS, de, fr, es, it, pt, nl, ru, ja, zhCN } from "date-fns/locale"

export type DateTimeLocale = "en-US" | "en-GB" | "de" | "fr" | "es" | "it" | "pt" | "nl" | "ru" | "ja" | "zh" | "auto"

const dateFnsLocaleMap: Record<string, typeof enUS> = {
  "en-US": enUS,
  "en-GB": enGB,
  de: de,
  fr: fr,
  es: es,
  it: it,
  pt: pt,
  nl: nl,
  ru: ru,
  ja: ja,
  zh: zhCN,
}

/**
 * Get date-fns locale based on browser settings or explicit locale
 */
function getDateFnsLocale(localeOverride?: DateTimeLocale) {
  if (localeOverride && localeOverride !== "auto") {
    return dateFnsLocaleMap[localeOverride] || enUS
  }

  if (typeof navigator === "undefined") {
    return enUS
  }

  const locale = navigator.language.toLowerCase()
  const lang = locale.split("-")[0]
  const region = locale.split("-")[1]
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  // For English, check if European timezone
  if (lang === "en") {
    const isEuropeanTz = tz && (tz.startsWith("Europe/") || tz.startsWith("Africa/"))
    if ((region && region !== "us") || isEuropeanTz) {
      return enGB
    }
    return enUS
  }

  return dateFnsLocaleMap[lang] || enUS
}

export function generateDateString(
  date: Date,
  mode: "date" | "datetime" = "datetime",
  locale?: DateTimeLocale,
  customFormat?: string
) {
  const dateFnsLocale = getDateFnsLocale(locale)
  // Use custom format if provided, otherwise use locale-appropriate default
  const dateFormat = customFormat
    ?? (mode === "date" ? "d MMM yyyy" : "d MMM yyyy, hh:mm a")
  return format(date, dateFormat, { locale: dateFnsLocale })
}

export function generateDateTriggerString(
  date: Date,
  mode: "date" | "datetime" = "datetime",
  locale?: DateTimeLocale
) {
  const now = new Date()
  const isCurrentYear = date.getFullYear() === now.getFullYear()

  if (mode === "date") {
    return generateDateString(date, mode, locale, isCurrentYear ? "d MMM" : "d MMM yyyy")
  }

  return generateDateString(date, mode, locale, isCurrentYear ? "d MMM, p" : "d MMM yyyy, p")
}

export function isDateOverdue(date: Date, now = new Date()) {
  return isBefore(startOfDay(date), startOfDay(now))
}

/**
 * Get the chrono parser based on browser locale or explicit locale override.
 */
function getChronoParser(localeOverride?: DateTimeLocale) {
  // Handle explicit locale override
  if (localeOverride && localeOverride !== "auto") {
    switch (localeOverride) {
      case "en-US":
        return chrono
      case "en-GB":
        return chrono.en.GB
      case "de":
        return chrono.de
      case "fr":
        return chrono.fr
      case "nl":
        return chrono.nl
      case "pt":
        return chrono.pt
      case "ru":
        return chrono.ru
      case "ja":
        return chrono.ja
      case "zh":
        return chrono.zh
      // For locales without native parser, use GB (DD/MM/YYYY)
      case "es":
      case "it":
        return chrono.en.GB
      default:
        return chrono
    }
  }

  if (typeof navigator === "undefined") {
    return chrono
  }

  const locale = navigator.language.toLowerCase()
  const lang = locale.split("-")[0]
  const region = locale.split("-")[1]
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  // For English speakers in European timezones, use British English (DD/MM/YYYY)
  if (lang === "en") {
    const isEuropeanTz = tz && (tz.startsWith("Europe/") || tz.startsWith("Africa/"))
    if ((region && region !== "us") || isEuropeanTz) {
      return chrono.en.GB
    }
  }

  // Non-English European locales - use their native parser if available
  switch (lang) {
    case "de":
      return chrono.de
    case "fr":
      return chrono.fr
    case "nl":
      return chrono.nl
    case "pt":
      return chrono.pt
    case "ru":
      return chrono.ru
    case "ja":
      return chrono.ja
    case "zh":
      return chrono.zh
  }

  // European languages without native parser - use GB (English with DD/MM/YYYY)
  const euroLocales = ["pl", "it", "es", "cs", "sk", "hu", "ro", "bg", "hr", "sl", "sr", "uk"]
  if (euroLocales.includes(lang)) {
    return chrono.en.GB
  }

  // Default to English (US) parser
  return chrono
}

export function generateDate(dateStr: string, locale?: DateTimeLocale) {
  const parser = getChronoParser(locale)

  // Normalize dot-separated dates (12.02.2023) to slash format (12/02/2023)
  const dotDatePattern = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/
  const normalizedStr = dateStr.replace(dotDatePattern, "$1/$2/$3")

  return parser.parseDate(normalizedStr)
}

// Matches "12 Feb 2023, 10:30 AM" format
const dateTimeFormatRegex =
  /^([1-9]|[12]\d|3[01])\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{4},\s(0\d|1[0-2]):([0-5]\d)\s(AM|PM)$/

// Matches "12 Feb 2023" format
const dateOnlyFormatRegex =
  /^([1-9]|[12]\d|3[01])\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{4}$/

export function isValidDateFormat(
  dateString: string,
  mode: "date" | "datetime" = "datetime",
  customFormat?: string
) {
  // When a custom format is provided, try to parse the string with date-fns
  if (customFormat) {
    try {
      const parsed = parse(dateString, customFormat, new Date())
      return !isNaN(parsed.getTime())
    } catch {
      return false
    }
  }

  // Fall back to regex validation for default formats
  return mode === "date"
    ? dateOnlyFormatRegex.test(dateString)
    : dateTimeFormatRegex.test(dateString)
}
