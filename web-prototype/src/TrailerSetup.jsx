import { useState } from "react";
import SearchableFighterSelect from "./SearchableFighterSelect.jsx";
import { CHARACTER_MESHES } from "./launch-options.js";
import { TRAILER_CONFIG, createTrailerIntroAction, supportsTrailerMesh } from "./trailer-preset.js";

export default function TrailerSetup({ characters, loading, onBoot }) {
  const [config, setConfig] = useState(() => ({
    introFighters: [...TRAILER_CONFIG.introFighters],
    introMeshes: [...TRAILER_CONFIG.introMeshes],
    introRoomPicks: [...TRAILER_CONFIG.introRoomPicks],
  }));
  const [error, setError] = useState("");
  const roster = [...characters].sort((a, b) => a.name.localeCompare(b.name));
  function changeFighter(index, slug) {
    setError("");
    setConfig((previous) => ({
      ...previous,
      introFighters: previous.introFighters.map((value, i) => i === index ? slug : value),
      introRoomPicks: previous.introRoomPicks.map((value) => value === previous.introFighters[index] ? slug : value),
    }));
  }
  function boot(event) {
    event.preventDefault();
    try {
      createTrailerIntroAction({ type: "start", trailerIntro: true }, characters, config);
      onBoot(config);
    } catch (error) { setError(error.message); }
  }
  return (
    <main className="trailer-setup">
      <form className="trailer-setup-panel" onSubmit={boot}>
        <a href="/">← Back to fighters</a>
        <p className="trailer-setup-eyebrow">DIRECT THE INTRO</p>
        <h1>Trailer cast</h1>
        <p>Choose six fighters in montage order and the two handled by Master Hand. Boot the intro, then press Start capture when the engine is ready.</p>
        <div className="trailer-setup-grid">
          {config.introFighters.map((slug, index) => {
            const mesh = CHARACTER_MESHES.find(({ value }) => value === config.introMeshes[index]);
            return (
              <SearchableFighterSelect key={index}
                label={`${index + 1}. ${mesh.label} shot`}
                selected={roster.find((character) => character.slug === slug)}
                disabled={loading}
                characters={roster.filter((character) => supportsTrailerMesh(character, mesh.value)
                  && !config.introFighters.some((pick, i) => i !== index && pick === character.slug))}
                onSelect={(character) => changeFighter(index, character.slug)}
              />
            );
          })}
        </div>
        <p className="trailer-setup-note">Donkey Kong and Yoshi keep their original shots. Each selected fighter needs the mesh variant for its shot.</p>
        <div className="trailer-setup-grid">
          {config.introRoomPicks.map((slug, index) => (
            <SearchableFighterSelect key={index}
              label={index === 0 ? "First room fighter · pulled from the grid" : "Second room fighter · dropped into the scene"}
              selected={roster.find((character) => character.slug === slug)}
              disabled={loading}
              characters={roster.filter((character) => config.introFighters.includes(character.slug)
                && character.slug !== config.introRoomPicks[1 - index])}
              onSelect={(character) => {
                setError("");
                setConfig((previous) => ({ ...previous, introRoomPicks: previous.introRoomPicks.map((pick, i) => i === index ? character.slug : pick) }));
              }}
            />
          ))}
        </div>
        {error && <p role="alert" className="trailer-setup-error">{error}</p>}
        <button type="submit" disabled={loading}>{loading ? "Loading fighters…" : "Boot intro"}</button>
      </form>
    </main>
  );
}
