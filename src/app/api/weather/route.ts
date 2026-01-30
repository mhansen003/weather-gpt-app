import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"
]);

const requestSchema = z.object({
  city: z.string().min(1).max(100),
  state: z.string().transform((s) => s.toUpperCase()).pipe(
    z.string().refine((s) => US_STATES.has(s), "Invalid US state code")
  ),
});

// Simple in-memory cache (15-minute TTL)
const cache = new Map<string, { data: string; timestamp: number }>();
const CACHE_TTL = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { city, state } = requestSchema.parse(body);

    // Check cache
    const cacheKey = `${city.toLowerCase()}-${state}`;
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
        model: "openai/chatgpt-4o-latest",
        messages: [
          {
            role: "system",
            content: `You are a helpful weather assistant. When given a US city and state, provide a concise current weather report. Include:
- Current temperature (Fahrenheit)
- Weather conditions (sunny, cloudy, rain, etc.)
- Humidity percentage
- Wind speed and direction
- High and low for the day
- A brief 3-day forecast outlook

Format your response in clean, readable sections. Use simple headers like "Current Conditions", "Today's Range", and "3-Day Outlook". Keep it concise and informative. Do NOT use markdown headers (#). Use plain text with line breaks.`,
          },
          {
            role: "user",
            content: `What's the current weather in ${city}, ${state}?`,
          },
        ],
        max_tokens: 500,
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
        { error: "Invalid input. Please provide a valid city name and 2-letter state code." },
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
