import { z } from 'zod';
import { aiResultSchema } from '../../common/ipc/ai';
import { ExpectedBackendError } from '../errors';
import type { AiProvider } from './openai-provider';
import { readAiResponse } from './openai-provider';

/** An explicitly configured local daemon; never downloads models or follows redirects. */
export class OllamaProvider implements AiProvider {
  constructor(private readonly transport: typeof fetch = (url, init) => fetch(url, init)) {}
  async generate(_key: string, model: string, instructions: string, material: string, signal: AbortSignal) {
    try {
      const post = async (path: string, body: unknown) => {
        const response = await this.transport(`http://127.0.0.1:11434/api/${path}`, {
          method: 'POST',
          redirect: 'error',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error('Local model unavailable');
        }
        return readAiResponse(response);
      };
      const metadata = z
        .object({ remote_model: z.string().optional(), remote_host: z.string().optional() })
        .parse(await post('show', { model }));
      if (metadata.remote_model || metadata.remote_host || /(?:-cloud|:cloud)(?:$|:)/iu.test(model))
        throw new ExpectedBackendError(
          'UNAVAILABLE',
          'Choose a locally installed Ollama model. Cloud models are not supported by the local adapter.',
        );
      const result = z
        .object({
          done: z.literal(true),
          message: z.object({
            role: z.literal('assistant'),
            content: z.string(),
            tool_calls: z.array(z.unknown()).max(0).optional(),
          }),
        })
        .parse(
          await post('chat', {
            model,
            stream: false,
            think: false,
            keep_alive: 0,
            messages: [
              { role: 'system', content: instructions },
              { role: 'user', content: material },
            ],
            tools: [],
            options: { num_predict: 4096 },
          }),
        );
      return aiResultSchema.parse({ text: result.message.content.trim() }).text;
    } catch (error) {
      if (error instanceof ExpectedBackendError) throw error;
      throw new ExpectedBackendError(
        'UNAVAILABLE',
        signal.aborted
          ? 'The local AI request was cancelled or timed out.'
          : 'Ollama is unavailable or returned an invalid response. Start the local server on port 11434 and install the selected model first.',
      );
    }
  }
}
