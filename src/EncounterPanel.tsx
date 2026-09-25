import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Crosshair, Dices, ExternalLink, Image, Plus, RefreshCw, Skull, Sparkles, Trash2, Upload, WandSparkles } from 'lucide-react'
import { supabase } from './lib/supabase'
import './encounters.css'

type EnemyAbility = { name: string; trigger: string; effect: string }
type EnemyKind = 'mob' | 'boss'
type ImageStatus = 'none' | 'generating' | 'ready' | 'error'
type Enemy = {
  id: string
  name: string
  max_hp: number
  current_hp: number
  notes: string
  level: number
  enemy_kind: EnemyKind
  abilities: EnemyAbility[]
  entrance: string
  image_status: ImageStatus
  image_error: string
  image_path: string | null
}
type GenerateResponse = { enemyId?: string; status?: string; error?: string }
type DisplayRow = { display_token: string; enemy_id: string | null; reveal_id: string; idle_image_path: string | null }

function clampLevel(value: string, fallback: number) {
  const number = Number(value)
  return Number.isInteger(number) ? Math.min(99, Math.max(1, number)) : fallback
}
function edgeMessage(error: unknown, data?: GenerateResponse | null) {
  if (data?.error) return data.error
  return error instanceof Error ? error.message : 'The Dungeon AI failed to answer.'
}

