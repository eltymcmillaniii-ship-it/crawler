import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import './encounters.css'

type DisplayEnemy = {
  id: string
  name: string
  level: number
  kind: 'mob' | 'boss'
  entrance: string
  imageUrl: string
}

type DisplayResponse = {
  unchanged?: boolean
  revealId?: string
  enemy?: DisplayEnemy | null
  idleImageUrl?: string | null
  error?: string
}

type RevealStage = 'idle' | 'warning' | 'scan' | 'title' | 'impact' | 'details'

export function EncounterDisplay({ token }: { token: string }) {
  const [enemy, setEnemy] = useState<DisplayEnemy | null>(null)
  const [stage, setStage] = useState<RevealStage>('idle')
  const [error, setError] = useState('')
  const [idleImageUrl, setIdleImageUrl] = useState<string | null>(null)
  const revealId = useRef('')
  const enemyId = useRef('')
  const timers = useRef<number[]>([])
  const mounted = useRef(true)

  function clearTimers() {
    for (const timer of timers.current) window.clearTimeout(timer)
    timers.current = []
  }

  function play(next: DisplayEnemy) {
    clearTimers()
    setEnemy(next)
    setStage('warning')
    timers.current.push(window.setTimeout(() => setStage('scan'), 1050))
    timers.current.push(window.setTimeout(() => setStage('title'), 2550))
    timers.current.push(window.setTimeout(() => setStage('impact'), 3850))
    timers.current.push(window.setTimeout(() => setStage('details'), 5100))
  }

  useEffect(() => {
    mounted.current = true
    let fetching = false
    let interval = 0

    async function poll(force = false) {
      if (!supabase || fetching) return
      fetching = true
      try {
        const { data, error: invokeError } = await supabase.functions.invoke<DisplayResponse>('encounter-display', {
          body: {
            token,
            knownRevealId: force ? '' : revealId.current,
            knownEnemyId: force ? '' : enemyId.current,
          },
        })
        if (!mounted.current) return
        if (invokeError) throw invokeError
        if (data?.error) throw new Error(data.error)
        setError('')
        if (!data || data.unchanged) return
        revealId.current = data.revealId ?? ''
        setIdleImageUrl(data.idleImageUrl ?? null)
        if (!data.enemy) {
          enemyId.current = ''
          clearTimers()
          setEnemy(null)
          setStage('idle')
          return
        }
        enemyId.current = data.enemy.id
        play(data.enemy)
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : 'Player screen is reconnecting.')
      } finally {
        fetching = false
      }
    }

    void poll(true)
    interval = window.setInterval(() => void poll(), 1200)
    const refreshSignedUrl = window.setInterval(() => void poll(true), 45 * 60 * 1000)
    return () => {
      mounted.current = false
      window.clearInterval(interval)
      window.clearInterval(refreshSignedUrl)
      clearTimers()
    }
  }, [token])

  return <main className={`encounter-display-screen reveal-stage-${stage} ${enemy?.kind === 'boss' ? 'is-boss' : ''}`}>
    <div className="display-scanlines" aria-hidden="true" />
    <div className="display-vignette" aria-hidden="true" />

    {!enemy ? <section className="display-idle">
      {idleImageUrl && <img className="display-idle-image" src={idleImageUrl} alt="" aria-hidden="true" />}
      <div className="display-idle-shade" aria-hidden="true" />
      <div className="display-idle-content">
        <div className="display-kicker">DUNGEON NETWORK // PLAYER DISPLAY</div>
        <div className="display-idle-mark" aria-hidden="true">&#9670;</div>
        <h1>AWAITING HOSTILE</h1>
        <p>The Dungeon will decide when you are allowed to be concerned.</p>
        {error && <div className="display-error">{error}</div>}
      </div>
    </section> : <>
      <img className="enemy-reveal-image" src={enemy.imageUrl} alt={enemy.name} />
      <div className="enemy-reveal-shade" aria-hidden="true" />

      <section className="reveal-warning-card">
        <div className="warning-symbol">!</div>
        <div className="display-kicker">DUNGEON THREAT SYSTEM</div>
        <h1>{enemy.kind === 'boss' ? 'BOSS PRESENCE CONFIRMED' : 'HOSTILE ENTITY DETECTED'}</h1>
        <div className="warning-pulse"><span /><span /><span /></div>
      </section>

      <section className="reveal-scan-card">
        <div className="display-kicker">ENTITY SCAN // LEVEL AUTHENTICATED</div>
        <div className="reveal-level">LEVEL {enemy.level}</div>
        <div className="reveal-classification">{enemy.kind === 'boss' ? 'BOSS-CLASS HOSTILE' : 'MOB-CLASS HOSTILE'}</div>
        <div className="scan-progress"><span /></div>
      </section>

      <section className="reveal-title-card">
        <div className="display-kicker">DUNGEON IDENTIFICATION COMPLETE</div>
        <h1>{enemy.name}</h1>
        <div className="reveal-title-meta">LEVEL {enemy.level} // {enemy.kind.toUpperCase()}</div>
      </section>

      <div className="reveal-impact-flash" aria-hidden="true" />

      <section className="reveal-details-card">
        <div className="reveal-details-meta"><span>{enemy.kind === 'boss' ? 'BOSS' : 'HOSTILE'}</span><strong>LEVEL {enemy.level}</strong></div>
        <h1>{enemy.name}</h1>
        {enemy.entrance && <p>{enemy.entrance}</p>}
      </section>
    </>}

    {error && enemy && <div className="display-reconnect">RECONNECTING TO DUNGEON NETWORK...</div>}
  </main>
}
