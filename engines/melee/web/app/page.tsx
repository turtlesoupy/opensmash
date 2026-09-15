import Controls from "./Controls";
import {announceCharacter, stopAnnouncer} from "@/lib/announcer";
import {preferences} from '@/lib/desktop';
import { useEffect, useMemo, useRef, useState } from "react";
import Game from "./Game";
import NativeGame from "./NativeGame";
import {desktop} from "@/lib/desktop";
import BootScreen from "./BootScreen";
import SettingsMenu from "./SettingsMenu";
import RosterGrid, { FrameRule } from "./RosterGrid";
import SiteDialog from "./SiteDialog";
import ImportCharacter from "./ImportCharacter";
import ManageCharacter from "./ManageCharacter";
import { loadSettings, schema, type Settings } from "@/lib/launch";
import { unlockAudio } from "@/lib/audio";
import { warmMelee } from "@/lib/melee-session";
import order from "@/lib/roster-order.json";
export type Fighter = {
  slug: string;
  name: string;
  short: string;
  target: string;
  review?: boolean;
  portrait?: string;
  imported?: boolean;
};
export const names: Record<string,string> = Object.fromEntries(schema.targets.map(t=>[t.slug,t.label]));
const ranks = new Map(order.map((slug, index) => [slug, index]));
export default function Home() {
  const [gameReady,setGameReady]=useState(false);
  useEffect(() => {
    const hidden = () => { if (document.hidden) stopAnnouncer(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', stopAnnouncer);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', stopAnnouncer);
      stopAnnouncer();
    };
  }, []);
  const [settings, setSettings] = useState(loadSettings);
  const [roster, setRoster] = useState<Fighter[]>([]),
    [query, setQuery] = useState(""),
    [target, setTarget] = useState("all"),
    [selected, setSelected] = useState<{ id: number; fighter: Fighter; settings: Settings } | null>(
      null,
    ),
    [error, setError] = useState("");
  const [dialog, setDialog] = useState<"Settings" | "Controls" | "About" | "Create" | null>(null);
  const [manage, setManage] = useState<Fighter | null>(null);
  useEffect(() => desktop()?.onOpenSettings(() => setDialog("Settings")), []);
  const frame = useRef<HTMLDivElement>(null),
    launchId = useRef(0);
  useEffect(() => {
    preferences.setItem("melee-launch-v1", JSON.stringify(settings));
  }, [settings]);
  useEffect(() => {
    document.body.classList.add("is-game-booted");
    return () => document.body.classList.remove("is-game-booted");
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetch("/catalog.json", { signal: controller.signal }), fetch("/api/imports", { signal: controller.signal })])
      .then(async ([base,imports]) => {
        if (!base.ok) throw Error("The fighter roster could not load.");
        const catalog=await base.json();
        const imported=imports.ok?await imports.json():[];
        return [...imported,...(catalog.fighters||catalog)];
      })
      .then((data) =>
        setRoster(
          data.sort(
            (a: Fighter, b: Fighter) =>
              (ranks.get(a.slug) ?? Infinity) - (ranks.get(b.slug) ?? Infinity),
          ),
        ),
      )
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, []);
  useEffect(()=>{if(gameReady&&!desktop())warmMelee();},[gameReady]);
  const choose = (fighter: Fighter) => {
    if(!gameReady){setError("Choose and verify your Melee ISO in the boot screen first.");frame.current?.scrollIntoView({block:"start"});return;}
    setError("");
    announceCharacter(fighter.slug);
    void unlockAudio().catch(() => {});
    setSelected({ id: ++launchId.current, fighter, settings: structuredClone(settings) });
    frame.current?.scrollIntoView({ block: "start", behavior: "instant" });
  };
  const filtered = useMemo(
    () =>
      roster.filter(
        (f) =>
          (target === "all" || f.target === target) &&
          (f.name + " " + names[f.target]).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      ),
    [roster, query, target],
  );
  const Player=desktop()?NativeGame:Game;
  return (
    <>
      <main className="arena-shell" aria-label="Smash.fun Melee character grid">
        <header className="retro-site-header">
          <a
            className="retro-site-logo melee-wordmark"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setSelected(null);
              setQuery("");
              setTarget("all");
            }}
            aria-label="SMASH.FUN MELEE Alpha home"
          >
            <span className="melee-wordmark-name">SMASH.FUN <span>MELEE</span></span>
            <span className="melee-alpha-tag">ALPHA</span>
          </a>
          <nav className="retro-site-nav" aria-label="Site information and settings">
            <button className="retro-site-link" onClick={() => setDialog("About")}>
              About
            </button>
            <button
              id="controls-menu-button"
              className="retro-site-link"
              onClick={() => setDialog("Controls")}
            >
              Controls
            </button>
            <button
              className="retro-site-link retro-site-advanced-button"
              onClick={() => setDialog("Settings")}
            >
              Settings
            </button>
            <details className="retro-site-more">
              <summary className="retro-site-link">More</summary>
              <div className="retro-site-more-menu">
                {(["Controls", "Settings"] as const).map((name) => (
                  <button
                    key={name}
                    className="retro-site-link"
                    onClick={(e) => {
                      e.currentTarget.closest("details")?.removeAttribute("open");
                      setDialog(name);
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </details>
            <div className="retro-social-links">
              <a
                className="retro-site-link retro-social-link retro-github-link"
                href="https://github.com/turtlesoupy/opensmash-melee"
                target="_blank"
                rel="noreferrer"
                aria-label="View the source on GitHub"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 .7a11.6 11.6 0 0 0-3.7 22.6c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0C15.7 5 16.7 5.3 16.7 5.3c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.8 5.5-5.5 5.8.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.6 11.6 0 0 0 12 .7Z" />
                </svg>
                <span>Github</span>
              </a>
              <a
                className="retro-site-link retro-social-link retro-discord-link"
                href="https://discord.gg/qYBbGmwBhr"
                target="_blank"
                rel="noreferrer"
                aria-label="Join the Smash.fun community on Discord"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19.6 5.3A18 18 0 0 0 15.3 4l-.5 1a14.7 14.7 0 0 0-5.6 0l-.5-1a18 18 0 0 0-4.3 1.3C1.7 9.4 1 13.4 1.4 17.4a17.3 17.3 0 0 0 5.3 2.7l1.3-1.8a10.8 10.8 0 0 1-2-1l.5-.4a12.6 12.6 0 0 0 11 0l.5.4a11 11 0 0 1-2 1l1.3 1.8a17.3 17.3 0 0 0 5.3-2.7c.5-4.6-.8-8.5-3-12.1ZM8.5 15.2c-1.3 0-2.3-1.2-2.3-2.7s1-2.7 2.3-2.7 2.3 1.2 2.3 2.7-1 2.7-2.3 2.7Zm7 0c-1.3 0-2.3-1.2-2.3-2.7s1-2.7 2.3-2.7 2.3 1.2 2.3 2.7-1 2.7-2.3 2.7Z" />
                </svg>
                <span>Discord</span>
              </a>
            </div>
          </nav>
        </header>
        <section
          className="intro-video-stage"
          style={!desktop() && !selected && gameReady ? {display:"none"} : undefined}
          aria-label={selected ? "Melee game" : gameReady ? "Select a character" : "Game setup"}
        >
          <div ref={frame} className={`intro-video-frame ${desktop() ? "is-native-screen" : ""} ${selected ? "is-game-running" : ""}`}>
            {selected ? (
              <Player
                key={selected.id}
                fighter={selected.fighter}
                settings={selected.settings}
                roster={roster}
                onClose={() => setSelected(null)}
              />
            ) : (
              <BootScreen onReady={setGameReady} showReadyPrompt={!!desktop()}/>
            )}
            <FrameRule />
          </div>
        </section>
        <RosterGrid
          fighters={filtered}
          targetOverride={settings.ports[0].target}
          query={query}
          onQuery={setQuery}
          onChoose={choose}
          onCreate={() => setDialog("Create")}
          onManage={setManage}
          paused={!!selected}
        />
        <div className="roster-status" role="status">
          {error ||
            (!roster.length
              ? "Loading fighters…"
              : `${filtered.length.toLocaleString()} fighters · Melee`)}
          {(query || target !== "all") && (
            <button
              className="retro-site-link"
              onClick={() => {
                setQuery("");
                setTarget("all");
              }}
            >
              Clear search / filter
            </button>
          )}
        </div>
      </main>
      {manage && (
        <SiteDialog title={manage.name} onClose={() => setManage(null)}>
          <ManageCharacter
            fighter={manage}
            onPlay={(fighter) => {
              setManage(null);
              choose(fighter);
            }}
            onRemoved={(fighter) => {
              setManage(null);
              if (selected?.fighter.slug === fighter.slug) setSelected(null);
              setRoster((previous) => previous.filter((f) => f.slug !== fighter.slug));
            }}
          />
        </SiteDialog>
      )}
      {dialog && (
        <SiteDialog title={dialog} onClose={() => setDialog(null)}>
          {dialog === "Create" && <ImportCharacter onImported={fighter=>setRoster(previous=>[fighter,...previous.filter(f=>f.slug!==fighter.slug)])} onPlay={fighter=>{setDialog(null);choose(fighter);}}/>}
          {dialog === "Settings" && (
            <SettingsMenu value={settings} onChange={setSettings} roster={roster}
              target={target} onTarget={setTarget} onReady={ready=>{setGameReady(ready);if(!ready)setSelected(null);}} onClose={()=>setDialog(null)} />
          )}
          {dialog === "Controls" && <Controls />}
          {dialog === "About" && (
            <>
              <p>
                Smash.fun Melee brings the OpenSmash character roster into Super Smash Bros. Melee,
                using its original game engine.
              </p>
              <p>
                {roster.length.toLocaleString()} custom characters with 26 Melee
                fighters. Select a portrait to play, or choose a different launch mode in Settings.
              </p>
              <p>Create a character on smash.fun, then import it here to add it to your roster.</p>
            </>
          )}
        </SiteDialog>
      )}
    </>
  );
}
