import { useCallback, useEffect, useRef, useState } from 'react'
import { Crosshair, Plus, Skull } from 'lucide-react'
import { supabase } from './lib/supabase'

type Enemy = { id: string; name: string; max_hp: number; current_hp: number; notes: string }

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
  const locked = useRef(false)
  const request = useRef(0)
  const maxHp = Number(hp)
  const count = Number(quantity)
  const delta = Number(amount)
  const validHp = Number.isFinite(maxHp) && maxHp >= .25 && maxHp <= 999 && Number.isInteger(maxHp * 4)
  const validCount = Number.isInteger(count) && count >= 1 && count <= 12
  const validDelta = Number.isFinite(delta) && delta >= .25 && delta <= 999 && Number.isInteger(delta * 4)

  const reload = useCallback(async () => {
    if (!supabase) throw new Error('Game connection unavailable.')
    const version = ++request.current
    const { data, error: loadError } = await supabase.from('encounter_enemies')
      .select('id,name,max_hp,current_hp,notes').eq('game_id', gameId).order('created_at').order('id')
    if (loadError) throw loadError
    if (version === request.current) { setEnemies(data ?? []); setLoading(false) }
  }, [gameId])

  useEffect(() => {
    let active = true
    const sync = () => { void reload().catch(e => { if (active) { setError(e.message); setLoading(false) } }) }
    sync()
    const channel = supabase?.channel(`encounter-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'encounter_enemies' }, sync).subscribe()
    window.addEventListener('focus', sync)
    const interval = window.setInterval(sync, 15000)
    return () => {
      active = false
      request.current++
      window.clearInterval(interval)
      window.removeEventListener('focus', sync)
      if (channel) void supabase?.removeChannel(channel)
    }
  }, [gameId, reload])

  async function mutate(action: () => PromiseLike<{ error: { message: string } | null }>, onSuccess?: () => void) {
    if (locked.current) return
    locked.current = true
    setBusy(true); setError('')
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
      current_hp: maxHp, max_hp: maxHp, notes: notes.trim(),
    }))
    void mutate(() => supabase!.from('encounter_enemies').insert(rows), () => { setName(''); setNotes('') })
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
  return <section className="panel pad encounter-panel" aria-labelledby="encounter-title">
    <div className="encounter-heading"><div><div className="broadcast-kicker">GM ENCOUNTER CONTROL</div><h2 id="encounter-title"><Crosshair size={22}/> Active Encounter</h2></div><span className="pill">{alive} standing</span></div>
    <p className="muted">Keep the fight moving. The Dungeon can count its own corpses.</p>
    <form className="encounter-form" onSubmit={e => { e.preventDefault(); add() }}>
      <label className="encounter-wide">Enemy name<input required maxLength={75} value={name} onChange={e => setName(e.target.value)} placeholder="Goblin with a grudge"/></label>
      <label>Starting HP<input required type="number" min="0.25" max="999" step="0.25" value={hp} onChange={e => setHp(e.target.value)}/></label>
      <label>How many?<input required type="number" min="1" max="12" step="1" value={quantity} onChange={e => setQuantity(e.target.value)}/></label>
      <label className="encounter-wide">Notes / abilities<input maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional: bites, cowardly, hates fire"/></label>
      <button className="button primary encounter-wide" disabled={busy || loading || !name.trim() || !validHp || !validCount}><Plus size={16}/>Add {validCount && count > 1 ? `${count} enemies` : 'enemy'}</button>
    </form>
    {error && <div className="error-banner" role="alert">{error}<button className="button" disabled={busy} onClick={() => { setError(''); void reload().catch(e => setError(e.message)) }}>Refresh encounter</button></div>}
    {loading ? <p role="status">Loading encounter…</p> : enemies.length === 0 ? <div className="encounter-empty">No enemies yet. Add the first unfortunate volunteer above.</div> : <>
      <div className="encounter-toolbar"><label>Damage / healing amount<input aria-label="Damage or healing amount" type="number" min="0.25" max="999" step="0.25" value={amount} onChange={e => setAmount(e.target.value)}/></label><span className="muted">HP · quarter points supported</span></div>
      {!alive && <div className="encounter-victory" role="status"><Skull size={18}/>All enemies defeated. Someone tell accounting.</div>}
      <div className="encounter-enemies">{enemies.map(enemy => <article key={enemy.id} className={`encounter-enemy ${enemy.current_hp === 0 ? 'is-defeated' : ''}`}>
        <div className="encounter-enemy-heading"><h3>{enemy.name}</h3><strong>{enemy.current_hp === 0 ? 'DEFEATED' : `${enemy.current_hp} / ${enemy.max_hp} HP`}</strong></div>
        <progress aria-label={`${enemy.name} health`} max={enemy.max_hp} value={enemy.current_hp}/>
        {enemy.notes && <p className="encounter-notes">{enemy.notes}</p>}
        <div className="encounter-hp-actions"><button className="button encounter-damage" aria-label={`Damage ${enemy.name} by ${delta} HP`} disabled={busy || !validDelta || enemy.current_hp === 0} onClick={() => adjust(enemy, -delta)}>−{validDelta ? delta : '?'} Damage</button><button className="button" aria-label={`Heal ${enemy.name} by ${delta} HP`} disabled={busy || !validDelta || enemy.current_hp === enemy.max_hp} onClick={() => adjust(enemy, delta)}>+{validDelta ? delta : '?'} Heal</button></div>
        <div className="encounter-enemy-tools"><button className="button" disabled={busy} onClick={() => { setName(enemy.name); setHp(String(enemy.max_hp)); setQuantity('1'); setNotes(enemy.notes) }}>Copy to form</button><button className="button" disabled={busy} onClick={() => remove(enemy)}>Remove</button></div>
      </article>)}</div>
      <button className="button" disabled={busy} onClick={clear}>Clear encounter</button>
    </>}
    <div className="muted encounter-save-note" role="status">{busy ? 'Saving…' : 'Saved per game · GM only'}</div>
  </section>
}
