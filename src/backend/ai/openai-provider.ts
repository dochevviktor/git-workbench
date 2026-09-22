import { z } from 'zod';
import { ExpectedBackendError } from '../errors';
import { aiResultSchema } from '../../common/ipc/ai';

export interface AiProvider {
  generate(
    key: string,
    model: string,
    instructions: string,
    material: string,
    signal: AbortSignal,
  ): Promise<string>;
}

const responseSchema = z.object({
  status: z.literal('completed'),
  output: z
    .array(
      z.object({
        type: z.string(),
        role: z.string().optional(),
        content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
      }),
    )
    .max(100),
});

/** No tools, URL input, conversation, response persistence, redirects or automatic retries. */
export class OpenAiProvider implements AiProvider {
  constructor(private readonly transport: typeof fetch = (url, init) => fetch(url, init)) {}
  async generate(key: string, model: string, instructions: string, material: string, signal: AbortSignal) {
    try {
      const response = await this.transport('https://api.openai.com/v1/responses', {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          instructions,
          input: material,
          store: false,
          tools: [],
          max_output_tokens: 4096,
        }),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        const message =
          response.status === 401 || response.status === 403
            ? 'OpenAI denied access. Replace the API key and check project permissions.'
            : response.status === 429
              ? 'OpenAI quota or rate limit reached. Check billing or wait before sending again.'
              : response.status === 400 || response.status === 404
                ? 'OpenAI rejected the model or request. Configure a text model available to your project.'
                : 'OpenAI could not complete the request. No automatic retry was made.';
        throw new ExpectedBackendError('UNAVAILABLE', message);
      }
      if (!response.body) throw new Error('Empty response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 512 * 1024) throw new Error('Response limit');
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const parsed = responseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const text = parsed.output
        .filter((item) => item.type === 'message' && item.role === 'assistant')
        .flatMap((item) => item.content ?? [])
        .filter((part) => part.type === 'output_text')
        .map((part) => part.text ?? '')
        .join('\n')
        .trim();
      // A malicious/erroneous service response must never echo the configured credential into IPC.
      return aiResultSchema.parse({ text: text.replaceAll(key, '[redacted]') }).text;
    } catch (error) {
      if (error instanceof ExpectedBackendError) throw error;
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        signal.aborted
          ? 'The AI request was cancelled or timed out. Cancellation cannot recall data already sent.'
          : 'OpenAI is unavailable or returned an incomplete, invalid or oversized response.',
      );
    }
  }
}
