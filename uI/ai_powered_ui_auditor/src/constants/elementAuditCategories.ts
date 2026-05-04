/**
 * Categories exposed by the UI Element Auditor dropdown.
 *
 * The `value` is sent as the `category` form field to POST /audit and
 * matched (case/separator-insensitive) against the Expert_Library/<folder>/…
 * prefix inside image_paths.txt.  Keeping `value` identical to the real
 * folder names means the backend match is trivial and robust.
 *
 * "universal" is a special sentinel that disables filtering and searches
 * the whole FAISS index (legacy behaviour).
 */
export interface ElementAuditCategory {
  label: string
  value: string
  icon: string
  description: string
}

export const ELEMENT_AUDIT_CATEGORIES: ElementAuditCategory[] = [
  { label: 'Universal (all categories)', value: 'universal', icon: '🌐',
    description: 'Match against every expert UI in the library' },

  { label: 'Web / General',        value: 'Web_General',            icon: '💻', description: 'Web apps, dashboards, SaaS tools' },
  { label: 'Business',             value: 'Business',               icon: '🏢', description: 'CRM, workflow, admin consoles' },
  { label: 'Finance',              value: 'Finance',                icon: '💰', description: 'Banking, payments, investing apps' },
  { label: 'Shopping / E-commerce', value: 'Shopping',              icon: '🛍️', description: 'Storefronts, carts, checkout' },
  { label: 'Communication',        value: 'Communication',          icon: '💬', description: 'Chat, mail, calling apps' },
  { label: 'Social',               value: 'Social',                 icon: '🧑‍🤝‍🧑', description: 'Social networks, feeds, profiles' },
  { label: 'Education',            value: 'Education',              icon: '🎓', description: 'Learning, courses, classroom tools' },
  { label: 'Medical',              value: 'Medical',                icon: '🏥', description: 'Clinical, patient-facing healthcare UIs' },
  { label: 'Health & Fitness',     value: 'Health__Fitness',        icon: '🏃', description: 'Workout, wellness, tracking apps' },
  { label: 'Food & Drink',         value: 'Food__Drink',            icon: '🍔', description: 'Ordering, recipes, restaurants' },
  { label: 'Travel & Local',       value: 'Travel__Local',          icon: '✈️', description: 'Booking, trip planning, local guides' },
  { label: 'Maps & Navigation',    value: 'Maps__Navigation',       icon: '🗺️', description: 'Maps, directions, location apps' },
  { label: 'News & Magazines',     value: 'News__Magazines',        icon: '📰', description: 'Readers, feeds, publications' },
  { label: 'Books & Reference',    value: 'Books__Reference',       icon: '📚', description: 'Reading, dictionaries, encyclopedias' },
  { label: 'Entertainment',        value: 'Entertainment',          icon: '🎬', description: 'Streaming, tickets, pop culture' },
  { label: 'Music & Audio',        value: 'Music__Audio',           icon: '🎵', description: 'Music players, podcasts, radio' },
  { label: 'Video Players / Editors', value: 'Video_Players__Editors', icon: '🎥', description: 'Video playback and editing UIs' },
  { label: 'Sports',               value: 'Sports',                 icon: '⚽', description: 'Scores, fantasy, team apps' },
  { label: 'Dating',               value: 'Dating',                 icon: '💘', description: 'Matching, profiles, messaging' },
  { label: 'Lifestyle',            value: 'Lifestyle',              icon: '✨', description: 'General lifestyle & wellbeing' },
  { label: 'Beauty',               value: 'Beauty',                 icon: '💄', description: 'Cosmetics, skincare, salon' },
  { label: 'Art & Design',         value: 'Art__Design',            icon: '🎨', description: 'Creative tools & design apps' },
  { label: 'Comics',               value: 'Comics',                 icon: '🦸', description: 'Comic readers & collections' },
  { label: 'Parenting',            value: 'Parenting',              icon: '👶', description: 'Childcare, family, kids apps' },
  { label: 'Events',               value: 'Events',                 icon: '🎟️', description: 'Event discovery & ticketing' },
  { label: 'House & Home',         value: 'House__Home',            icon: '🏠', description: 'Real estate, interior, smart home' },
  { label: 'Auto & Vehicles',      value: 'Auto__Vehicles',         icon: '🚗', description: 'Cars, rideshare, vehicle services' },
  { label: 'Weather',              value: 'Weather',                icon: '☀️', description: 'Forecasts & weather data' },
]
