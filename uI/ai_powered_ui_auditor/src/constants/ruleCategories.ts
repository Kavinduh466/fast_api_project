/** Profiles passed to POST /audit/smart as `profile_form` (same as AI Audit upload flow). */
export const RULE_CATEGORIES: {
  label: string
  value: string
  icon: string
  description: string
}[] = [
  { label: 'Universal', value: 'universal', icon: '🌐', description: 'WCAG + general UX principles' },
  { label: 'Apple / iOS', value: 'apple', icon: '🍎', description: 'Apple Human Interface Guidelines' },
  { label: 'Google / Android', value: 'google', icon: '🤖', description: 'Material Design 3 rules' },
  { label: 'Android', value: 'android', icon: '📱', description: 'Android developer guidelines (48dp targets)' },
  { label: 'Microsoft Fluent', value: 'microsoft', icon: '🪟', description: 'Windows 11 Fluent Design System' },
  { label: 'Web Standards', value: 'web', icon: '💻', description: 'HTML5 / WCAG 2.2 web rules' },
  { label: 'Healthcare', value: 'healthcare', icon: '🏥', description: 'HIPAA, readability, clinical safety' },
  { label: 'E-commerce', value: 'ecommerce', icon: '🛍️', description: 'Checkout flow, CTAs, mobile commerce' },
  { label: 'Gaming', value: 'gaming', icon: '🎮', description: 'HUD clarity, feedback, onboarding' },
  { label: 'Enterprise / B2B', value: 'enterprise', icon: '🏢', description: 'Data density, workflows, audit trails' },
  { label: 'All Rules', value: 'all', icon: '📚', description: 'Every rule from every category' },
]
