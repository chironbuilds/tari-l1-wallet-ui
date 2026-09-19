import { useEffect, useMemo, useState } from "react";
import { DappFrame } from "./DappFrame";
import { ExternalLink, Compass, Grid3x3, Plus, Search, Trash2, Check } from "lucide-react";
import {
  CATALOG,
  type CatalogEntry,
  type Dapp,
  cachedArtwork,
  hostOf,
  hueOf,
  isInstalled,
  loadDapps,
  nameFromUrl,
  normaliseUrl,
  resolveArtwork,
  saveDapps,
} from "../lib/dapps";
import { useToast } from "./toast";
import { Badge, Button, EmptyState, Field, Segmented, TextInput, cn } from "./ui";

type Tab = "installed" | "explore";

/**
 * The dApp store.
 *
 * A dApp is a URL. Everything lives in `localStorage` and opens in a new tab — there is no
 * registry, no remote catalogue, and nothing installed until the user installs it.
 */
export function DappStore() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("installed");
  const [dapps, setDapps] = useState<Dapp[]>(() => loadDapps());
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  /** The dApp currently open in the embedded frame, if any. */
  const [running, setRunning] = useState<Dapp | null>(null);

  useEffect(() => saveDapps(dapps), [dapps]);

  // Land people on Explore when they have nothing yet, so the panel never opens on an empty list.
  useEffect(() => {
    if (dapps.length === 0) setTab("explore");
    // Only on mount: switching away from an empty Installed tab mid-session would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const install = (entry: { url: string; name: string; description?: string; image?: string }) => {
    const normalised = normaliseUrl(entry.url);
    if (!normalised) {
      toast({ tone: "error", title: "That doesn't look like a URL", message: entry.url });
      return false;
    }
    if (isInstalled(dapps, normalised)) {
      toast({ tone: "info", title: "Already installed", message: hostOf(normalised) });
      return false;
    }
    setDapps((prev) => [
      ...prev,
      {
        url: normalised,
        name: entry.name.trim() || nameFromUrl(normalised),
        description: entry.description?.trim() || undefined,
        image: entry.image?.trim() || undefined,
        addedAt: Date.now(),
      },
    ]);
    toast({ tone: "success", title: "Installed", message: entry.name || hostOf(normalised) });
    return true;
  };

  const remove = (target: Dapp) => {
    setDapps((prev) => prev.filter((d) => d.url !== target.url));
    toast({ tone: "info", title: "Removed", message: target.name });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return dapps;
    return dapps.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        hostOf(d.url).toLowerCase().includes(q) ||
        (d.description ?? "").toLowerCase().includes(q),
    );
  }, [dapps, query]);

  const catalogFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CATALOG;
    return CATALOG.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        hostOf(c.url).toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [query]);

  if (running) {
    return (
      <div className="h-[70vh] min-h-[420px]">
        <DappFrame url={running.url} name={running.name} onClose={() => setRunning(null)} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-lg font-bold text-[var(--tari-text)]">
          <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-[#9d6bff] to-[#6d28d9]">
            <Grid3x3 size={15} />
          </span>
          dApp store
        </h2>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "installed", label: `Installed${dapps.length ? ` · ${dapps.length}` : ""}` },
            { value: "explore", label: "Explore" },
          ]}
        />
      </div>

      <div className="mb-5 flex flex-wrap gap-2.5">
        <div className="relative min-w-0 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--tari-text-dim)]"
          />
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search dApps…"
            className="pl-9"
            spellCheck={false}
          />
        </div>
        <Button variant={adding ? "outline" : undefined} onClick={() => setAdding((s) => !s)}>
          <Plus size={14} /> Add dApp
        </Button>
      </div>

      {adding && (
        <div
          className="mb-5 rounded-2xl border p-4"
          style={{ borderColor: "var(--tari-border)", background: "var(--tari-bg-input)" }}
        >
          <Field label="dApp URL">
            <TextInput
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="explorer.tari.mw"
              mono
              spellCheck={false}
              autoFocus
            />
          </Field>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Name (optional)">
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={url ? nameFromUrl(normaliseUrl(url) ?? url) : "Ootle Explorer"}
              />
            </Field>
            <Field
              label="Image URL (optional)"
              hint="Left blank, the tile tries the site's own icons."
            >
              <TextInput
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="https://…/og-image.png"
                mono
                spellCheck={false}
              />
            </Field>
          </div>
          <div className="mt-4 flex gap-2.5">
            <Button
              onClick={() => {
                if (install({ url, name, image })) {
                  setUrl("");
                  setName("");
                  setImage("");
                  setAdding(false);
                  setTab("installed");
                }
              }}
              disabled={!url.trim()}
            >
              <Plus size={14} /> Add
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {tab === "installed" ? (
        filtered.length === 0 ? (
          <EmptyState
            icon={<Grid3x3 size={20} />}
            title={dapps.length === 0 ? "No dApps installed" : "Nothing matches that search"}
            sub={
              dapps.length === 0
                ? "Add one by URL, or install from Explore."
                : "Try a different name or host."
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((d) => (
              <DappCard
                key={d.url}
                url={d.url}
                name={d.name}
                description={d.description}
                image={d.image}
                installed
                onRemove={() => remove(d)}
                onOpen={() => setRunning(d)}
              />
            ))}
          </div>
        )
      ) : catalogFiltered.length === 0 ? (
        <EmptyState
          icon={<Compass size={20} />}
          title="Nothing matches that search"
          sub="Explore is a short hand-written list — add anything else by URL."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {catalogFiltered.map((c) => (
            <CatalogCard
              key={c.url}
              entry={c}
              installed={isInstalled(dapps, normaliseUrl(c.url) ?? c.url)}
              onInstall={() => install(c)}
            />
          ))}
        </div>
      )}

      <p className="mt-6 border-t pt-3 text-[11px] leading-relaxed text-[var(--tari-text-dim)]" style={{ borderColor: "var(--tari-border)" }}>
        dApps are ordinary websites opened in a new tab, stored only in this browser. Nothing is
        installed by default and the list is never fetched from a server. A dApp cannot see your
        seed or spend anything on its own — but treat one exactly as you would any site you connect
        a wallet to.
      </p>
    </div>
  );
}

