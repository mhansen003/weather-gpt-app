"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export default function Home() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [selectedCity, setSelectedCity] = useState("");
  const [selectedState, setSelectedState] = useState("");
  const [selectedZip, setSelectedZip] = useState("");
  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [cached, setCached] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // AI-powered city suggestions with debounce
  const fetchSuggestions = useCallback((value: string) => {
    // Cancel any pending request
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (value.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSuggestLoading(false);
      return;
    }

    setSuggestLoading(true);

    // Debounce 300ms so we don't fire on every keystroke
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(
          `/api/suggest?q=${encodeURIComponent(value.trim())}`,
          { signal: controller.signal }
        );
        const data = await res.json();
        const results: string[] = data.suggestions || [];

        setSuggestions(results);
        setShowSuggestions(results.length > 0);
        setHighlightIndex(-1);
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } finally {
        setSuggestLoading(false);
      }
    }, 300);
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const handleInputChange = useCallback(
    (value: string) => {
      setQuery(value);
      setSelectedCity("");
      setSelectedState("");
      setSelectedZip("");
      fetchSuggestions(value);
    },
    [fetchSuggestions]
  );

  // Select a city from suggestions
  const selectCity = useCallback((cityState: string) => {
    // Parse "City, ST" or "City, ST 80202" format
    const commaIdx = cityState.lastIndexOf(",");
    if (commaIdx > 0) {
      setSelectedCity(cityState.slice(0, commaIdx).trim());
      const afterComma = cityState.slice(commaIdx + 1).trim();
      // Check for "ST ZIPCODE" pattern
      const zipMatch = afterComma.match(/^([A-Z]{2})\s+(\d{5})$/);
      if (zipMatch) {
        setSelectedState(zipMatch[1]);
        setSelectedZip(zipMatch[2]);
      } else {
        setSelectedState(afterComma);
        setSelectedZip("");
      }
    }
    setQuery(cityState);
    setShowSuggestions(false);
    setHighlightIndex(-1);
    setSuggestLoading(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // Keyboard navigation for suggestions
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showSuggestions || suggestions.length === 0) {
        if (e.key === "Enter" && selectedCity && selectedState) {
          e.preventDefault();
          handleSubmit();
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightIndex >= 0) {
          selectCity(suggestions[highlightIndex]);
        }
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
      } else if (e.key === "Tab" && highlightIndex >= 0) {
        e.preventDefault();
        selectCity(suggestions[highlightIndex]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showSuggestions, suggestions, highlightIndex, selectedCity, selectedState, selectCity]
  );

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll highlighted suggestion into view
  useEffect(() => {
    if (highlightIndex >= 0 && suggestionsRef.current) {
      const items = suggestionsRef.current.children;
      if (items[highlightIndex]) {
        (items[highlightIndex] as HTMLElement).scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightIndex]);

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();

    let city = selectedCity;
    let state = selectedState;
    let zip = selectedZip;

    if (!city || !state) {
      const trimmed = query.trim();

      // Check if the input is a 5-digit zip code
      if (/^\d{5}$/.test(trimmed)) {
        zip = trimmed;
        city = "";
        state = "";
      } else {
        // Try parsing "City, ST" or "City, ST 80202" from typed input
        const commaIdx = trimmed.lastIndexOf(",");
        if (commaIdx > 0) {
          const c = trimmed.slice(0, commaIdx).trim();
          const afterComma = trimmed.slice(commaIdx + 1).trim().toUpperCase();
          const zipMatch = afterComma.match(/^([A-Z]{2})\s+(\d{5})$/);
          if (zipMatch) {
            city = c;
            state = zipMatch[1];
            zip = zipMatch[2];
          } else if (c.length > 0 && afterComma.length === 2) {
            city = c;
            state = afterComma;
          }
        }
        if (!city && !state && !zip) {
          setError("Enter a city name, zip code, or select from AI suggestions (e.g. \"Denver, CO\" or \"80202\")");
          return;
        }
      }
    }

    setLoading(true);
    setError("");
    setReport("");
    setCached(false);
    setShowSuggestions(false);

    // Build the request body — zip-only or city+state (+optional zip)
    const requestBody: Record<string, string> = {};
    if (city && state) {
      requestBody.city = city;
      requestBody.state = state;
      if (zip) requestBody.zip = zip;
    } else if (zip) {
      requestBody.zip = zip;
    }

    try {
      const res = await fetch("/api/weather", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      setReport(data.report);
      setCached(data.cached);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  // Highlight matching text in suggestions
  function highlightMatch(text: string, q: string) {
    if (!q) return text;
    const lower = text.toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="font-semibold text-blue-600 dark:text-blue-400">
          {text.slice(idx, idx + q.length)}
        </span>
        {text.slice(idx + q.length)}
      </>
    );
  }

  // Parse weather sections for styled display
  function renderWeatherReport(text: string) {
    const sectionIcons: Record<string, string> = {
      "CURRENT CONDITIONS": "🌡️",
      "TODAY'S DETAILS": "📅",
      "5-DAY FORECAST": "📆",
      "WEATHER ALERTS": "⚠️",
      "WHAT TO KNOW": "💡",
    };

    const sections = text.split(/\n(?=[A-Z]{2,}[\s\w'-]*\n)/);

    return sections.map((section, i) => {
      const lines = section.trim().split("\n");
      const header = lines[0]?.trim();
      const isSection = Object.keys(sectionIcons).some(
        (key) => header.toUpperCase().includes(key)
      );

      if (isSection) {
        const icon = Object.entries(sectionIcons).find(
          ([key]) => header.toUpperCase().includes(key)
        )?.[1] || "📋";
        const body = lines.slice(1).join("\n").trim();

        return (
          <div key={i} className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">{icon}</span>
              <h3 className="text-sm font-bold uppercase tracking-wider text-blue-700 dark:text-blue-400">
                {header}
              </h3>
            </div>
            <div className="text-gray-700 dark:text-gray-300 whitespace-pre-line leading-relaxed pl-7 text-sm">
              {body}
            </div>
          </div>
        );
      }

      return (
        <div key={i} className="text-gray-700 dark:text-gray-300 whitespace-pre-line leading-relaxed text-sm mb-3">
          {section.trim()}
        </div>
      );
    });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-100 dark:from-gray-900 dark:via-gray-850 dark:to-gray-800 flex items-start justify-center p-4 pt-12 sm:pt-20">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🌤️</div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Weather GPT
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            AI-powered weather reports for any US city
          </p>
        </div>

        {/* Search Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-5 mb-6"
        >
          <div className="relative">
            <div className="flex gap-3">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  {suggestLoading ? (
                    <svg className="animate-spin h-4 w-4 text-blue-500" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  )}
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="City name or zip code..."
                  value={query}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onFocus={() => {
                    if (suggestions.length > 0) setShowSuggestions(true);
                  }}
                  onKeyDown={handleKeyDown}
                  autoComplete="off"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />

                {/* AI Autocomplete Dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                  <div
                    ref={suggestionsRef}
                    className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl overflow-hidden max-h-64 overflow-y-auto"
                  >
                    <div className="px-3 py-1.5 text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider border-b border-gray-100 dark:border-gray-600 flex items-center gap-1.5">
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      AI suggestions
                    </div>
                    {suggestions.map((city, i) => (
                      <button
                        key={city + i}
                        type="button"
                        onClick={() => selectCity(city)}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-3 cursor-pointer ${
                          i === highlightIndex
                            ? "bg-blue-50 dark:bg-blue-900/30 text-blue-900 dark:text-blue-200"
                            : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600"
                        }`}
                      >
                        <svg className="h-4 w-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span>{highlightMatch(city, query)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 dark:disabled:bg-blue-800 text-white font-medium rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 cursor-pointer disabled:cursor-not-allowed flex items-center gap-2 text-sm whitespace-nowrap"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Fetching...
                  </>
                ) : (
                  "Get Weather"
                )}
              </button>
            </div>

            {/* Selected city indicator */}
            {(selectedCity && selectedState || selectedZip) && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {selectedCity && selectedState
                  ? `${selectedCity}, ${selectedState}${selectedZip ? ` ${selectedZip}` : ""}`
                  : `Zip ${selectedZip}`} selected
              </div>
            )}
          </div>
        </form>

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-2xl p-4 mb-6 text-sm">
            {error}
          </div>
        )}

        {/* Loading Skeleton */}
        {loading && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 mb-6 animate-pulse">
            <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-6" />
            {[...Array(5)].map((_, i) => (
              <div key={i} className="mb-5">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-3" />
                <div className="space-y-2 pl-7">
                  <div className="h-3 bg-gray-100 dark:bg-gray-700/50 rounded w-full" />
                  <div className="h-3 bg-gray-100 dark:bg-gray-700/50 rounded w-5/6" />
                  <div className="h-3 bg-gray-100 dark:bg-gray-700/50 rounded w-4/6" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Weather Report */}
        {report && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6">
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-gray-100 dark:border-gray-700">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                📍 {selectedCity && selectedState
                  ? `${selectedCity}, ${selectedState}${selectedZip ? ` ${selectedZip}` : ""}`
                  : selectedZip
                    ? `Zip Code ${selectedZip}`
                    : query}
              </h2>
              <div className="flex items-center gap-2">
                {cached && (
                  <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-full">
                    cached
                  </span>
                )}
                <span className="text-xs text-gray-400">
                  {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
            {renderWeatherReport(report)}
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-8">
          Powered by OpenRouter + GPT-4.1 Nano
        </p>
      </div>
    </div>
  );
}
