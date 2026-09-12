/**
 * Locally installed Ootle dApps.
 *
 * A dApp is just a URL for now — the store keeps a list of them in `localStorage` and opens them
 * in a new tab. Nothing is installed by default and nothing is fetched from a registry: the
 * catalogue below is a suggestion list the user chooses from, so an empty wallet stays empty until
 * someone actually installs something.
 */

const STORAGE_KEY = "tari.dapps.installed.v1";

export interface Dapp {
  /** Origin + path, normalised — also the identity used for dedupe and removal. */
  url: string;
  name: string;
  description?: string;
  /** Explicit artwork, when the user supplied one or the catalogue ships one. */
  image?: string;
  addedAt: number;
}

/** A suggestion in the Explore tab. Not installed until the user says so. */
export interface CatalogEntry {
  url: string;
  name: string;
  description: string;
  image?: string;
  tag?: string;
}

/**
 * The Explore list. Deliberately tiny and hand-written rather than fetched: a remote catalogue
 * would be a place to push arbitrary links into someone's wallet, and there is no registry to
 * fetch from yet anyway.
 */
export const CATALOG: CatalogEntry[] = [
  {
    url: "https://explorer.tari.mw",
    name: "Ootle Explorer",
    description: "Browse Ootle substates, transactions and templates.",
    tag: "Explorer",
  },
  {
    url: "https://universe.tari.mw/paylink",
    name: "Paylink",
    description: "Prove a Tari wallet can cover an amount, without revealing its balance — reference dApp for the shield + minimumValuePromise flow.",
    tag: "Reference",
  },
  {
    url: "https://voting.tari.mw",
    name: "PriVote",
    description: "Run or vote in an anonymous ranked-choice election — ballots are stealth tokens nobody can link back to your wallet.",
    image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSfsMOF76yz1Mhpslk3qX8wHKYyY7B3IWQFScO7ThkXVgXv763RcUa1ZiWT&s=10",
    tag: "Voting",
  },
];

export function normaliseUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // A bare host is the common way people type these, so assume https rather than rejecting it.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    // The hash and search are page state, not identity; keep the path so a dApp can live in a
    // subdirectory. A lone trailing slash is noise.
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A readable default name from the host, for when the user does not supply one. */
export function nameFromUrl(url: string): string {
  const host = hostOf(url);
  const label = host.split(".")[0] ?? host;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Artwork candidates for a dApp, tried in order by the tile until one loads.
 *
 * A page's real `og:image` can only be read by fetching and parsing its HTML, which the browser
 * blocks cross-origin — and routing it through a server-side fetcher would mean running an open
 * URL proxy. So this uses the well-known icon paths a site serves directly instead: an `<img>` may
 * load cross-origin even when `fetch` may not. When every candidate fails the tile falls back to a
 * generated monogram, so a site with no icon at all still gets something.
 */
export function imageCandidates(dapp: Pick<Dapp, "url" | "image">): string[] {
  const out: string[] = [];
  if (dapp.image) out.push(dapp.image);
  try {
    const origin = new URL(dapp.url).origin;
    out.push(
      `${origin}/og-image.png`,
      `${origin}/apple-touch-icon.png`,
      `${origin}/icon.png`,
      `${origin}/logo.png`,
      `${origin}/favicon.svg`,
      `${origin}/favicon.ico`,
    );
  } catch {
    /* an unparseable url simply has no candidates */
  }
  return out;
}

const ART_CACHE_KEY = "tari.dapps.art.v1";
/** Re-probe artwork weekly, so a dApp that adds an icon later is picked up without a reinstall. */
const ART_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type ArtCache = Record<string, { src: string | null; at: number }>;

function readArtCache(): ArtCache {
  try {
    const raw = localStorage.getItem(ART_CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as ArtCache) : {};
  } catch {
    return {};
  }
}

function writeArtCache(url: string, src: string | null): void {
  try {
    const cache = readArtCache();
    cache[url] = { src, at: Date.now() };
    localStorage.setItem(ART_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable — probing again next time is the only cost */
  }
}

export function cachedArtwork(url: string): string | null | undefined {
  const hit = readArtCache()[url];
  if (!hit || Date.now() - hit.at > ART_TTL_MS) return undefined;
  return hit.src;
}

/**
 * The first candidate that actually decodes as an image.
 *
 * Probed in parallel rather than one after another: a single-page dApp typically answers *every*
 * path with its index HTML, so a sequential walk pays a full round trip per miss before reaching
 * the icon that works — four of them for `explorer.tari.mw`, which is exactly the lag this avoids.
 * Preference order is still honoured; a later candidate only wins once every earlier one has
 * failed. The result is cached so it costs nothing at all on the next render.
 */
export function resolveArtwork(
  dapp: Pick<Dapp, "url" | "image">,
  signal?: { cancelled: boolean },
): Promise<string | null> {
  const candidates = imageCandidates(dapp);
  if (candidates.length === 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    const status: ("pending" | "ok" | "fail")[] = candidates.map(() => "pending");
    let settled = false;

    const finish = (src: string | null) => {
      if (settled) return;
      settled = true;
      if (!signal?.cancelled) writeArtCache(dapp.url, src);
      resolve(src);
    };

    // The best result is the lowest-index success with nothing unresolved ahead of it.
    const check = () => {
      for (let i = 0; i < status.length; i++) {
        if (status[i] === "pending") return;
        if (status[i] === "ok") return finish(candidates[i]!);
      }
      finish(null);
    };

    candidates.forEach((src, i) => {
      const img = new Image();
      img.onload = () => {
        // A 1x1 tracking pixel or an error page rendered as an image is not artwork.
        status[i] = img.naturalWidth >= 16 && img.naturalHeight >= 16 ? "ok" : "fail";
        check();
      };
      img.onerror = () => {
        status[i] = "fail";
        check();
      };
      img.src = src;
    });

    // Never leave a tile spinning on a host that accepts the connection and then stalls.
    setTimeout(() => {
      for (let i = 0; i < status.length; i++) if (status[i] === "ok") return finish(candidates[i]!);
      finish(null);
    }, 6000);
  });
}

/** A stable hue per dApp, so the monogram fallback is at least consistent and distinguishable. */
export function hueOf(url: string): number {
  let h = 0;
  for (const ch of hostOf(url)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function loadDapps(): Dapp[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is Dapp => !!d && typeof (d as Dapp).url === "string" && typeof (d as Dapp).name === "string",
    );
  } catch {
    // A private window, cleared storage, or a corrupt entry: an empty store is the right answer,
    // never a crash on the way into the panel.
    return [];
  }
}

export function saveDapps(dapps: Dapp[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dapps));
  } catch {
    /* storage unavailable or full — the list stays in memory for this session */
  }
}

export function isInstalled(dapps: Dapp[], url: string): boolean {
  return dapps.some((d) => d.url === url);
}
