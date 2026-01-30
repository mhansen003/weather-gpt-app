import { NextRequest, NextResponse } from "next/server";

// Cache AI suggestions for 24 hours (city names don't change)
const cache = new Map<string, { data: string[]; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  // Check cache
  const cacheKey = q.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({ suggestions: cached.data });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === "your_openrouter_api_key_here") {
    return NextResponse.json({ suggestions: [] });
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://weather-gpt-app.vercel.app",
        "X-Title": "Weather GPT App",
      },
      body: JSON.stringify({
        model: "openai/gpt-4.1-nano",
        messages: [
          {
            role: "system",
            content: `You are a US location autocomplete engine. Given a partial search query, suggest up to 6 matching US locations. The query can be:
- A partial city name (e.g. "den" -> Denver, CO)
- A US zip code or partial zip code (e.g. "80202" -> Denver, CO 80202, "902" -> Los Angeles, CA 90201)
- A state name or abbreviation (e.g. "texas" -> Houston, TX; Dallas, TX; etc.)
- Natural language (e.g. "beach town florida")

Rules:
- Cities that START with the query get highest priority
- Popular/well-known cities first
- Include cities from different states when the name is common (e.g. Portland OR, Portland ME)
- If the input is a zip code (all digits), resolve it to the city and include the zip

Respond with ONLY a JSON array of strings. Format each entry as:
- For city matches: "City, ST"
- For zip code matches: "City, ST ZIPCODE"
Examples: ["Denver, CO", "Denver, CO 80202", "Detroit, MI"]

IMPORTANT: Return ONLY the JSON array. No explanation, no markdown, no extra text.`,
          },
          {
            role: "user",
            content: q,
          },
        ],
        max_tokens: 150,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return NextResponse.json({ suggestions: [] });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!content) {
      return NextResponse.json({ suggestions: [] });
    }

    // Parse the JSON array from the response
    // Strip markdown code fences if the model wraps the response
    const cleaned = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) {
      return NextResponse.json({ suggestions: [] });
    }

    // Validate each suggestion is "City, ST" or "City, ST ZIPCODE" format
    const suggestions = parsed
      .filter((s: unknown): s is string =>
        typeof s === "string" && /^.+,\s*[A-Z]{2}(\s+\d{5})?$/.test(s)
      )
      .slice(0, 6);

    // Cache it
    cache.set(cacheKey, { data: suggestions, timestamp: Date.now() });

    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
