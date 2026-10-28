"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, ExternalLink, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { googlePlaceHref } from "@/lib/maps";
import type { PlaceSuggestion } from "@/lib/google-places";
import { getGooglePlace, searchGooglePlaces } from "./place-actions";

// Google place link + coordinates for the location form. Posts `googlePlaceId`,
// `lat` and `lng`. The search goes through server actions (Places API (New)),
// so no browser key is needed; when Places isn't configured the search is
// hidden but coordinates stay hand-editable.
export function GooglePlaceField({
  enabled,
  locationName,
  address,
  onFillAddress,
  initial,
}: {
  enabled: boolean;
  locationName: string;
  address: string;
  onFillAddress: (address: string) => void;
  initial?: { googlePlaceId: string | null; lat: number | null; lng: number | null };
}) {
  const [placeId, setPlaceId] = useState(initial?.googlePlaceId ?? "");
  const [lat, setLat] = useState(initial?.lat != null ? String(initial.lat) : "");
  const [lng, setLng] = useState(initial?.lng != null ? String(initial.lng) : "");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [offerAddress, setOfferAddress] = useState<string | null>(null);
  const [picking, startPicking] = useTransition();
  // One autocomplete session per pick: keystrokes + the final Details call are
  // billed together. Created on first keystroke, dropped after a pick.
  const session = useRef<string | null>(null);
  const latestQuery = useRef("");

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onQueryChange(value: string) {
    setQuery(value);
    if (debounce.current) clearTimeout(debounce.current);
    const q = value.trim();
    latestQuery.current = q;
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      session.current ??= crypto.randomUUID();
      const res = await searchGooglePlaces(q, session.current);
      if (latestQuery.current !== q) return; // a newer keystroke won
      if (res.error) toast.error(res.error);
      setSuggestions(res.suggestions ?? []);
    }, 300);
  }

  function pick(s: PlaceSuggestion) {
    const token = session.current ?? crypto.randomUUID();
    session.current = null;
    if (debounce.current) clearTimeout(debounce.current);
    latestQuery.current = "";
    setSuggestions([]);
    setQuery("");
    startPicking(async () => {
      const res = await getGooglePlace(s.placeId, token);
      if (!res.place) {
        toast.error(res.error ?? "Couldn't load that Google place.");
        return;
      }
      const p = res.place;
      setPlaceId(p.placeId);
      setPickedName(s.name);
      if (p.lat != null && p.lng != null) {
        setLat(String(p.lat));
        setLng(String(p.lng));
      }
      setOfferAddress(!address.trim() && p.address ? p.address : null);
    });
  }

  function clearPlace() {
    setPlaceId("");
    setPickedName(null);
    setOfferAddress(null);
  }

  return (
    <div className="space-y-2 sm:col-span-2">
      <Label htmlFor="placeSearch">Google place</Label>
      <input type="hidden" name="googlePlaceId" value={placeId} />

      {placeId ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs">
            <Check className="size-3.5 text-emerald-600" />
            Linked to Google place{pickedName ? `: ${pickedName}` : ""}
          </span>
          <a
            href={googlePlaceHref(locationName || pickedName, placeId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground link-quiet hover:text-foreground"
          >
            Open <ExternalLink className="size-3" />
          </a>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={picking}
            onClick={clearPlace}
          >
            <X className="size-3.5" /> Clear
          </Button>
        </div>
      ) : null}

      {enabled ? (
        <div className="relative">
          <Input
            id="placeSearch"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            // Enter picks the top hit rather than submitting the whole form.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (suggestions[0]) pick(suggestions[0]);
              } else if (e.key === "Escape") {
                setSuggestions([]);
              }
            }}
            placeholder={placeId ? "Search to replace the linked place…" : "Search Google Maps…"}
            autoComplete="off"
            disabled={picking}
          />
          {suggestions.length ? (
            <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover text-sm shadow-md">
              {suggestions.map((s) => (
                <li key={s.placeId}>
                  <button
                    type="button"
                    onClick={() => pick(s)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent focus-ring"
                  >
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span>
                      {s.name}
                      {s.secondary ? (
                        <span className="block text-xs text-muted-foreground">
                          {s.secondary}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Google place search is not configured (GOOGLE_MAPS_API_KEY).
        </p>
      )}

      {offerAddress ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm">
          <span className="text-muted-foreground">Use Google&apos;s address?</span>
          <span>{offerAddress}</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              onFillAddress(offerAddress);
              setOfferAddress(null);
            }}
          >
            Fill address
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOfferAddress(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="lat" className="text-xs text-muted-foreground">
            Latitude
          </Label>
          <Input
            id="lat"
            name="lat"
            type="number"
            step="any"
            min={-90}
            max={90}
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lng" className="text-xs text-muted-foreground">
            Longitude
          </Label>
          <Input
            id="lng"
            name="lng"
            type="number"
            step="any"
            min={-180}
            max={180}
            value={lng}
            onChange={(e) => setLng(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
