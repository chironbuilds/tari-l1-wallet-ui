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

/**
 * Sub-addresses: one wallet, many addresses to be paid on.
 *
 * Each is this wallet's address with a label attached as its payment id. The keys never change,
 * so every sub-address is received and spent by the same wallet — the label exists so an incoming
 * payment can be attributed to whoever you handed that address to. A sending wallet copies the
 * label into the transaction's memo, and the scanner reads it back off the recovered output.
 */
export function SubAddressPanel() {
  const store = useStore();
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [showing, setShowing] = useState<SubAddress | null>(null);

  const problem = label.trim() ? checkLabel(label, store.subAddresses) : null;

  function create() {
    const trouble = checkLabel(label, store.subAddresses);
    if (trouble) {
      toast({ tone: "error", title: "Cannot use that name", message: describeLabelProblem(trouble) });
      return;
    }
    const error = store.addSubAddress(label);
    if (error) {
      toast({ tone: "error", title: "Could not create sub-address", message: error });
      return;
    }
    toast({ tone: "success", title: "Sub-address created", message: label.trim() });
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
          Payments to this address arrive in your wallet exactly like any other, tagged with this
          name.
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
                (ok) => ok && toast({ tone: "success", title: "Address copied" }),
              )
            }
          >
            Copy address
          </Button>
          <Button variant="outline" onClick={() => setShowing(null)}>
            Back
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
        Sub-addresses
      </h2>
      <p className="mb-5 text-xs leading-relaxed text-zinc-500">
        Hand out a different address per payer, shop or invoice. Every one of them belongs to this
        same wallet — the funds land in your balance either way — and the name rides along with the
        payment so you can tell who paid.
      </p>

      <Field
        label="Name"
        hint={
          problem
            ? describeLabelProblem(problem)
            : `Whoever pays you will see this. Up to ${MAX_LABEL_BYTES} characters.`
        }
      >
        <div className="flex gap-2.5">
          <TextInput
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="coffee-stand, invoice-42, alice…"
            spellCheck={false}
            error={!!problem}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !problem) create();
            }}
          />
          <Button disabled={!label.trim() || !!problem} onClick={create}>
            <Plus size={15} /> Create
          </Button>
        </div>
      </Field>

      <div className="mt-5">
        {store.subAddresses.length === 0 ? (
          <EmptyState
            icon={<Tag size={20} />}
            title="No sub-addresses yet"
            sub="Create one above to start accepting payments under a name you can recognise."
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
                    Show
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Forget ${sub.label}`}
                    onClick={() => {
                      store.removeSubAddress(sub.label);
                      toast({
                        tone: "info",
                        title: "Sub-address forgotten",
                        message: "Anything already paid to it is still in your wallet.",
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
        These are not separate wallets. Each one shares this wallet's view and spend keys, so
        forgetting a name here never puts funds out of reach.
      </p>
    </div>
  );
}
