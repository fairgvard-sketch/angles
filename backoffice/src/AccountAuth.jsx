import { useEffect, useRef, useState } from 'react'
import { Brand } from './ui/AppShell'
import { authErrorMessage, authRedirectUrl, validateNewPassword } from './account-session'

export function AccountFrame({ title, intro, children }) {
  return (
    <div className="auth-shell">
      <header className="auth-header"><Brand /></header>
      <main className="auth-main">
        <section className="auth-panel" aria-labelledby="account-title">
          <p className="eyebrow">BACK OFFICE</p>
          <h1 id="account-title">{title}</h1>
          {intro && <p className="auth-intro">{intro}</p>}
          {children}
        </section>
      </main>
    </div>
  )
}

function useAuthAction(initialError = '') {
  const mounted = useRef(false)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(initialError)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function run(action) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await action(() => mounted.current)
    } catch (error) {
      if (mounted.current) setError(authErrorMessage(error))
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

const EMAIL_NOTICE = 'If this email belongs to an account, you will receive a reset link. Check your inbox and spam folder.'
const CONFIRM_NOTICE = 'If this address needs confirmation, check your inbox and spam folder. If you already have an account, sign in or reset your password.'

export function AuthEntry({ client, initialMode = 'signin', initialError = '', onBack }) {
  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')
  const action = useAuthAction(initialError)
  const signup = mode === 'signup'
  const hasPassword = mode === 'signin' || signup

  function changeMode(next) {
    if (action.busy) return
    if (next === 'signin' && onBack) { void action.run(() => onBack()); return }
    setMode(next)
    setPassword('')
    setNotice('')
    action.setError('')
  }

  function submit(event) {
    event.preventDefault()
    void action.run(async (isMounted) => {
      setNotice('')
      const address = email.trim()
      const redirect = (kind) => authRedirectUrl(window.location.href, kind)
      let result
      if (mode === 'signin') result = await client.auth.signInWithPassword({ email: address, password })
      else if (signup) result = await client.auth.signUp({ email: address, password, options: { emailRedirectTo: redirect('confirm') } })
      else if (mode === 'reset') result = await client.auth.resetPasswordForEmail(address, { redirectTo: redirect('recovery') })
      else result = await client.auth.resend({ type: 'signup', email: address, options: { emailRedirectTo: redirect('confirm') } })
      if (!isMounted()) return
      // Don't disclose whether a recovery/confirmation email is registered.
      if (result.error && !(!hasPassword && ['user_not_found', 'email_not_found'].includes(result.error.code))) throw result.error
      if (mode === 'reset') setNotice(EMAIL_NOTICE)
      else if (mode === 'confirm' || (signup && !result.data?.session)) {
        setPassword('')
        setMode('confirm')
        setNotice(CONFIRM_NOTICE)
      }
    })
  }

  const title = { signin: 'Sign in', signup: 'Create account', reset: 'Reset your password', confirm: 'Confirm your email' }[mode]
  return (
    <AccountFrame title={title} intro={signup
      ? 'Publish a menu, take orders and reservations — no terminal required.'
      : mode === 'reset' ? 'We will send a link to set a new password.'
        : mode === 'confirm' ? 'Open the confirmation email to activate your account, or request another email below.'
          : 'Manage your locations, team and online channels.'}>
      <form onSubmit={submit} className="auth-form" aria-busy={action.busy}>
        <label><span>Email</span><input type="email" autoComplete="email" value={email}
          onChange={(event) => setEmail(event.target.value)} required disabled={action.busy} /></label>
        {hasPassword && <label><span>Password</span><input type="password"
          autoComplete={signup ? 'new-password' : 'current-password'} value={password}
          onChange={(event) => setPassword(event.target.value)} required
          minLength={signup ? 8 : undefined} disabled={action.busy} /></label>}
        {signup && <p className="form-hint">Use at least 8 characters.</p>}
        {action.error && <p className="form-error" role="alert">{action.error}</p>}
        {notice && <p className="form-hint" role="status">{notice}</p>}
        <button className="primary-button" type="submit" disabled={action.busy}>
          {action.busy ? 'Please wait…' : mode === 'reset' ? 'Send reset link' : mode === 'confirm' ? 'Resend confirmation' : 'Continue'}
        </button>
      </form>
      <nav className="auth-actions" aria-label="Account options">
        {mode !== 'signin' && <button type="button" className="text-button" disabled={action.busy} onClick={() => changeMode('signin')}>Back to sign in</button>}
        {mode === 'signin' && <button type="button" className="text-button" disabled={action.busy} onClick={() => changeMode('signup')}>Create an account</button>}
        {mode !== 'reset' && <button type="button" className="text-button" disabled={action.busy} onClick={() => changeMode('reset')}>Forgot password?</button>}
        {mode === 'signin' && <button type="button" className="text-button" disabled={action.busy} onClick={() => changeMode('confirm')}>Resend confirmation email</button>}
      </nav>
    </AccountFrame>
  )
}

export function PasswordRecovery({ session, controller }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const action = useAuthAction()
  function submit(event) {
    event.preventDefault()
    const invalid = validateNewPassword(password, confirmation)
    if (invalid) { action.setError(invalid); return }
    void action.run(() => controller.updatePassword(password))
  }
  return (
    <AccountFrame title="Set a new password" intro={`Resetting access for ${session.user.email || 'your account'}.`}>
      <form className="auth-form" onSubmit={submit} aria-busy={action.busy}>
        <label><span>New password</span><input type="password" autoComplete="new-password" minLength={8}
          required value={password} disabled={action.busy} onChange={(e) => setPassword(e.target.value)} /></label>
        <label><span>Confirm new password</span><input type="password" autoComplete="new-password" minLength={8}
          required value={confirmation} disabled={action.busy} onChange={(e) => setConfirmation(e.target.value)} /></label>
        <p className="form-hint">Use at least 8 characters. This reset form is available for 15 minutes.</p>
        {action.error && <p className="form-error" role="alert">{action.error}</p>}
        <button className="primary-button" type="submit" disabled={action.busy}>{action.busy ? 'Saving…' : 'Save new password'}</button>
      </form>
      <div className="auth-actions"><button type="button" className="text-button" disabled={action.busy}
        onClick={() => controller.signOut()}>Cancel and sign out</button></div>
    </AccountFrame>
  )
}

export function AccountProblem({ state, controller, client }) {
  if (state.status === 'recovery-error') return (
    <AuthEntry client={client} initialMode={state.callbackMode === 'confirm' ? 'confirm' : 'reset'}
      initialError={state.error || 'This email link is invalid, expired, or no longer matches your session. Request a new email below.'}
      onBack={controller.signOut} />
  )
  return (
    <AccountFrame title="Unable to open your workspace" intro={state.error}>
      <div className="auth-form">
        <button className="primary-button" type="button" onClick={() => controller.retry()}>Try again</button>
        <button className="text-button" type="button" onClick={() => controller.signOut()}>Sign out</button>
      </div>
    </AccountFrame>
  )
}
