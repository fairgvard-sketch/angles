import { createClient } from '@supabase/supabase-js'
import { cleanAuthUrl, createAccountSession, readAuthCallback, updatePasswordWithSession } from './account-session'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

// Capture only callback type/error flags before the SDK consumes the fragment.
const callback = typeof window === 'undefined' ? {} : readAuthCallback(window.location.href)

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'implicit',
      },
    })
  : null

let recoveryStorage
try { recoveryStorage = window.sessionStorage } catch { /* unavailable during SSR or blocked by the browser */ }

export const accountSession = supabase ? createAccountSession(supabase, {
  callback,
  storage: recoveryStorage,
  cleanUrl: (finish) => {
    window.history.replaceState(window.history.state, '', cleanAuthUrl(window.location.href, { finish }))
  },
  updatePasswordForSession: (session, password) => updatePasswordWithSession(() => createClient(url, anonKey, {
    auth: {
      persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
      storageKey: 'angle-password-reset-operation',
    },
  }), session, password),
}) : null

// Register before the SDK's asynchronous initialization emits PASSWORD_RECOVERY.
// React mount timing / StrictMode must not make us miss a one-off recovery event.
accountSession?.start()
if (import.meta.hot) import.meta.hot.dispose(() => accountSession?.stop())