export function EncounterPanel({ gameId }: { gameId: string }) {
  const [enemies, setEnemies] = useState<Enemy[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [hp, setHp] = useState('8')
  const [quantity, setQuantity] = useState('1')
  const [notes, setNotes] = useState('')
  const [amount, setAmount] = useState('1')
  const [forgeMode, setForgeMode] = useState<'random' | 'specific'>('random')
  const [forgeKind, setForgeKind] = useState<EnemyKind>('mob')
  const [minLevel, setMinLevel] = useState('1')
  const [maxLevel, setMaxLevel] = useState('10')
  const [brief, setBrief] = useState('')
  const [status, setStatus] = useState('')
  const [display, setDisplay] = useState<DisplayRow | null>(null)
  const [displayBusy, setDisplayBusy] = useState(false)
  const [waitScreenBusy, setWaitScreenBusy] = useState(false)
  const waitScreenInput = useRef<HTMLInputElement>(null)
  const locked = useRef(false)
  const request = useRef(0)
  const maxHp = Number(hp)
  const count = Number(quantity)
  const delta = Number(amount)
  const validHp = Number.isFinite(maxHp) && maxHp >= .25 && maxHp <= 999 && Number.isInteger(maxHp * 4)
  const validCount = Number.isInteger(count) && count >= 1 && count <= 12
  const validDelta = Number.isFinite(delta) && delta >= .25 && delta <= 999 && Number.isInteger(delta * 4)
  const forgeLow = clampLevel(minLevel, 1)
  const forgeHigh = clampLevel(maxLevel, 99)
  const validForgeRange = forgeLow <= forgeHigh
  const playerScreenUrl = useMemo(() => {
    if (!display?.display_token) return ''
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''
    url.searchParams.set('encounter-display', display.display_token)
    return url.toString()
  }, [display?.display_token])

  const reload = useCallback(async () => {
    if (!supabase) throw new Error('Game connection unavailable.')
    const version = ++request.current
    const { data, error: loadError } = await supabase.from('encounter_enemies')
      .select('id,name,max_hp,current_hp,notes,level,enemy_kind,abilities,entrance,image_status,image_error,image_path').eq('game_id', gameId).order('created_at').order('id')
    if (loadError) throw loadError
    if (version === request.current) { setEnemies(data ?? []); setLoading(false) }
  }, [gameId])

  const loadDisplay = useCallback(async () => {
    if (!supabase) return
    const { data, error: displayError } = await supabase.from('encounter_displays')
      .select('display_token,enemy_id,reveal_id,idle_image_path').eq('game_id', gameId).maybeSingle()
    if (displayError) throw displayError
    if (data) { setDisplay(data as DisplayRow); return }
    const { data: created, error: createError } = await supabase.from('encounter_displays')
      .insert({ game_id: gameId }).select('display_token,enemy_id,reveal_id,idle_image_path').single()
    if (createError) throw createError
    setDisplay(created as DisplayRow)
  }, [gameId])

  useEffect(() => {
    let active = true
    const sync = () => { void reload().catch(e => { if (active) { setError(e.message); setLoading(false) } }) }
    sync()
    void loadDisplay().catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not create the player display link.') })
    const channel = supabase?.channel(`encounter-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'encounter_enemies', filter: `game_id=eq.${gameId}` }, sync)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'encounter_displays', filter: `game_id=eq.${gameId}` }, () => {
        void loadDisplay().catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not refresh the player display state.') })
      }).subscribe()
    window.addEventListener('focus', sync)
    const interval = window.setInterval(sync, 15000)
    return () => {
      active = false
      request.current++
      window.clearInterval(interval)
      window.removeEventListener('focus', sync)
      if (channel) void supabase?.removeChannel(channel)
    }
  }, [gameId, reload, loadDisplay])

  async function mutate(action: () => PromiseLike<{ error: { message: string } | null }>, onSuccess?: () => void) {
    if (locked.current) return
    locked.current = true
    setBusy(true); setError(''); setStatus('')
    try {
      const { error: saveError } = await action()
      if (saveError) throw new Error(saveError.message)
      onSuccess?.()
      await reload()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save encounter. Refresh before retrying.') }
    finally { locked.current = false; setBusy(false) }
  }

  function add() {
    if (!supabase || !name.trim() || !validHp || !validCount) return
    const rows = Array.from({ length: count }, (_, i) => ({
      game_id: gameId, name: count > 1 ? `${name.trim()} ${i + 1}` : name.trim(),
      current_hp: maxHp, max_hp: maxHp, notes: notes.trim(), level: 1, enemy_kind: 'mob', abilities: [], entrance: '', image_status: 'none', image_error: '',
    }))
    void mutate(() => supabase!.from('encounter_enemies').insert(rows), () => { setName(''); setNotes('') })
  }

  async function generate() {
    if (!supabase || !validForgeRange || (forgeMode === 'specific' && !brief.trim()) || busy) return
    setBusy(true); setError(''); setStatus('')
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<GenerateResponse>('generate-enemy', {
        body: { action: 'generate', requestId: crypto.randomUUID(), gameId, kind: forgeKind, mode: forgeMode, minLevel: forgeLow, maxLevel: forgeHigh, brief: brief.trim() },
      })
      if (invokeError || data?.error) throw new Error(edgeMessage(invokeError, data))
      await reload()
      setStatus(`${forgeKind === 'boss' ? 'Boss' : 'Mob'} generated. The Dungeon is rendering its mugshot now.`)
      if (forgeMode === 'specific') setBrief('')
    } catch (e) { setError(e instanceof Error ? e.message : 'The Dungeon could not generate that enemy.') }
    finally { setBusy(false) }
  }

  async function retryImage(enemy: Enemy) {
    if (!supabase || busy) return
    setBusy(true); setError(''); setStatus('')
    try {
      const { data, error: invokeError } = await supabase.functions.invoke<GenerateResponse>('generate-enemy', {
        body: { action: 'image', gameId, enemyId: enemy.id },
      })
      if (invokeError || data?.error) throw new Error(edgeMessage(invokeError, data))
      await reload()
      setStatus(`Rebuilding ${enemy.name}'s image.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not retry enemy art.') }
    finally { setBusy(false) }
  }

  async function reveal(enemy: Enemy) {
    if (!supabase || enemy.image_status !== 'ready' || displayBusy) return
    setDisplayBusy(true); setError(''); setStatus('')
    try {
      const { error: revealError } = await supabase.rpc('gm_reveal_enemy', { p_game_id: gameId, p_enemy_id: enemy.id })
      if (revealError) throw revealError
      await loadDisplay()
      setStatus(`${enemy.name} sent to the player screen. Enjoy the screaming.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not reveal this enemy.') }
    finally { setDisplayBusy(false) }
  }

  async function clearReveal() {
    if (!supabase || displayBusy) return
    setDisplayBusy(true); setError(''); setStatus('')
    try {
      const { error: revealError } = await supabase.rpc('gm_reveal_enemy', { p_game_id: gameId, p_enemy_id: null })
      if (revealError) throw revealError
      await loadDisplay()
      setStatus('Player screen cleared.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not clear the player screen.') }
    finally { setDisplayBusy(false) }
  }

  async function rollD20() {
    if (!supabase || displayBusy || !display) return
    setDisplayBusy(true); setError(''); setStatus('')
    try {
      const { data, error: rollError } = await supabase.rpc('gm_roll_d20', { p_game_id: gameId })
      if (rollError) throw rollError
      const result = Number(data)
      const label = result === 20 ? 'NATURAL 20' : result === 1 ? 'NATURAL 1' : String(result)
      setStatus(`D20 rolled: ${label}. Sent to the player screen.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not roll the D20.') }
    finally { setDisplayBusy(false) }
  }

  async function uploadWaitScreen(file: File) {
    if (!supabase || !display || waitScreenBusy) return
    const allowed = new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp']])
    const extension = allowed.get(file.type)
    if (!extension) { setError('Wait screen image must be a JPG, PNG, or WebP file.'); return }
    if (file.size > 10 * 1024 * 1024) { setError('Wait screen image must be 10 MB or smaller.'); return }

    setWaitScreenBusy(true); setError(''); setStatus('')
    const previousPath = display.idle_image_path
    const path = `${gameId}/display/${crypto.randomUUID()}.${extension}`
    try {
      const { error: uploadError } = await supabase.storage.from('enemy-art').upload(path, file, {
        cacheControl: '3600',
        contentType: file.type,
        upsert: false,
      })
      if (uploadError) throw uploadError
      const { error: saveError } = await supabase.from('encounter_displays')
        .update({ idle_image_path: path, reveal_id: crypto.randomUUID() }).eq('game_id', gameId)
      if (saveError) {
        await supabase.storage.from('enemy-art').remove([path])
        throw saveError
      }
      await loadDisplay()
      if (previousPath) void supabase.storage.from('enemy-art').remove([previousPath])
      setStatus('Custom wait-screen image uploaded.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload the wait-screen image.')
    } finally {
      setWaitScreenBusy(false)
      if (waitScreenInput.current) waitScreenInput.current.value = ''
    }
  }

  async function removeWaitScreen() {
    if (!supabase || !display?.idle_image_path || waitScreenBusy) return
    const previousPath = display.idle_image_path
    setWaitScreenBusy(true); setError(''); setStatus('')
    try {
      const { error: saveError } = await supabase.from('encounter_displays')
        .update({ idle_image_path: null, reveal_id: crypto.randomUUID() }).eq('game_id', gameId)
      if (saveError) throw saveError
      await loadDisplay()
      void supabase.storage.from('enemy-art').remove([previousPath])
      setStatus('Custom wait screen removed.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the wait-screen image.')
    } finally { setWaitScreenBusy(false) }
  }

  async function copyPlayerScreen() {
    if (!playerScreenUrl) return
    try { await navigator.clipboard.writeText(playerScreenUrl); setStatus('Player screen link copied.') }
    catch { setError('Could not copy the link. Open it and copy the URL from the new tab instead.') }
  }

  function adjust(enemy: Enemy, change: number) {
    if (!supabase) return
    void mutate(() => supabase!.rpc('gm_adjust_enemy_hp', { p_enemy_id: enemy.id, p_delta: change }))
  }

  function remove(enemy: Enemy) {
    if (!supabase || !window.confirm(`Remove ${enemy.name} from the encounter?`)) return
    void mutate(() => supabase!.from('encounter_enemies').delete().eq('game_id', gameId).eq('id', enemy.id))
  }

  function clear() {
    if (!supabase || !window.confirm('Clear all enemies from this encounter? This cannot be undone.')) return
    void mutate(() => supabase!.from('encounter_enemies').delete().eq('game_id', gameId))
  }

  const alive = enemies.filter(enemy => enemy.current_hp > 0).length
  const currentReveal = enemies.find(enemy => enemy.id === display?.enemy_id)
  return <section className="panel pad encounter-panel" aria-labelledby="encounter-title">
    <div className="encounter-heading"><div><div className="broadcast-kicker">GM ENCOUNTER CONTROL</div><h2 id="encounter-title"><Crosshair size={22}/> Active Encounter</h2></div><span className="pill">{alive} standing</span></div>
    <p className="muted">Build the fight, let the Dungeon invent something awful, then throw it onto the player screen.</p>

    <section className="mob-forge" aria-labelledby="mob-forge-title">
      <div className="mob-forge-head">
        <div><div className="eyebrow">AI ENCOUNTER FORGE</div><h3 id="mob-forge-title"><WandSparkles size={18}/> Generate Hostile</h3></div>
        <div className="mob-forge-screen-actions">
          {playerScreenUrl && <button className="button" type="button" onClick={() => window.open(playerScreenUrl, 'crawler-encounter-display')}><ExternalLink size={15}/>Player Screen</button>}
          {playerScreenUrl && <button className="button" type="button" onClick={() => void copyPlayerScreen()}><Copy size={15}/>Copy Link</button>}
          <button className="button d20-roll-button" type="button" disabled={displayBusy || !display} onClick={() => void rollD20()}><Dices size={15}/>ROLL D20</button>
          <input ref={waitScreenInput} className="wait-screen-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { const file=e.target.files?.[0]; if(file) void uploadWaitScreen(file) }}/>
          <button className="button" type="button" disabled={waitScreenBusy || !display} onClick={() => waitScreenInput.current?.click()}><Upload size={15}/>{display?.idle_image_path ? 'Replace Wait Image' : 'Upload Wait Image'}</button>
          {display?.idle_image_path && <button className="button" type="button" disabled={waitScreenBusy} onClick={() => void removeWaitScreen()}><Trash2 size={15}/>Remove Wait Image</button>}
        </div>
      </div>
      <div className="forge-toggle-row">
        <div className="segmented-control" role="group" aria-label="Enemy type">
          <button type="button" className={forgeKind === 'mob' ? 'active' : ''} onClick={() => setForgeKind('mob')}>MOB</button>
          <button type="button" className={forgeKind === 'boss' ? 'active' : ''} onClick={() => setForgeKind('boss')}>BOSS</button>
        </div>
        <div className="segmented-control" role="group" aria-label="Generation mode">
          <button type="button" className={forgeMode === 'random' ? 'active' : ''} onClick={() => setForgeMode('random')}><Sparkles size={14}/>SURPRISE ME</button>
          <button type="button" className={forgeMode === 'specific' ? 'active' : ''} onClick={() => setForgeMode('specific')}>SPECIFIC</button>
        </div>
      </div>
      <div className="forge-level-row">
        <label>Minimum level<input type="number" min="1" max="99" step="1" value={minLevel} onChange={e => setMinLevel(e.target.value)}/></label>
        <div className="forge-level-dash">-</div>
        <label>Maximum level<input type="number" min="1" max="99" step="1" value={maxLevel} onChange={e => setMaxLevel(e.target.value)}/></label>
        <div className="forge-level-hint">Dungeon rolls one level from this range / 1-99</div>
      </div>
      {forgeMode === 'specific'
        ? <label className="forge-brief">What should the Dungeon make?<textarea maxLength={2000} rows={3} value={brief} onChange={e => setBrief(e.target.value)} placeholder="Example: A fungal crocodile priest that fights with a church bell and hates fire."/></label>
        : <div className="forge-random-copy">No brief. No safety rail. The Dungeon will use the current floor and invent the problem for you.</div>}
      <button className="button primary wide forge-generate" type="button" disabled={busy || !validForgeRange || (forgeMode === 'specific' && !brief.trim())} onClick={() => void generate()}>
        <Sparkles size={16}/>{busy ? 'THE DUNGEON IS THINKING...' : `GENERATE ${forgeKind === 'boss' ? 'BOSS' : 'MOB'}`}
      </button>
    </section>

    {currentReveal && <div className="current-reveal-strip"><span>ON PLAYER SCREEN</span><strong>{currentReveal.name}</strong><button className="button" disabled={displayBusy} onClick={() => void clearReveal()}>Clear Screen</button></div>}
    <form className="encounter-form" onSubmit={e => { e.preventDefault(); add() }}>
      <label className="encounter-wide">Enemy name<input required maxLength={75} value={name} onChange={e => setName(e.target.value)} placeholder="Goblin with a grudge"/></label>
      <label>Starting HP<input required type="number" min="0.25" max="999" step="0.25" value={hp} onChange={e => setHp(e.target.value)}/></label>
      <label>How many?<input required type="number" min="1" max="12" step="1" value={quantity} onChange={e => setQuantity(e.target.value)}/></label>
      <label className="encounter-wide">Notes / abilities<input maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional: bites, cowardly, hates fire"/></label>
      <button className="button primary encounter-wide" disabled={busy || loading || !name.trim() || !validHp || !validCount}><Plus size={16}/>Add {validCount && count > 1 ? `${count} enemies` : 'enemy'}</button>
    </form>
    {error && <div className="error-banner" role="alert">{error}<button className="button" disabled={busy} onClick={() => { setError(''); void reload().catch(e => setError(e.message)) }}>Refresh encounter</button></div>}
    {status && <div className="status-message encounter-status" role="status">{status}</div>}
    {loading ? <p role="status">Loading encounter…</p> : enemies.length === 0 ? <div className="encounter-empty">No enemies yet. Add the first unfortunate volunteer above.</div> : <>
      <div className="encounter-toolbar"><label>Damage / healing amount<input aria-label="Damage or healing amount" type="number" min="0.25" max="999" step="0.25" value={amount} onChange={e => setAmount(e.target.value)}/></label><span className="muted">HP · quarter points supported</span></div>
      {!alive && <div className="encounter-victory" role="status"><Skull size={18}/>All enemies defeated. Someone tell accounting.</div>}
      <div className="encounter-enemies">{enemies.map(enemy => <article key={enemy.id} className={`encounter-enemy ${enemy.current_hp === 0 ? 'is-defeated' : ''}`}>
        <div className="encounter-enemy-heading"><div><div className="enemy-meta"><span>{enemy.enemy_kind.toUpperCase()}</span><span>LVL {enemy.level}</span></div><h3>{enemy.name}</h3></div><strong>{enemy.current_hp === 0 ? 'DEFEATED' : `${enemy.current_hp} / ${enemy.max_hp} HP`}</strong></div>
        <progress aria-label={`${enemy.name} health`} max={enemy.max_hp} value={enemy.current_hp}/>
        {enemy.notes && <p className="encounter-notes">{enemy.notes}</p>}
        {enemy.abilities?.length > 0 && <details className="enemy-abilities"><summary>{enemy.abilities.length} special {enemy.abilities.length === 1 ? 'ability' : 'abilities'}</summary><div className="enemy-ability-list">{enemy.abilities.map((ability, index) => <div className="enemy-ability" key={`${enemy.id}-${index}`}><strong>{ability.name}</strong><span>{ability.trigger}</span><p>{ability.effect}</p></div>)}</div></details>}
        {enemy.entrance && <details className="enemy-entrance"><summary>Player-facing intro</summary><p>{enemy.entrance}</p></details>}
        <div className={`enemy-art-status art-${enemy.image_status}`}>
          {enemy.image_status === 'generating' && <><RefreshCw className="spin" size={15}/><span>Dungeon art rendering...</span></>}
          {enemy.image_status === 'ready' && <><Image size={15}/><span>Reveal art ready</span></>}
          {enemy.image_status === 'error' && <><span>Art failed{enemy.image_error ? ` / ${enemy.image_error}` : ''}</span><button className="button" disabled={busy} onClick={() => void retryImage(enemy)}>Retry Art</button></>}
          {enemy.image_status === 'none' && <><span>No generated art</span><button className="button" disabled={busy} onClick={() => void retryImage(enemy)}>Generate Art</button></>}
        </div>
        <div className="encounter-hp-actions"><button className="button encounter-damage" aria-label={`Damage ${enemy.name} by ${delta} HP`} disabled={busy || !validDelta || enemy.current_hp === 0} onClick={() => adjust(enemy, -delta)}>−{validDelta ? delta : '?'} Damage</button><button className="button" aria-label={`Heal ${enemy.name} by ${delta} HP`} disabled={busy || !validDelta || enemy.current_hp === enemy.max_hp} onClick={() => adjust(enemy, delta)}>+{validDelta ? delta : '?'} Heal</button></div>
        <div className="encounter-enemy-tools"><button className="button reveal-enemy-button" disabled={displayBusy || enemy.image_status !== 'ready'} title={enemy.image_status === 'ready' ? 'Trigger the cinematic player-screen reveal' : 'Wait for the generated image'} onClick={() => void reveal(enemy)}><Sparkles size={15}/>REVEAL</button><button className="button" disabled={busy} onClick={() => { setName(enemy.name); setHp(String(enemy.max_hp)); setQuantity('1'); setNotes(enemy.notes) }}>Copy to form</button><button className="button" disabled={busy} onClick={() => remove(enemy)}>Remove</button></div>
      </article>)}</div>
      <button className="button" disabled={busy} onClick={clear}>Clear encounter</button>
    </>}
    <div className="muted encounter-save-note" role="status">{busy ? 'Saving…' : 'Saved per game · GM only'}</div>
  </section>
}
