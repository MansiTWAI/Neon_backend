/**
 * The two language models the design assistant can use. Each is asked to call one function,
 * `propose_design`, and returns that call's arguments unchecked; the caller validates them.
 */

export interface DesignRequest {
  system: string;
  prompt: string;
  /** JSON schema of the function's arguments. */
  schema: Record<string, unknown>;
}

export interface DesignModel {
  readonly name: string;
  propose(request: DesignRequest): Promise<unknown>;
}

const TOOL_NAME = 'propose_design';
const TOOL_DESCRIPTION = 'Propose one neon sign design for the studio.';
const TIMEOUT_MS = 30_000;

/** The model refused, timed out or is overloaded. The message is safe to log: it never holds the prompt. */
export class ModelUnavailable extends Error {}

export class ClaudeModel implements DesignModel {
  readonly name = 'claude';

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async propose({ system, prompt, schema }: DesignRequest): Promise<unknown> {
    const response = await post('https://api.anthropic.com/v1/messages', {
      headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' },
      body: {
        model: this.model,
        max_tokens: 600,
        system,
        tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: schema }],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: prompt }],
      },
    });
    if (!response.ok) throw new ModelUnavailable(`Claude returned ${response.status}`);
    const body = (await response.json()) as { content?: { type: string; input?: unknown }[] };
    return body.content?.find((block) => block.type === 'tool_use')?.input;
  }
}

export class GeminiModel implements DesignModel {
  readonly name = 'gemini';

  /** `models` are tried in order, moving on when one is overloaded or retired. */
  constructor(
    private readonly apiKey: string,
    private readonly models: string[],
  ) {}

  async propose({ system, prompt, schema }: DesignRequest): Promise<unknown> {
    let last = 'no model configured';
    for (const model of this.models) {
      const response = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          headers: { 'x-goog-api-key': this.apiKey },
          body: {
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            tools: [
              {
                functionDeclarations: [
                  { name: TOOL_NAME, description: TOOL_DESCRIPTION, parameters: forGemini(schema) },
                ],
              },
            ],
            toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [TOOL_NAME] } },
          },
        },
      );
      if (response.ok) {
        const body = (await response.json()) as {
          candidates?: { content?: { parts?: { functionCall?: { name: string; args?: unknown } }[] } }[];
        };
        return body.candidates?.[0]?.content?.parts?.find((part) => part.functionCall?.name === TOOL_NAME)
          ?.functionCall?.args;
      }
      last = `${model} returned ${response.status}`;
      // Busy, rate limited or no longer offered: the next model may answer. Anything else will not.
      if (![404, 429, 500, 503].includes(response.status)) break;
    }
    throw new ModelUnavailable(`Gemini: ${last}`);
  }
}

async function post(url: string, { headers, body }: { headers: Record<string, string>; body: unknown }) {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ModelUnavailable(`request failed: ${(error as Error).name}`);
  }
}

/** Gemini accepts a subset of JSON schema; string length limits are left to our own validation. */
function forGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(forGemini);
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => key !== 'maxLength')
      .map(([key, value]) => [key, forGemini(value)]),
  );
}
