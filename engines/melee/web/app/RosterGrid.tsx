import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { fitCaption, expandShortLabel } from "../vendor/opensmash/roster-caption.js";
import { rosterGridDimensions } from "../vendor/opensmash/roster-layout.js";
import { renderRules, renderOuterRules } from "../vendor/opensmash/roster-rules.js";
import type { Fighter } from "./page";
import { names } from "./page";

function Caption({ text }: { text: string }) {
  const c = fitCaption(text);
  return (
    <span
      aria-hidden="true"
      className={`replica-caption-layer ${c.squeeze ? "is-tightened" : ""}`}
      data-cut={c.cut}
      style={
        {
          "--caption-left": `${(100 * c.originX) / 45}%`,
          width: `${c.width / 10}em`,
        } as CSSProperties
      }
    >
      {c.squeeze
        ? c.glyphs.map((g: { text: string; x: number }, i: number) => (
            <span key={i} style={{ left: `${g.x / 10}em` }}>
              {g.text}
            </span>
          ))
        : c.text}
    </span>
  );
}
export function FrameRule() {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const canvas = ref.current!;
    const paint = () => {
      const columns = innerWidth >= 800 ? 8 : innerWidth >= 640 ? 6 : 4;
      const gridWidth =
        canvas.closest(".arena-shell")?.querySelector(".replica-grid")?.clientWidth ||
        canvas.clientWidth;
      const rosterScale = gridWidth / rosterGridDimensions(0, columns).width;
      if (!(rosterScale > 0 && canvas.clientWidth > 0 && canvas.clientHeight > 0)) return;
      const w = Math.max(5, Math.round(canvas.clientWidth / rosterScale)),
        h = Math.max(5, Math.round(canvas.clientHeight / rosterScale));
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.putImageData(new ImageData(renderOuterRules(w, h), w, h), 0, 0);
    };
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  return <canvas ref={ref} className="intro-video-rule-layer" aria-hidden="true" />;
}
export default function RosterGrid({
  fighters,
  query,
  onQuery,
  onChoose,
  onCreate,
  onManage,
  paused,
  targetOverride,
}: {
  fighters: Fighter[];
  query: string;
  onQuery: (s: string) => void;
  onChoose: (f: Fighter) => void;
  onCreate: () => void;
  onManage: (f: Fighter) => void;
  paused: boolean;
  targetOverride?: string;
}) {
  const [columns, setColumns] = useState(() => (innerWidth >= 800 ? 8 : innerWidth >= 640 ? 6 : 4));
  const rules = useRef<HTMLCanvasElement>(null),
    search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const resize = () => setColumns(innerWidth >= 800 ? 8 : innerWidth >= 640 ? 6 : 4);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const count = fighters.length + 2,
    layout = rosterGridDimensions(count, columns);
  useLayoutEffect(() => {
    const canvas = rules.current!;
    canvas.width = layout.width;
    canvas.height = layout.height;
    canvas
      .getContext("2d")!
      .putImageData(
        new ImageData(
          renderRules(layout.width, layout.height, columns, count),
          layout.width,
          layout.height,
        ),
        0,
        0,
      );
  }, [layout.width, layout.height, columns, count]);
  const cell = (i: number) =>
    ({
      "--cell-left": `${((2 + (i % columns) * 47) * 100) / layout.width}%`,
      "--cell-top": `${((2 + Math.floor(i / columns) * 45) * 100) / layout.height}%`,
      "--cell-width": `${(45 * 100) / layout.width}%`,
      "--cell-height": `${(43 * 100) / layout.height}%`,
    }) as CSSProperties;
  return (
    <div
      className="arena-surface melee-roster"
      data-paused={paused}
      style={{ aspectRatio: `${layout.width}/${layout.height}` }}
    >
      <div className="replica-grid" aria-label="Character roster">
        <canvas ref={rules} className="replica-rule-layer" aria-hidden="true" />
        <label
          className="replica-cell is-search"
          style={cell(0)}
          onClick={() => search.current?.focus()}
        >
          <span className="replica-action-static-layer">
            <img
              className="replica-action-static-strip"
              src="/brand/action-static-search.png"
              alt=""
            />
          </span>
          <img className="replica-action-icon" src="/brand/SearchGlass.png" alt="" />
          <Caption text={query || "SEARCH"} />
          <input
            ref={search}
            className="replica-search-input"
            aria-label="Search fighters"
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onQuery("");
              if (e.key === "Enter" && fighters[0]) onChoose(fighters[0]);
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button
          className="replica-cell is-create"
          style={cell(1)}
          onClick={onCreate}
          aria-label="Create fighter"
          data-kind="create"
          type="button"
        >
          <span className="replica-action-static-layer">
            <img
              className="replica-action-static-strip"
              src="/brand/action-static-create.png"
              alt=""
            />
          </span>
          <img className="replica-action-icon is-create" src="/brand/Plus.png" alt="" aria-hidden="true" draggable={false} />
          <Caption text="CREATE" />
        </button>
        {fighters.map((f, i) => (
          <Fragment key={f.slug}>
            <button
              className="replica-cell"
              data-kind="fighter"
              style={cell(i + 2)}
              onClick={() => onChoose(f)}
              aria-label={`Play as ${f.name}, ${names[targetOverride && targetOverride !== 'auto' ? targetOverride : f.target]} moveset`}
              title={`${f.name} · ${names[targetOverride && targetOverride !== 'auto' ? targetOverride : f.target]}`}
            >
              <img
                className="replica-portrait-layer"
                src={f.portrait || `/portraits/${f.slug}.webp`}
                alt=""
                loading="lazy"
                width="90"
                height="86"
              />
              <Caption text={expandShortLabel(f.short, f.name)} />
            </button>
            {f.imported && (
              <span className="replica-cell-tools" style={cell(i + 2)}>
                <button
                  className="replica-cell-gear"
                  type="button"
                  onClick={() => onManage(f)}
                  aria-label={`Manage ${f.name}`}
                  title={`Manage ${f.name}`}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm8.6 5.2.1-1.7-.1-1.7-2.2-.6a6.9 6.9 0 0 0-.7-1.7l1.1-2-2.4-2.4-2 1.1a6.9 6.9 0 0 0-1.7-.7L12.1 2h-3.4l-.6 2.2a6.9 6.9 0 0 0-1.7.7l-2-1.1L2 6.2l1.1 2a6.9 6.9 0 0 0-.7 1.7l-2.2.6-.1 1.5.1 1.9 2.2.6c.2.6.4 1.2.7 1.7l-1.1 2 2.4 2.4 2-1.1c.5.3 1.1.5 1.7.7l.6 2.2h3.4l.6-2.2c.6-.2 1.2-.4 1.7-.7l2 1.1 2.4-2.4-1.1-2c.3-.5.5-1.1.7-1.7l2.2-.6Z" />
                  </svg>
                </button>
              </span>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
