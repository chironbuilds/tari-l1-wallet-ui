import { Languages } from "lucide-react";
import { LANGUAGE_LABELS, useI18n, type Language } from "../i18n";
import { Segmented } from "./ui";

/** English / 中文 picker. Compact form for the Welcome and Lock screens; the Settings card uses the full one. */
export function LanguageSwitch({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { language, setLanguage, t } = useI18n();
  const options = (Object.keys(LANGUAGE_LABELS) as Language[]).map((l) => ({ value: l, label: LANGUAGE_LABELS[l] }));
  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ""}`} aria-label={t("common.language")}>
        <Languages size={14} className="text-[var(--tari-text-dim)]" />
        <Segmented value={language} onChange={(v) => setLanguage(v as Language)} options={options} />
      </div>
    );
  }
  return <Segmented value={language} onChange={(v) => setLanguage(v as Language)} options={options} className={className} fill />;
}
