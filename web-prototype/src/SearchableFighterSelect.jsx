import { useEffect, useMemo, useRef, useState } from "react";
import { matchesCharacterSearch } from "../shared/character-search.js";
import "./fighter-select.css";

export default function SearchableFighterSelect({ characters, selected, onSelect, openToken = 0, label = "Character", disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (openToken) {
      setQuery("");
      setOpen(true);
    }
  }, [openToken]);
  const matches = useMemo(
    () => characters.filter((character) => matchesCharacterSearch(character, query)),
    [characters, query],
  );

  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  function choose(character) {
    onSelect(character);
    setQuery("");
    setOpen(false);
  }

  return (
    <div
      className={`og-field og-fighter-combobox ${open ? "is-open" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <span>{label}</span>
      <button
        className="og-combobox-trigger"
        type="button"
        disabled={disabled}
        aria-label={`${label}: ${selected?.name || "Choose a fighter"}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          setQuery("");
          setOpen((current) => !current);
        }}
      >
        {selected ? <img src={selected.portraitMedium || selected.portraitFull || selected.portrait} alt="" /> : <i />}
        <strong>{selected?.name || "Choose a fighter"}</strong>
        <b aria-hidden="true">⌄</b>
      </button>
      {open ? (
        <div className="og-combobox-popover">
          <label className="og-combobox-search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={inputRef}
              aria-label={`Search ${label.toLowerCase()}`}
              type="search"
              value={query}
              placeholder={`Search ${characters.length.toLocaleString()} fighters…`}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false);
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (matches.length === 1) choose(matches[0]);
                }
              }}
            />
          </label>
          <div className="og-combobox-options" role="listbox" aria-label="Generated characters">
            {matches.map((character) => (
              <button
                className={character.slug === selected?.slug ? "is-selected" : undefined}
                type="button"
                role="option"
                aria-selected={character.slug === selected?.slug}
                key={character.slug}
                onClick={() => choose(character)}
              >
                <img loading="lazy" src={character.portraitMedium || character.portraitFull || character.portrait} alt="" />
                <span>
                  <strong>{character.name}</strong>
                  <small>{character.short || character.slug}</small>
                </span>
              </button>
            ))}
            {!matches.length ? <p>No fighters match “{query}”.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
