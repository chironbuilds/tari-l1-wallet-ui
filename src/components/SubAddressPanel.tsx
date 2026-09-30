import { useState } from "react";
import { Plus, Tag, Trash2 } from "lucide-react";
import { useStore } from "../store";
import { AddressQr } from "./Dashboard";
import {
  MAX_LABEL_BYTES,
  checkLabel,
  describeLabelProblem,
  type SubAddress,
} from "../lib/subaddress";
import { copyText, truncMiddle } from "../lib/format";
import { useToast } from "./toast";
import { Button, EmptyState, Field, TextInput } from "./ui";
import { useI18n } from "../i18n";

/**
 * Sub-addresses: one wallet, many addresses to be paid on.
 *
 * Each is this wallet's address with a label attached as its payment id. The keys never change,
 * so every sub-address is received and spent by the same wallet — the label exists so an incoming
 * payment can be attributed to whoever you handed that address to. A sending wallet copies the
 * label into the transaction's memo, and the scanner reads it back off the recovered output.
 */
export function SubAddressPanel() {
  const { t } = useI18n();
  const store = useStore();
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [showing, setShowing] = useState<SubAddress | null>(null);

  const problem = label.trim() ? checkLabel(label, store.subAddresses) : null;

  function create() {
    const trouble = checkLabel(label, store.subAddresses);
    if (trouble) {
      toast({ tone: "error", title: t("sub.badName"), message: describeLabelProblem(trouble) });
      return;
    }
    const error = store.addSubAddress(label);
    if (error) {
      toast({ tone: "error", title: t("sub.createFailed"), message: error });
      return;
    }
    toast({ tone: "success", title: t("sub.created"), message: label.trim() });
    setLabel("");
  }

  if (showing) {
    return (
      <div>
        <h2 className="mb-1 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#06C983] to-[#168552]">
            <Tag size={15} />
          </span>
          {showing.label}
        </h2>
        <p className="mb-5 text-xs text-zinc-500">
          {t("sub.showingIntro")}
        </p>

        <div className="flex justify-center">
          <AddressQr value={showing.base58} />
        </div>

        <p className="mt-5 rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] p-4 font-mono text-[11px] break-all text-zinc-400">
          {showing.base58}
        </p>

        <div className="mt-4 flex gap-2.5">
          <Button
            className="flex-1"
            onClick={() =>
              void copyText(showing.base58).then(
                (ok) => ok && toast({ tone: "success", title: t("sub.addressCopied") }),
              )
            }
          >
            {t("sub.copyAddress")}
          </Button>
          <Button variant="outline" onClick={() => setShowing(null)}>
            {t("sub.back")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-1 flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
        <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#06C983] to-[#168552]">
          <Tag size={15} />
        </span>
        {t("sub.title")}
      </h2>
      <p className="mb-5 text-xs leading-relaxed text-zinc-500">
        {t("sub.intro")}
      </p>

      <Field
        label={t("sub.name")}
        hint={problem ? describeLabelProblem(problem) : t("sub.nameHint", { max: MAX_LABEL_BYTES })}
      >
        <div className="flex gap-2.5">
          <TextInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("sub.namePlaceholder")}
            spellCheck={false}
            error={!!problem}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !problem) create();
            }}
          />
          <Button disabled={!label.trim() || !!problem} onClick={create}>
            <Plus size={15} /> {t("sub.create")}
          </Button>
        </div>
      </Field>

      <div className="mt-5">
        {store.subAddresses.length === 0 ? (
          <EmptyState
            icon={<Tag size={20} />}
            title={t("sub.emptyTitle")}
            sub={t("sub.emptySub")}
          />
        ) : (
          <div className="space-y-2.5">
            {store.subAddresses.map((sub) => (
              <div
                key={sub.label}
                className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--tari-border)] bg-[var(--tari-bg-input)] px-4 py-3"
              >
                <button className="min-w-0 flex-1 text-left" onClick={() => setShowing(sub)}>
                  <p className="truncate text-sm font-bold text-[var(--tari-text)]">{sub.label}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">
                    {truncMiddle(sub.base58, 14, 10)}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setShowing(sub)}>
                    {t("sub.show")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("sub.forgetAria", { label: sub.label })}
                    onClick={() => {
                      store.removeSubAddress(sub.label);
                      toast({
                        tone: "info",
                        title: t("sub.forgotten"),
                        message: t("sub.forgottenNote"),
                      });
                    }}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="mt-5 text-[11px] leading-relaxed text-zinc-500">
        {t("sub.footer")}
      </p>
    </div>
  );
}
