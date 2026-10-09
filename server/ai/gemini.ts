/**
 * Thin server-side Gemini client (REST, no SDK).
 * The API key never leaves the server process.
 */
export interface TextModel {
  readonly model: string;
  generate(input: { system: string; prompt: string; signal?: AbortSignal }): Promise<string>;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function createGeminiModel(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): TextModel {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  return {
    model,
    async generate({ system, prompt, signal }) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.9, topP: 0.95, maxOutputTokens: 1024 },
        }),
        signal,
      });
      if (!res.ok) {
        // Do not echo upstream bodies to clients; they may contain request details.
        throw new GeminiError(`Gemini HTTP ${res.status}`, res.status);
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      };
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => !p.thought && typeof p.text === 'string')
        .map((p) => p.text)
        .join(' ')
        .trim();
      if (!text) throw new GeminiError('Empty response');
      return text;
    },
  };
}
