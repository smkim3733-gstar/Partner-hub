export type AnthropicRuntimePolicyEnvironment = {
  ANTHROPIC_EXTERNAL_PROCESSING_ENABLED?: string;
};

export function isAnthropicExternalProcessingEnabled(
  runtime: AnthropicRuntimePolicyEnvironment,
) {
  return runtime.ANTHROPIC_EXTERNAL_PROCESSING_ENABLED === 'true';
}
