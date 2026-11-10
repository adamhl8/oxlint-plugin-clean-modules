import type { Context } from "@oxlint/plugins"

/** Returns a rule's options object, or an empty one when the rule wasn't given options. */
export const getOptionsObject = (options: Context["options"]): Record<string, unknown> => {
  const [ruleOptions] = options
  const isOptionsObject = typeof ruleOptions === "object" && ruleOptions !== null && !Array.isArray(ruleOptions)
  return isOptionsObject ? ruleOptions : {}
}