/**
 * The artwork tile.
 *
 * The monogram is not a fallback that replaces the image — it is the tile's resting state, drawn
 * immediately and covered once artwork resolves. Probing is a network round trip per candidate, so
 * anything that renders an empty box while it waits reads as broken; this way a tile is never
 * blank, and a cached result skips the wait entirely.
 */
function DappArt({ url, image, name }: { url: string; image?: string; name: string }) {
  const hue = hueOf(url);
  const [src, setSrc] = useState<string | null>(() => cachedArtwork(url, image) ?? null);

  useEffect(() => {
    const cached = cachedArtwork(url, image);
    if (cached !== undefined) {
      setSrc(cached);
      return;
    }
    const signal = { cancelled: false };
    void resolveArtwork({ url, image }, signal).then((found) => {
      if (!signal.cancelled) setSrc(found);
    });
    return () => {
      signal.cancelled = true;
    };
  }, [url, image]);

  return (
    <div
      className="relative grid h-28 place-items-center overflow-hidden rounded-xl"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 70% 55% / 0.28), hsl(${(hue + 48) % 360} 70% 45% / 0.14))`,
      }}
    >
      <span
        className="text-3xl font-black tracking-tight"
        style={{ color: `hsl(${hue} 60% 45%)` }}
      >
        {name.trim().charAt(0).toUpperCase() || "?"}
      </span>
      {src && (
        <img
          src={src}
          alt=""
          // Sized to the box rather than capped by it: an SVG favicon carries a viewBox but no
          // width/height, so it has no intrinsic size and `max-h-full` has nothing to cap — the
          // element takes the replaced-element default and spills out of the tile. Setting the box
          // explicitly gives `object-contain` something to letterbox against. The padding keeps a
          // square icon off the edges the way a banner legitimately sits.
          className="absolute inset-0 h-full w-full animate-fade-up object-contain p-5 drop-shadow"
        />
      )}
    </div>
  );
}

function DappCard({
  url,
  name,
  description,
  image,
  installed,
  onRemove,
  onOpen,
}: {
  url: string;
  name: string;
  description?: string;
  image?: string;
  installed?: boolean;
  onRemove?: () => void;
  onOpen?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex flex-col gap-3 rounded-2xl border p-3 transition-all",
        "hover:-translate-y-0.5 hover:border-[#9d6bff]/40",
      )}
      style={{ borderColor: "var(--tari-border)", background: "var(--tari-bg-panel)" }}
    >
      <DappArt url={url} image={image} name={name} />
      <div className="min-w-0 flex-1 px-1">
        <p className="truncate text-sm font-bold text-[var(--tari-text)]">{name}</p>
        <p className="truncate font-mono text-[11px] text-[var(--tari-text-dim)]">{hostOf(url)}</p>
        {description && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--tari-text-dim)]">
            {description}
          </p>
        )}
      </div>
      <div className="flex gap-2 px-1 pb-1">
        <Button size="sm" className="flex-1" onClick={onOpen}>
          <ExternalLink size={13} /> Open
        </Button>
        {installed && onRemove && (
          <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${name}`}>
            <Trash2 size={13} />
          </Button>
        )}
      </div>
    </div>
  );
}

function CatalogCard({
  entry,
  installed,
  onInstall,
}: {
  entry: CatalogEntry;
  installed: boolean;
  onInstall: () => void;
}) {
  return (
    <div
      className="group flex flex-col gap-3 rounded-2xl border p-3 transition-all hover:-translate-y-0.5 hover:border-[#9d6bff]/40"
      style={{ borderColor: "var(--tari-border)", background: "var(--tari-bg-panel)" }}
    >
      <DappArt url={entry.url} image={entry.image} name={entry.name} />
      <div className="min-w-0 flex-1 px-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-bold text-[var(--tari-text)]">{entry.name}</p>
          {entry.tag && <Badge tone="violet">{entry.tag}</Badge>}
        </div>
        <p className="truncate font-mono text-[11px] text-[var(--tari-text-dim)]">
          {hostOf(entry.url)}
        </p>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--tari-text-dim)]">
          {entry.description}
        </p>
      </div>
      <div className="px-1 pb-1">
        {installed ? (
          <Button size="sm" variant="outline" className="w-full" disabled>
            <Check size={13} /> Installed
          </Button>
        ) : (
          <Button size="sm" className="w-full" onClick={onInstall}>
            <Plus size={13} /> Install
          </Button>
        )}
      </div>
    </div>
  );
}
