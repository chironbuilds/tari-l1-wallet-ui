// Interface language (English / 中文).
//
// `en.ts` is the source of truth. `zh.ts` is typed against its exact shape, so a string added to
// English and not translated is a compile error, not a silent fallback. Keys are "section.key".
//
// Components read strings through `useI18n()`, which subscribes them to the language, so switching
// it re-renders them in place (an open panel stays open). Code outside components (store messages,
// status helpers) calls the plain `t()`, which reads the same current language; it's always called
// from a component render or handler, so it picks up the switch on that component's next render.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import en, { type TranslationTree } from "./en";
import zh from "./zh";

export type Language = "en" | "zh";

export const LANGUAGE_LABELS: Record<Language, string> = { en: "English", zh: "中文" };

export type Dictionary = { [S in keyof TranslationTree]: { [K in keyof TranslationTree[S]]: string } };

const DICTIONARIES: Record<Language, Dictionary> = { en, zh };

export type TranslationKey = {
  [S in keyof TranslationTree]: `${S & string}.${keyof TranslationTree[S] & string}`;
}[keyof TranslationTree];

const STORAGE_KEY = "tari-l1-wallet:language";

function initialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    /* storage unavailable (private mode) */
  }
  return typeof navigator !== "undefined" && /^zh\b/i.test(navigator.language) ? "zh" : "en";
}

let currentLanguage: Language = initialLanguage();

export function getLanguage(): Language {
  return currentLanguage;
}

/** `key` in the current language, with `{name}` placeholders filled from `vars`. */
export function t(key: TranslationKey, vars?: Record<string, string | number | bigint>): string {
  const [section, leaf] = key.split(".") as [keyof TranslationTree, string];
  const pick = (d: Dictionary) => (d[section] as Record<string, string> | undefined)?.[leaf];
  const template = pick(DICTIONARIES[currentLanguage]) ?? pick(en) ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

interface I18n {
  language: Language;
  setLanguage: (language: Language) => void;
  t: typeof t;
}

const I18nContext = createContext<I18n>({ language: currentLanguage, setLanguage: () => undefined, t });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(currentLanguage);
  const setLanguage = useCallback((next: Language) => {
    currentLanguage = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable: the choice lasts for this session */
    }
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
    setLanguageState(next);
  }, []);
  // A fresh `t` per language, so components that memoise on it recompute after a switch.
  const value = useMemo<I18n>(() => ({ language, setLanguage, t: (k, v) => t(k, v) }), [language, setLanguage]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
