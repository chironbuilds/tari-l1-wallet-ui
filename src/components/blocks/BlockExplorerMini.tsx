import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import Hls from "hls.js";
import NumberFlow from "@number-flow/react";
import {
  estimateActiveMiners,
  fetchBlockStats,
  fetchChainTip,
  formatBlockNumber,
  formatBlockTimer,
  formatReward,
  parseStats,
  timeAgo,
  type BlockBubbleData,
} from "../../lib/explorer";

const URL_BLOCK_SOLVED = `https://customer-o6ocjyfui1ltpm5h.cloudflarestream.com/852dac0dc91d50d399a7349dcc7316a1/manifest/video.m3u8`;
const URL_BLOCK = `https://customer-o6ocjyfui1ltpm5h.cloudflarestream.com/3ed05f3d4fbfd3eec7c4bb911915d1c2/manifest/video.m3u8`;

// Blocks land roughly every two minutes; polling at 10s keeps both the ticker and the wallet
// scan within a few seconds of a freshly mined block.
function useBlockStats(pollMs = 10000) {
  const [stats, setStats] = useState<BlockBubbleData[]>([]);
  const [tip, setTip] = useState<{ height: number; timestamp: number } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const [raw, t] = await Promise.all([fetchBlockStats(10), fetchChainTip()]);
        if (!alive) return;
        setStats(raw.map(parseStats));
        if (t) setTip(t);
      } catch {
        /* keep last */
      }
    };
    void poll();
    const id = setInterval(poll, pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pollMs]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return { stats, tip, tick };
}

function HLSPlayer({ src, loop = true }: { src: string; loop?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;
    let hls: Hls | null = null;
    if (Hls.isSupported()) {
      hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(videoElement);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoElement.play().catch(() => {});
      });
    } else if (videoElement.canPlayType("application/vnd.apple.mpegurl")) {
      videoElement.src = src;
      videoElement.play().catch(() => {});
    }
    return () => {
      hls?.destroy();
    };
  }, [src]);

  return (
    <video
      ref={videoRef}
      muted
      autoPlay
      loop={loop}
      playsInline
      className="pointer-events-none size-full border-none object-cover"
    />
  );
}

function PeopleIcon() {
  return (
    <svg width="12" height="10" viewBox="0 0 12 10" fill="none" className="translate-y-px">
      <g opacity="0.5">
        <path
          d="M6.00188 0.316952C4.91938 0.316952 4.0382 1.21633 4.0382 2.30319C4.0382 3.39006 4.91944 4.2888 6.00188 4.2888C7.08431 4.2888 7.96556 3.39067 7.96556 2.30319C7.96556 1.21631 7.08431 0.316952 6.00188 0.316952ZM4.97938 5.1888C4.29938 5.1888 3.72125 5.54443 3.34882 6.03067C2.97639 6.51691 2.77632 7.13317 2.77632 7.76124V8.10874C2.77632 8.75687 3.30632 9.30124 3.95695 9.30124H8.04255C8.69318 9.30124 9.22443 8.75687 9.22443 8.10874V7.76124C9.22443 7.13311 9.02443 6.51687 8.65193 6.03067C8.27943 5.54448 7.70006 5.1888 7.02009 5.1888H4.97938Z"
          fill="#3A3835"
        />
        <path
          opacity="0.44"
          d="M9.54877 0.0511703C8.89064 0.0511703 8.35627 0.603043 8.35627 1.25805C8.35627 1.91306 8.89064 2.46493 9.54877 2.46493C10.2069 2.46493 10.7413 1.91306 10.7413 1.25805C10.7413 0.603043 10.2069 0.0511703 9.54877 0.0511703ZM9.04313 3.78686C8.81563 3.78498 8.61563 3.93623 8.55563 4.15561C8.49625 4.37498 8.59188 4.60686 8.78875 4.7206C9.35813 5.05372 9.78125 5.81873 9.95062 6.4518H9.95125C10.0094 6.67118 10.2075 6.82368 10.4344 6.82368H11.0694C11.5906 6.82368 12 6.37931 12 5.8718V5.64305C12 5.19742 11.8663 4.76555 11.6044 4.41367C11.3425 4.0618 10.9181 3.78679 10.42 3.78679L9.04313 3.78686Z"
          fill="#3A3835"
        />
        <path
          opacity="0.44"
          d="M2.455 0C1.76874 0 1.21063 0.575009 1.21063 1.25875C1.21063 1.9425 1.76875 2.51751 2.455 2.51751C3.14125 2.51751 3.69937 1.9425 3.69937 1.25875C3.69937 0.575009 3.14124 0 2.455 0ZM1.58375 3.78689C1.08499 3.78689 0.660625 4.06189 0.399377 4.41377C0.137504 4.76564 0 5.19814 0 5.64314V5.8719C0 6.38003 0.413121 6.82377 0.934369 6.82377H1.43936C1.66687 6.82439 1.86562 6.6719 1.92373 6.4519C2.07936 5.87127 2.62124 5.06626 3.21186 4.7207C3.40874 4.60757 3.50436 4.37633 3.44561 4.15695C3.38685 3.9382 3.18748 3.78633 2.96061 3.78695L1.58375 3.78689Z"
          fill="#3A3835"
        />
      </g>
    </svg>
  );
}

function CubeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="24"
      viewBox="-1 -1 22 24"
      fill="none"
      style={{ willChange: "transform" }}
    >
      <g>
        <path
          d="M19.9981 5.80258L10.0469 11.6052L0.0285645 5.80258L9.98178 0L19.9981 5.80258Z"
          fill="url(#paint0_linear_7608_68884)"
        />
        <path
          d="M19.998 5.80249L19.9696 16.1973L10.0164 21.9999L10.0469 11.6051L19.998 5.80249Z"
          fill="url(#paint1_linear_7608_68884)"
        />
        <path
          d="M10.0468 11.6051L10.0163 21.9999L0 16.1973L0.0284784 5.80249L10.0468 11.6051Z"
          fill="url(#paint2_linear_7608_68884)"
        />
        <g>
          <path
            d="M0.0324707 5.79858C2.99219 7.50486 7.17649 9.8459 10.0487 11.6012L10.0447 11.6093C7.11547 9.99489 2.93524 7.51915 0.0324707 5.79858Z"
            fill="white"
          />
          <path
            d="M10.0448 11.6012C12.978 9.88264 17.0627 7.4171 19.9959 5.79858L20 5.80675C17.1623 7.54364 12.9597 9.93774 10.0427 11.6012H10.0448Z"
            fill="white"
          />
          <path
            d="M10.0508 11.6052C10.059 14.6729 10.1302 18.9773 10.0508 22.0001H10.0427C9.97149 18.9998 10.0183 14.6341 10.0508 11.6052Z"
            fill="white"
          />
        </g>
      </g>
      <defs>
        <linearGradient
          id="paint0_linear_7608_68884"
          x1="0.0285643"
          y1="5.80258"
          x2="38.5333"
          y2="-12.3169"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#E6E2DB" />
          <stop offset="1" stopColor="#AFA695" />
        </linearGradient>
        <linearGradient
          id="paint1_linear_7608_68884"
          x1="10.0164"
          y1="13.9012"
          x2="0.203502"
          y2="13.9012"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#E7E2D9" />
          <stop offset="1" stopColor="#E6E2DB" />
        </linearGradient>
        <linearGradient
          id="paint2_linear_7608_68884"
          x1="-5.83313e-08"
          y1="13.9012"
          x2="23"
          y2="9.99976"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#E6E2DB" />
          <stop offset="1" stopColor="#AFA695" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function BlockProgress({ blocks, maxBlocks }: { blocks: number; maxBlocks: number }) {
  const [progress, setProgress] = useState(0);
  const percentage = (blocks / maxBlocks) * 100;

  const gradientId = useRef(
    `progressGradient-${Math.random().toString(36).substring(2, 9)}`,
  ).current;

  useEffect(() => {
    const timer = setTimeout(() => setProgress(percentage), 100);
    return () => clearTimeout(timer);
  }, [percentage]);

  const size = 51;
  const strokeWidth = 6;
  const color = `url(#${gradientId})`;
  const backgroundColor = "#E6E2DB";

  const viewBoxSize = size + strokeWidth;
  const radius = size / 2;
  const center = viewBoxSize / 2;

  const gapAngle = Math.PI / 4;
  const startAngle = Math.PI / 2 + gapAngle;
  const endAngleMax = Math.PI * 2 + Math.PI / 2 - gapAngle;

  const progressRadians = (progress / 100) * (endAngleMax - startAngle);
  const endAngle = startAngle + progressRadians;

  const getCoordinatesForAngle = (angle: number) => {
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    return { x: x + center, y: y + center };
  };

  const createArcPath = () => {
    if (progress === 0) return "";
    const startCoord = getCoordinatesForAngle(startAngle);
    const endCoord = getCoordinatesForAngle(endAngle);
    const largeArcFlag = progressRadians > Math.PI ? 1 : 0;
    return `M ${startCoord.x} ${startCoord.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endCoord.x} ${endCoord.y}`;
  };

  const backgroundPath = `M ${getCoordinatesForAngle(Math.PI / 2 + gapAngle).x} ${
    getCoordinatesForAngle(Math.PI / 2 + gapAngle).y
  } A ${radius} ${radius} 0 1 1 ${getCoordinatesForAngle(Math.PI / 2 - gapAngle).x} ${
    getCoordinatesForAngle(Math.PI / 2 - gapAngle).y
  }`;

  return (
    <div className="relative grid place-items-center" style={{ width: viewBoxSize, height: viewBoxSize }}>
      <svg width={viewBoxSize} height={viewBoxSize} viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}>
        <defs>
          <linearGradient
            id={gradientId}
            x1="0%"
            y1="50%"
            x2="100%"
            y2="50%"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#FFA515" />
            <stop offset="100%" stopColor="#FFDD6C" />
          </linearGradient>
        </defs>
        <path d={backgroundPath} stroke={backgroundColor} strokeWidth={strokeWidth} fill="none" />
        <path
          d={createArcPath()}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          style={{
            transition: "d 1s ease, stroke-dashoffset 1s ease",
            strokeLinecap: "round",
          }}
        />
      </svg>
      <div className="absolute">
        <CubeIcon />
      </div>
      <p className="absolute -bottom-1 text-[10px] font-semibold text-[#3a3835]">{blocks}</p>
    </div>
  );
}

