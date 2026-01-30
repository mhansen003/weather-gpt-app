import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"
]);

const cityStateSchema = z.object({
  city: z.string().min(1).max(100),
  state: z.string().transform((s) => s.toUpperCase()).pipe(
    z.string().refine((s) => US_STATES.has(s), "Invalid US state code")
  ),
  zip: z.string().optional(),
});

const zipOnlySchema = z.object({
  zip: z.string().regex(/^\d{5}$/, "Must be a 5-digit US zip code"),
});

// Simple in-memory cache (15-minute TTL)
const cache = new Map<string, { data: string; timestamp: number }>();
const CACHE_TTL = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Support both city+state and zip-only inputs
    let location: string;
    let cacheKey: string;

    if (body.zip && !body.city) {
      // Zip-only mode
      const { zip } = zipOnlySchema.parse(body);
      location = `zip code ${zip}`;
      cacheKey = `zip-${zip}`;
    } else {
      // City+state mode (may also include zip for extra precision)
      const { city, state, zip } = cityStateSchema.parse(body);
      location = zip ? `${city}, ${state} ${zip}` : `${city}, ${state}`;
      cacheKey = `${city.toLowerCase()}-${state}${zip ? `-${zip}` : ""}`;
    }

    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json({ report: cached.data, cached: true });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey || apiKey === "your_openrouter_api_key_here") {
      return NextResponse.json(
        { error: "OpenRouter API key not configured. Add OPENROUTER_API_KEY to your environment variables." },
        { status: 500 }
      );
    }

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
            content: `You are an expert weather reporter. When given a US city and state, provide a COMPREHENSIVE weather report. You MUST include ALL of the following sections with these EXACT headers:

CURRENT CONDITIONS
- Temperature (°F) and "feels like" temperature
- Weather description (e.g., partly cloudy, heavy rain, clear skies)
- Humidity percentage
- Wind speed (mph), direction, and gusts if applicable
- Visibility (miles)
- Barometric pressure (inHg) and trend (rising/falling/steady)
- Dew point (°F)
- UV Index (0-11+) with risk level (Low/Moderate/High/Very High/Extreme)

TODAY'S DETAILS
- High / Low temperatures
- Sunrise and sunset times (local time)
- Chance of precipitation (%)
- Expected rainfall/snowfall amounts if any

5-DAY FORECAST
For each of the next 5 days, include: day name, high/low, conditions, and precipitation chance.

WEATHER ALERTS
- Any active watches, warnings, or advisories. If none, say "No active alerts."

WHAT TO KNOW
- 2-3 practical tips (what to wear, outdoor activity suitability, driving conditions, allergy info, etc.)

Format with the section headers in ALL CAPS on their own line. Use line breaks between sections. Do NOT use markdown formatting, bullets, or special characters. Use plain text only.`,
          },
          {
            role: "user",
            content: `Give me a comprehensive weather report for ${location}.`,
          },
        ],
        max_tokens: 1000,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("OpenRouter error:", response.status, errorBody);
      return NextResponse.json(
        { error: `Weather service returned an error (${response.status}). Please try again.` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const report = data.choices?.[0]?.message?.content;

    if (!report) {
      return NextResponse.json(
        { error: "No weather data received. Please try again." },
        { status: 502 }
      );
    }

    // Cache the result
    cache.set(cacheKey, { data: report, timestamp: Date.now() });

    return NextResponse.json({ report, cached: false });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input. Please provide a valid city/state or a 5-digit US zip code." },
        { status: 400 }
      );
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Request timed out. The weather service is taking too long to respond." },
        { status: 504 }
      );
    }
    console.error("Weather API error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
