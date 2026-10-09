import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env';
import { ClaudeModel, DesignModel, GeminiModel } from './design-models';

/** Gemini when its key is set, otherwise Claude; null with neither. `geminiModels` overrides GEMINI_MODELS. */
export function languageModelFrom(
  config: ConfigService<Env, true>,
  geminiModels?: string[],
): DesignModel | null {
  const gemini = config.get('GEMINI_API_KEY', { infer: true });
  const claude = config.get('ANTHROPIC_API_KEY', { infer: true });
  if (gemini)
    return new GeminiModel(gemini, [
      ...new Set(geminiModels ?? config.get('GEMINI_MODELS', { infer: true })),
    ]);
  if (claude) return new ClaudeModel(claude, config.get('ANTHROPIC_MODEL', { infer: true }));
  return null;
}
