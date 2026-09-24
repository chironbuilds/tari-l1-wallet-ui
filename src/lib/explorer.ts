import { getRpcNetwork, rpcTip } from "./rpc";

const EXPLORER = "https://textexplore.tari.com";

export interface BlockStats {
  height: number;
  totalCoinbaseXtm: string;
  numCoinbases: number;
  numOutputsNoCoinbases: number;
  numInputs: number;
  powAlgo: string;
  timestamp: number;
}

export interface BlockBubbleData {
  id: string;
  height: number;
  minersSolved: number;
  reward?: number;
  timeAgo?: string;
  isSolved?: boolean;
  blocks?: number;
  timestamp: number;
  isFirstEntry?: boolean;
}

export interface ChainTip {
  height: number;
  timestamp: number;
}

export async function fetchBlockStats(limit = 10): Promise<BlockStats[]> {
  const r = await fetch(`${EXPLORER}/blocks/stats?limit=${limit}`);
  if (!r.ok) throw new Error("Failed to fetch block stats");
  return (await r.json()) as BlockStats[];
}

export function parseStats(block: BlockStats): BlockBubbleData {
  return {
    ...block,
    id: block.height.toString(),
    minersSolved: block.numCoinbases,
    reward: parseInt(
      block.totalCoinbaseXtm?.split(".")?.[0]?.replace(/,/g, "") ?? "0",
      10,
    ),
    blocks: block.numOutputsNoCoinbases,
    isSolved: false,
  };
}

export async function fetchChainTip(): Promise<ChainTip | null> {
  // The explorer only indexes MainNet; every other network asks its own node.
  if (getRpcNetwork() !== "mainnet") {
    try {
      const tip = await rpcTip();
      return tip.height > 0 ? { height: tip.height, timestamp: tip.timestamp * 1000 } : null;
    } catch {
      return null;
    }
  }
  try {
    const r = await fetch(`${EXPLORER}/blocks/tip/height`);
    if (!r.ok) return null;
    const j = (await r.json()) as { height?: number | string; timestamp?: number | string };
    const height = Number(j.height);
    const timestamp = Number(j.timestamp);
    if (!Number.isFinite(height) || height <= 0) return null;
    return { height, timestamp: Number.isFinite(timestamp) ? timestamp * 1000 : Date.now() };
  } catch {
    return null;
  }
}

export const timeAgo = (timestamp: number): string => {
  const now = Date.now();
  const timeInMilliseconds = new Date(timestamp * 1000).getTime();
  const difference = now - timeInMilliseconds;

  const seconds = Math.floor(difference / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days} day${days > 1 ? "s" : ""}`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""}`;
  if (minutes > 0) return `${minutes} min${minutes > 1 ? "s" : ""}`;
  return `${seconds} sec${seconds > 1 ? "s" : ""}`;
};

export const formatReward = (number: number): string => {
  if (number >= 1_000_000_000) {
    return `${(number / 1_000_000_000).toFixed(1)}B`;
  } else if (number >= 1_000_000) {
    return `${(number / 1_000_000).toFixed(1)}M`;
  } else if (number >= 100_000) {
    return `${(number / 1_000).toFixed(1)}K`;
  } else {
    return number.toLocaleString("en-US");
  }
};

export const formatBlockNumber = (number: string): string => {
  if (number.length > 3) {
    return number.replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1,");
  }
  return number;
};

export function formatBlockTimer(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
