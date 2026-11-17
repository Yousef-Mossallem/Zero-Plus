// frontend/src/i18n/i18next.d.ts
// تعريفات TypeScript: المحرر يقترح أسماء المفاتيح ويحذّر من الغلط.
// en هو المرجع. لما تضيف ملف قسم جديد ضيفه هنا كمان.

import 'i18next'

import type common from '../locales/en/common.json'
import type auth from '../locales/en/auth.json'
import type errors from '../locales/en/errors.json'
import type nav from '../locales/en/nav.json'
import type landing from '../locales/en/landing.json'
import type contact from '../locales/en/contact.json'
import type legal from '../locales/en/legal.json'
import type events from '../locales/en/events.json'
import type servers from '../locales/en/servers.json'
import type policies from '../locales/en/policies.json'
import type reputation from '../locales/en/reputation.json'
import type dashboard from '../locales/en/dashboard.json'
import type notifications from '../locales/en/notifications.json'
import type reports from '../locales/en/reports.json'
import type simulation from '../locales/en/simulation.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof common
      auth: typeof auth
      errors: typeof errors
      nav: typeof nav
      landing: typeof landing
      contact: typeof contact
      legal: typeof legal
      events: typeof events
      servers: typeof servers
      policies: typeof policies
      reputation: typeof reputation
      dashboard: typeof dashboard
      notifications: typeof notifications
      reports: typeof reports
      simulation: typeof simulation
    }
  }
}
