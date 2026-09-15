import {gameInputBlocked} from '../lib/controls';
import {meleePath} from '../lib/paths.ts';
import { useEffect, useRef, useState } from "react";
import { desktop } from "@/lib/desktop";
import { type Fighter } from "../lib/fighter";
import { plan, type Settings } from "@/lib/launch";
import { pollService } from "../lib/service-poll";
import { nativeBindings, rawGamepads, sampleMeleePad } from "@/lib/controls";
export default function NativeGame({
  fighter,
  settings,
  roster,
  onClose,
}: {
  fighter: Fighter;
  settings: Settings;
  roster: Fighter[];
  onClose: () => void;
}) {
  const [status, setStatus] = useState("Checking your controllers…"),
    [error, setError] = useState("");
  const embedded = desktop()?.embedded;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [gameReady, setGameReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const loadingStarted = useRef(performance.now());
  useEffect(() => {
    if (hasFrame && gameReady) return;
    const timer = setInterval(() => setElapsed(Math.floor((performance.now() - loadingStarted.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [hasFrame, gameReady]);
  useEffect(() => {
    if (embedded && hasFrame && gameReady && !gameInputBlocked()) {
      canvas.current?.focus({preventScroll: true});
    }
  }, [embedded, hasFrame, gameReady]);
  useEffect(() => {
    if (!embedded) return;
    const bridge = desktop()!;
    const element = canvas.current!;
    const frame = () => setHasFrame(true);
    const failed = (event: Event) => setError((event as CustomEvent<string>).detail);
    const clear = () => bridge.input(null, false);
    const restoreFocus = () => {
      if (!gameInputBlocked()) element.focus({preventScroll: true});
    };
    const key = (event: KeyboardEvent) => {
      if (event.code === "F11" || event.code === "Escape") return;
      if (event.type === "keydown" && (event.metaKey || event.ctrlKey || event.altKey)) return;
      event.preventDefault();
      if (!event.repeat) bridge.input(event.code, event.type === "keydown");
    };
    element.addEventListener("native-frame", frame);
    element.addEventListener("native-error", failed);
    element.addEventListener("keydown", key);
    element.addEventListener("keyup", key);
    element.addEventListener("blur", clear);
    window.addEventListener("blur", clear);
    window.addEventListener("focus", restoreFocus);
    element.focus();
    return () => {
      bridge.setGameActive(false);
      element.removeEventListener("native-frame", frame);
      element.removeEventListener("native-error", failed);
      element.removeEventListener("keydown", key);
      element.removeEventListener("keyup", key);
      element.removeEventListener("blur", clear);
      window.removeEventListener("blur", clear);
      window.removeEventListener("focus", restoreFocus);
    };
  }, [embedded]);
  useEffect(() => {
    const session = crypto.randomUUID();
    let closed = false,
      stopPolling: (() => void) | undefined;
    let inputTimer: ReturnType<typeof setInterval> | undefined;
    const controller = new AbortController();
    async function request(url: string, body: unknown) {
      const response = await meleeFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => {
        throw Error(`The local game service returned an unexpected response (${response.status}). Restart OpenSmash Melee and try again.`);
      });
      if (!response.ok) throw Error(result.error || "Could not launch Melee");
      return result;
    }
    async function start() {
      try {
        setError("");
        setHasFrame(false);
        setGameReady(false);
        const launch = plan(settings, fighter, roster);
        setStatus("Checking your controllers…");
        await request("/api/native/preflight", launch);
        if (closed) return;
        setStatus("Closing the previous match…");
        await desktop()!.beginGame(session);
        if (closed) return;
        desktop()!.setGameActive(true);
        const shared=(window as any).openSmashDesktop;
        if(shared?.input){
          const assigned=new Map(rawGamepads().filter(Boolean).map(p=>[p!.index,p!.id]));
          inputTimer=setInterval(()=>{
            const pads=rawGamepads(),used=new Set<number>();
            const blocked=gameInputBlocked();
            shared.input(session,launch.ports.map((p:any)=>{
              if(!p.device.startsWith('gamepad'))return [p.device==='keyboard'?2:p.device==='off'?1:0,0,0,0,0,0,0,0,0];
              const index=Number(p.device.slice(7)),id=assigned.get(index);
              const pad=pads.find(p=>p?.connected&&!used.has(p.index)&&p.index===index&&p.id===id)||pads.find(p=>p?.connected&&!used.has(p.index)&&p.id===id);
              if(pad)used.add(pad.index);
              return sampleMeleePad(blocked?null:pad);
            }));
          },16);
        }
        let prepared = 0;
        const preparationStatus = () => {
          const name = launch.costumes.length === 1
            ? roster.find((f) => f.slug === launch.costumes[0].character)?.name || launch.costumes[0].character
            : "characters";
          setStatus(`Preparing ${name}… (${prepared}/${launch.costumes.length})`);
        };
        preparationStatus();
        await Promise.all(launch.costumes.map(async (c: { character: string; target: string; color: number }) => {
          if (closed) return;
          await request(
            "/api/prepare/" +
              encodeURIComponent(c.character) +
              "?target=" + encodeURIComponent(c.target) + "&color=" +
              c.color +
              "&skin=host" +
              (launch.costumes.length >= 3 ? "&compact=1" : ""),
            {},
          );
          if (!closed) {
            prepared += 1;
            preparationStatus();
          }
        }));
        if (closed) return;
        setStatus("Starting Melee…");
        stopPolling = pollService<any>(meleePath('/api/native/status'), s => {
          if (s.session !== session) return;
          setStatus(s.message);
          setGameReady(Boolean(s.ready));
          if (s.exitCode != null) {
            clearInterval(inputTimer);
            setError(s.exitCode === 0 ? "Game closed. Return to the roster to start another match." : "Melee stopped unexpectedly. The local native-session.log has details.");
            stopPolling?.();
          }
        }, e => setError(e.message));
        await request("/api/native/launch", { ...launch, session, controls: nativeBindings() });
      } catch (e) {
        controller.abort();
        stopPolling?.();
        clearInterval(inputTimer);
        if (!closed) setError((e as Error).message);
      }
    }
    void start();
    return () => {
      closed = true;
      controller.abort();
      stopPolling?.();
      clearInterval(inputTimer);
      (window as any).openSmashDesktop?.input(session,Array.from({length:4},()=>[0,0,0,0,0,0,0,0,0]));
      void meleeFetch("/api/native/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session }),
        keepalive: true,
      }).catch(() => {});
    };
  }, [fighter, settings, roster]);
  return (
    <section className={embedded ? "native-game" : "boot-screen"}>
      <header className="native-game-toolbar">
        <div>
          {embedded && (
            <button
              onClick={() => {
                void desktop()!.fullscreen();
                canvas.current?.focus();
              }}
            >
              Fullscreen · F11
            </button>
          )}
          <button onClick={() => { void desktop()?.fullscreen(false); onClose(); }}>Return to roster</button>
        </div>
      </header>
      {embedded && (
        <div className="native-game-screen" onPointerDown={() => canvas.current?.focus({preventScroll: true})}>
          <canvas
            id="native-game-canvas"
            ref={canvas}
            width={960}
            height={720}
            tabIndex={0}
            aria-label={`Play as ${fighter.name}`}
            onClick={() => canvas.current?.focus()}
          />
          {!(hasFrame && gameReady) && !error && (
            <div className="native-game-message native-loading" role="status">
              <progress aria-label="Loading game" />
              <p>{status}</p>
              <small>{elapsed}s elapsed{elapsed >= 15 ? " · The first load can take a little longer." : ""}</small>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function meleeFetch(input:string, init?:RequestInit){return fetch(meleePath(input),init);}
