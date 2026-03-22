"use client";
import { useState, useEffect, useRef } from "react";
import { MapPin } from "lucide-react";

export default function AddressAutocomplete({ value = "", onChange, onSelect, placeholder = "Adresse suchen…", className = "", inputClassName = "" }) {
  const [query, setQuery]           = useState(value);
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen]             = useState(false);
  const [loading, setLoading]       = useState(false);
  const timerRef = useRef(null);
  const wrapRef  = useRef(null);

  // Close on outside click
  useEffect(() => {
    const h = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // Sync if parent resets value
  useEffect(() => { setQuery(value || ""); }, [value]);

  function handleChange(e) {
    const q = e.target.value;
    setQuery(q);
    onChange?.(q, null, null); // raw text, no coords yet

    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.length < 3) { setSuggestions([]); setOpen(false); return; }

    setLoading(true);
    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&countrycodes=de,at,ch&limit=6&addressdetails=0`,
          { headers: { "Accept-Language": "de" } }
        );
        const data = await res.json();
        setSuggestions(data);
        setOpen(data.length > 0);
      } catch { /* network issue, silently ignore */ }
      setLoading(false);
    }, 420);
  }

  function handleSelect(item) {
    const addr = item.display_name;
    const lat  = parseFloat(item.lat);
    const lng  = parseFloat(item.lon);
    setQuery(addr);
    setSuggestions([]);
    setOpen(false);
    onChange?.(addr, lat, lng);
    onSelect?.({ address: addr, lat, lng });
  }

  // Short display: first 2 parts of display_name
  function short(dn) {
    const parts = dn.split(", ");
    return { main: parts[0], sub: parts.slice(1, 3).join(", ") };
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div className="relative">
        <MapPin size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 pointer-events-none" />
        <input
          className={`w-full pl-7 pr-6 text-xs rounded-lg border border-border px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-400/40 focus:border-emerald-400 bg-white transition-all ${inputClassName}`}
          placeholder={placeholder}
          value={query}
          onChange={handleChange}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          autoComplete="off"
        />
        {loading && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 border-2 border-muted-foreground/30 border-t-muted-foreground/70 rounded-full animate-spin" />
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute z-[300] left-0 right-0 top-full mt-1 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
          {suggestions.map((s, i) => {
            const { main, sub } = short(s.display_name);
            return (
              <button
                key={i}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
                className="w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors border-b border-border/40 last:border-0 flex items-start gap-2"
              >
                <MapPin size={11} className="text-muted-foreground/40 mt-0.5 shrink-0" />
                <span>
                  <span className="text-xs font-medium block">{main}</span>
                  <span className="text-[10px] text-muted-foreground/70">{sub}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
