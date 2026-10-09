import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env';
import { ClaudeModel, DesignModel, GeminiModel } from './design-models';

/** Gemini when its key is set, otherwise Claude; null with neither. */
export function languageModelFrom(config: ConfigService<Env, true>): DesignModel | null {
  const gemini = config.get('GEMINI_API_KEY', { infer: true });
  const claude = config.get('ANTHROPIC_API_KEY', { infer: true });
  if (gemini) return new GeminiModel(gemini, config.get('GEMINI_MODELS', { infer: true }));
  if (claude) return new ClaudeModel(claude, config.get('ANTHROPIC_MODEL', { infer: true }));
  return null;
}