function MinerCount({ height }: { height: number | null }) {
  const value = height ? estimateActiveMiners(height) : 0;
  const rounded = value >= 50_000 ? Math.floor(value / 1000) * 1000 : value;
  const notation = value >= 50_000 ? "compact" : "standard";

  return (
    <div className="relative hidden w-full items-center justify-center md:flex">
      <span className="absolute left-0 h-px w-[38%] bg-black/10" />
      <span className="absolute right-0 h-px w-[38%] bg-black/10" />
      <div className="flex select-none items-center gap-2">
        <span className="size-[11px] shrink-0 rounded-full bg-[#188750]" />
        <span className="text-base font-semibold tracking-[-0.8px] text-[var(--tari-text)]">
          <NumberFlow value={rounded} format={{ maximumFractionDigits: 2, notation }} />{" "}
          active miners
        </span>
      </div>
    </div>
  );
}

function BlockSolving({
  id,
  reward,
  startedAt,
}: {
  id: string;
  reward?: number;
  startedAt: number;
}) {
  return (
    <div
      className="flex select-none rounded-full backdrop-blur-[23px]"
      style={{
        border: "1px solid rgba(255, 144, 18, 0.3)",
        background: "rgba(255, 204, 75, 0.3)",
        padding: 8,
        width: 316,
        height: 89,
      }}
    >
      <div
        className="relative flex size-full items-center overflow-hidden rounded-full"
        style={{ background: "#fccf5f" }}
      >
        <div className="absolute top-0 left-0 z-[1] h-full w-[140px] overflow-hidden">
          <HLSPlayer src={URL_BLOCK} loop />
        </div>
        <div
          className="absolute top-0 right-0 z-0 flex h-full w-[150px] flex-col justify-center gap-1"
          style={{ background: "linear-gradient(to right, #fccf5f, #ffb128)" }}
        >
          <p className="text-xs leading-[119.8%] text-[#111]">
            <strong>#{formatBlockNumber(id)}</strong> block
            <br />
            is being solved
          </p>
          <div className="flex items-center gap-2">
            {reward ? (
              <span className="flex h-5 items-center justify-center rounded-full bg-black px-[7px] text-[11px] font-bold whitespace-nowrap text-[#ffdd6c]">
                {formatReward(reward)} XTM
              </span>
            ) : null}
            <span className="text-xs font-bold text-[#1b1b1b]">
              {formatBlockTimer(Date.now() - startedAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BlockSolved({ height, reward, blocks, timestamp, minersSolved }: BlockBubbleData) {
  const [isHovering, setIsHovering] = useState(false);
  const title = height ? formatBlockNumber(height.toString()) : "";
  const solvedTitle = (minersSolved ?? 0) > 100 ? `${minersSolved} miners` : "Pool";
  return (
    <div
      className="flex select-none transition-[scale] duration-200 hover:scale-[1.02]"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <div
        className="flex rounded-full p-1.5"
        style={{
          border: "1px solid #dbd2c9",
          backgroundColor: "rgba(204, 204, 203, 0.8)",
          width: 260,
          height: 86,
        }}
      >
        <div className="flex size-full items-center gap-3.5 rounded-full bg-white px-4 py-2.5">
          <BlockProgress blocks={blocks ?? 0} maxBlocks={1000} />
          <div className="h-11 w-px self-center bg-[#9a9792] opacity-20" />
          <div className="flex flex-col">
            <p className="text-xs font-normal leading-[119.8%] text-[#111]">
              Block: <strong>{title}</strong>
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-[9px] font-medium text-[#3a3835] opacity-50">
              <PeopleIcon />
              {`${solvedTitle} solved`}
            </p>
            <div className="flex items-center gap-1 pt-0.5">
              <span
                className="flex h-5 items-center justify-center overflow-hidden rounded-full px-2 text-[10px] font-bold whitespace-nowrap"
                style={{
                  background: isHovering
                    ? "linear-gradient(203deg, #e08e69 18.69%, #af72cf 67.59%)"
                    : "linear-gradient(269deg, #ffa515 -26.57%, #ffdd6c 97.7%)",
                  color: isHovering ? "#fff" : "#030303",
                  transition: "background 0.2s ease",
                }}
              >
                {formatReward(reward ?? 0)} XTM
              </span>
              <span className="text-[9px] font-medium whitespace-nowrap text-[#3a3835] opacity-50">
                {timeAgo(timestamp)} ago
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BlockExplorerMini() {
  const { stats, tip, tick } = useBlockStats();
  const { notifyNewBlock } = useStore();
  const notifiedHeight = useRef(0);
  const [sticky, setSticky] = useState<BlockBubbleData | null>(null);
  const prevHeight = useRef<number | null>(null);
  const solvedTimeout = useRef<number | undefined>(undefined);

  void tick;

  useEffect(() => {
    if (stats.length === 0) return;
    const first = stats[0];
    if (prevHeight.current === null) {
      prevHeight.current = first.height;
      return;
    }
    if (first.height > prevHeight.current) {
      prevHeight.current = first.height;
      setSticky({ ...first, isSolved: true });
      clearTimeout(solvedTimeout.current);
      solvedTimeout.current = window.setTimeout(() => setSticky(null), 3000);
    }
  }, [stats]);

  useEffect(() => () => clearTimeout(solvedTimeout.current), []);

  // /blocks/tip/height and /blocks/stats are separate endpoints that lag each other by a block or
  // two, so trusting the tip alone announces a height the solved list is already showing. Take
  // whichever source is further ahead; the block being solved is always one past the newest known.
  const latestSolved = stats[0];
  const latestSolvedHeight = latestSolved?.height ?? 0;
  const chainHeight = Math.max(tip?.height ?? 0, latestSolvedHeight);
  const solvingId = chainHeight > 0 ? (chainHeight + 1).toString() : undefined;
  const solvingReward = latestSolved?.reward;
  // Block stats carry seconds, the tip carries milliseconds.
  const solvingStartedAt =
    tip && tip.height >= latestSolvedHeight
      ? tip.timestamp
      : latestSolved
        ? latestSolved.timestamp * 1000
        : Date.now();

  // This component is already watching the chain for the ticker, so it is the earliest thing in the
  // app to know a block was mined. Handing that to the wallet starts the scan straight away.
  useEffect(() => {
    if (chainHeight > notifiedHeight.current) {
      notifiedHeight.current = chainHeight;
      notifyNewBlock(chainHeight);
    }
  }, [chainHeight, notifyNewBlock]);

  return (
    <div
      className="pointer-events-auto absolute right-0 bottom-0 z-0 flex w-full flex-col items-center gap-2 md:gap-4"
      style={{ padding: "0 0 10px 0" }}
    >
      <MinerCount height={chainHeight > 0 ? chainHeight : null} />
      <div className="relative flex w-full items-center">
        <div className="z-10 flex shrink-0 items-center">
          {sticky?.isSolved ? (
            <BlockSolved {...sticky} />
          ) : solvingId ? (
            <BlockSolving
              id={solvingId}
              reward={solvingReward}
              startedAt={solvingStartedAt}
            />
          ) : (
            <div className="h-[89px] w-[316px]" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 items-center overflow-x-auto pl-3 [mask-image:linear-gradient(to_right,black_85%,transparent)]">
          {stats.map((b) => (
            <div key={b.id} className="shrink-0 pr-3">
              <BlockSolved {...b} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
