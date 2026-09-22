import { useEffect, useState } from 'react'
import { ArrowLeftRight, Brain, Gift, Package, ScrollText, Settings, Sparkles, Trophy, Users } from 'lucide-react'
import type { Character, DungeonVerdict, GearSlot, LootOpenResult, TradeRecord, TradeTarget, TradeableItem } from './lib/types'
import { supabase, supabaseConfigured } from './lib/supabase'
import {
  acceptTrade, applyDungeonCommand, applyDungeonVerdict, cancelTrade, completeCharacterSetup, createGame, createGmLogin, createTrade, declineTrade, deleteGame, ensureAnonymousUser, joinGame,
  equipCharacterItem, gmRenameItem, listMyGames, listMyTrades, listTradeableItems, listTradeTargets, loadCharacters, loadDungeonStory, loadPartyMembers, openLootBox, persistCharacterDiff, recoverCrawler, renameCharacter, signInGm, signOutUser, subscribeToGame, unequipCharacterItem, updateGameSettings, uploadCharacterPortrait, useCharacterItem,
} from './lib/live'
import type { DungeonStoryEvent, GameSummary, PartyMember } from './lib/live'

const stats = ['Strength','Dexterity','Intelligence','Constitution','Charisma'] as const
const gearSlots: GearSlot[] = ['Head','Shirt','Pants','Hands','Feet','Weapon 1','Weapon 2','Accessory 1','Accessory 2']

function compatibleEquipSlots(slot?: GearSlot): GearSlot[] {
  if (!slot) return []
  if (slot === 'Weapon 1' || slot === 'Weapon 2') return ['Weapon 1','Weapon 2']
  if (slot === 'Accessory 1' || slot === 'Accessory 2') return ['Accessory 1','Accessory 2']
  return [slot]
}
function hpValue(units:number){
  const value=units/4
  return Number.isInteger(value)?String(value):value.toFixed(2).replace(/0$/,'')
}
function hpDeltaLabel(units:number){
  const sign=units>0?'+':units<0?'−':''
  return `${sign}${hpValue(Math.abs(units))} HP`
}
type CoreStat = (typeof stats)[number]
const zeroStatBonuses=():Character['stats']=>({Strength:0,Dexterity:0,Intelligence:0,Constitution:0,Charisma:0})
function equippedStatBonuses(character:Character){
  return Object.values(character.gear).reduce((total,item)=>{
    if(!item)return total
    for(const stat of stats) total[stat]+=item.statBonuses?.[stat]??0
    return total
  },zeroStatBonuses())
}
function statBonusSummary(bonuses:Character['stats']){
  const parts=stats.filter(stat=>(bonuses?.[stat]??0)>0).map(stat=>`${stat.slice(0,3).toUpperCase()} +${bonuses[stat]}`)
  return parts.join(' · ')
}
function HealthBar({c,m,compact=false}:{c:number;m:number;compact?:boolean}) {
  const current=Math.max(0,Math.min(c,m))
  const pct=m>0?Math.max(0,Math.min(100,(current/m)*100)):0
  const state=current<=0?'empty':pct<=25?'critical':pct<=50?'warning':'healthy'
  return <div className={`health-bar-wrap ${compact?'compact-health':''}`} aria-label={`${hpValue(current)} of ${hpValue(m)} HP`}>
    <div className="health-bar-track">
      <div className={`health-bar-fill health-${state}`} style={{width:`${pct}%`}}/>
    </div>
    <span className="health-bar-readout"><strong>{hpValue(current)}</strong><span>/ {hpValue(m)} HP</span></span>
  </div>
}

type GeneratedClass = {
  name: string
  tagline: string
  starting_skill: string
  dungeon_note: string
}

function Setup({character,onDone}:{character:Character;onDone:()=>Promise<void>}) {
  const [name,setName]=useState('')
  const [description,setDescription]=useState('')
  const [classOptions,setClassOptions]=useState<GeneratedClass[]>([])
  const [selectedClassName,setSelectedClassName]=useState('')
  const [vals,setVals]=useState<Character['stats']>({Strength:0,Dexterity:0,Intelligence:0,Constitution:0,Charisma:0})
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')
  const selectedClass=classOptions.find(x=>x.name===selectedClassName)
  const statTotal=Object.values(vals).reduce((sum,value)=>sum+value,0)
  const statsValid=statTotal===8&&Object.values(vals).every(value=>Number.isInteger(value)&&value>=0)
  const valid=statsValid&&!!name.trim()&&!!selectedClass

  function adjustStat(stat:(typeof stats)[number],delta:number){
    setVals(current=>{
      const nextValue=current[stat]+delta
      const currentTotal=Object.values(current).reduce((sum,value)=>sum+value,0)
      if(nextValue<0)return current
      if(delta>0&&currentTotal>=8)return current
      return {...current,[stat]:nextValue}
    })
  }

  async function generateClasses(){
    if(!supabase||description.trim().length<12)return
    setBusy(true);setErr('')
    try{
      const {data,error}=await supabase.functions.invoke('generate-classes',{body:{characterId:character.id,description:description.trim()}})
      if(error){
        let detail=error.message
        const response=(error as any).context as Response | undefined
        try{
          const payload=await response?.clone().json()
          if(payload?.error)detail=String(payload.error)
        }catch{}
        throw new Error(detail)
      }
      if(data?.error)throw new Error(String(data.error))
      const options=Array.isArray(data?.classes)?data.classes as GeneratedClass[]:[]
      if(options.length!==4)throw new Error('The Dungeon failed to produce four questionable life choices.')
      setClassOptions(options)
      setSelectedClassName('')
      const suggested=data?.suggested_stats as Character['stats'] | undefined
      if(suggested){
        const suggestedValues=stats.map(stat=>Number(suggested[stat]))
        if(suggestedValues.every(value=>Number.isInteger(value)&&value>=0)&&suggestedValues.reduce((sum,value)=>sum+value,0)===8){
          setVals({
            Strength:Number(suggested.Strength),
            Dexterity:Number(suggested.Dexterity),
            Intelligence:Number(suggested.Intelligence),
            Constitution:Number(suggested.Constitution),
            Charisma:Number(suggested.Charisma),
          })
        }
      }
    }catch(e){setErr(e instanceof Error?e.message:'Could not generate classes')}finally{setBusy(false)}
  }

  async function save(){
    if(!supabase||!valid||!selectedClass)return
    setBusy(true);setErr('')
    try{
      await completeCharacterSetup({
        characterId:character.id,
        name,
        background:selectedClass.name,
        stats:vals,
        startingSkill:selectedClass.starting_skill,
      })
      await onDone()
    }catch(e){setErr(e instanceof Error?e.message:'Could not create crawler')}finally{setBusy(false)}
  }

  return <div className="creation-shell">
    <section className="panel pad">
      <div className="eyebrow">Welcome to the Dungeon</div>
      <h2>Create Your Crawler</h2>
      <p className="muted">Tell the Dungeon who you are. It will decide what kind of terrible career path you deserve.</p>
    </section>

    <div className="two-col">
      <section className="panel pad">
        <h3>Who Are You?</h3>
        <label>Name<input value={name} onChange={e=>setName(e.target.value)} placeholder="Crawler name"/></label>
        <label>
          Describe your character
          <textarea
            className="character-description"
            rows={7}
            value={description}
            onChange={e=>setDescription(e.target.value)}
            placeholder="Example: I’m a burned-out ER nurse who grew up hunting, can fix almost anything with duct tape, hates authority, and talks way too much when nervous."
          />
        </label>
        <div className="muted small">Real job, hobbies, bad habits, weird talents, personality — give the Dungeon ammunition.</div>
        <button className="button primary wide" disabled={busy||description.trim().length<12} onClick={()=>void generateClasses()}>
          {busy?'The Dungeon Is Judging You…':classOptions.length?'Judge My Life Again':'Judge My Life'}
        </button>
      </section>

      <section className="panel pad">
        <h3>Core Stats</h3>
        <p className="muted small">You get 8 total points. The Dungeon will make a first guess from your description, but you can redistribute them however you want.</p>
        <div className="stat-budget">
          <strong>{statTotal}/8 points assigned</strong>
          <span className="muted small">{classOptions.length?'Dungeon suggestion loaded. Adjust as needed.':'Judge My Life to get a suggested spread.'}</span>
        </div>
        <div className="creation-stats">
          {stats.map(s=><div className="creation-stat-card" key={s}>
            <span>{s}</span>
            <div className="stat-stepper">
              <button type="button" className="button stat-step" disabled={vals[s]===0} onClick={()=>adjustStat(s,-1)}>−</button>
              <strong>+{vals[s]}</strong>
              <button type="button" className="button stat-step" disabled={statTotal>=8} onClick={()=>adjustStat(s,1)}>+</button>
            </div>
          </div>)}
        </div>
        <div className="surface-note">Starting health: <strong>{6+vals.Constitution} ♥</strong></div>
      </section>
    </div>

    <section className="panel pad">
      <div className="section-title"><div><div className="eyebrow">Dungeon-Assigned Career Counseling</div><h3>Choose Your Class</h3></div>{classOptions.length>0&&<span className="pill">Pick 1 of 4</span>}</div>
      {classOptions.length===0
        ? <div className="class-empty">Describe yourself above and the Dungeon will manufacture four deeply questionable class options.</div>
        : <div className="class-options">{classOptions.map(option=><button type="button" key={option.name} className={`class-option ${selectedClassName===option.name?'selected':''}`} onClick={()=>setSelectedClassName(option.name)}>
            <div className="class-option-top"><strong>{option.name}</strong>{selectedClassName===option.name&&<span className="pill">Selected</span>}</div>
            <div className="class-tagline">{option.tagline}</div>
            <div className="class-skill"><span>Starting Skill</span><strong>{option.starting_skill}</strong></div>
            <div className="dungeon-note">Dungeon AI: “{option.dungeon_note}”</div>
          </button>)}</div>}
    </section>

    <button className="button primary" disabled={!valid||busy} onClick={()=>void save()}>{busy?'Entering…':selectedClass?`Enter as ${selectedClass.name}`:'Choose a Class to Enter the Dungeon'}</button>
    {err&&<div className="error-banner">{err}</div>}
  </div>
}

function Player({gameId,character,refresh}:{gameId:string;character:Character;refresh:()=>Promise<void>}) {
  const [tab,setTab]=useState<'crawler'|'party'|'trades'|'inventory'|'loot'|'achievements'>('crawler')
  const [msg,setMsg]=useState('')
  const [busy,setBusy]=useState(false)
  const [uploadingPortrait,setUploadingPortrait]=useState(false)
  const [lootReveal,setLootReveal]=useState<LootOpenResult|null>(null)
  const [party,setParty]=useState<PartyMember[]>([])
  const [partyLoading,setPartyLoading]=useState(false)
  const [tradeTargets,setTradeTargets]=useState<TradeTarget[]>([])
  const [tradeItems,setTradeItems]=useState<TradeableItem[]>([])
  const [requestedItems,setRequestedItems]=useState<TradeableItem[]>([])
  const [trades,setTrades]=useState<TradeRecord[]>([])
  const [tradeTargetId,setTradeTargetId]=useState('')
  const [offeredItemId,setOfferedItemId]=useState('')
  const [requestedItemId,setRequestedItemId]=useState('')
  const [tradeLoading,setTradeLoading]=useState(false)
  const gearStatBonuses=equippedStatBonuses(character)
  const totalConstitution=character.stats.Constitution+gearStatBonuses.Constitution

  async function openParty(){
    setTab('party')
    setPartyLoading(true)
    setMsg('')
    try{
      setParty(await loadPartyMembers(gameId))
    }catch(e){
      setMsg(e instanceof Error?e.message:'Could not load party')
    }finally{
      setPartyLoading(false)
    }
  }

  useEffect(()=>{void loadPartyMembers(gameId).then(setParty).catch(()=>{})},[gameId])

  async function loadTrades(){
    setTradeLoading(true)
    try{
      const [targets,items,records]=await Promise.all([
        listTradeTargets(gameId),
        listTradeableItems(gameId,character.id),
        listMyTrades(gameId),
      ])
      setTradeTargets(targets)
      setTradeItems(items)
      setTrades(records)
      if(tradeTargetId&&!targets.some(t=>t.characterId===tradeTargetId)){
        setTradeTargetId('')
        setRequestedItemId('')
        setRequestedItems([])
      }else if(tradeTargetId){
        setRequestedItems(await listTradeableItems(gameId,tradeTargetId))
      }
      if(offeredItemId&&!items.some(i=>i.characterItemId===offeredItemId))setOfferedItemId('')
    }catch(e){
      setMsg(e instanceof Error?e.message:'Could not load trades')
    }finally{
      setTradeLoading(false)
    }
  }

  async function openTrades(){
    setTab('trades')
    setMsg('')
    await loadTrades()
  }

  async function chooseTradeTarget(characterId:string){
    setTradeTargetId(characterId)
    setRequestedItemId('')
    setRequestedItems([])
    if(!characterId)return
    setTradeLoading(true)
    try{
      setRequestedItems(await listTradeableItems(gameId,characterId))
    }catch(e){
      setMsg(e instanceof Error?e.message:'Could not load that crawler’s tradeable items')
    }finally{
      setTradeLoading(false)
    }
  }

  async function sendTrade(){
    if(!tradeTargetId||!offeredItemId)return
    setBusy(true);setMsg('')
    try{
      await createTrade({
        gameId,
        senderCharacterId:character.id,
        recipientCharacterId:tradeTargetId,
        offeredCharacterItemId:offeredItemId,
        requestedCharacterItemId:requestedItemId||null,
      })
      setOfferedItemId('')
      setRequestedItemId('')
      setMsg('Trade offer sent.')
      await loadTrades()
    }catch(e){setMsg(e instanceof Error?e.message:'Could not send trade')}finally{setBusy(false)}
  }

  async function respondToTrade(action:'accept'|'decline'|'cancel',tradeId:string){
    setBusy(true);setMsg('')
    try{
      if(action==='accept')await acceptTrade(tradeId)
      else if(action==='decline')await declineTrade(tradeId)
      else await cancelTrade(tradeId)
      await refresh()
      await loadTrades()
      setMsg(action==='accept'?'Trade accepted. Inventory updated.':action==='decline'?'Trade declined.':'Trade cancelled.')
    }catch(e){setMsg(e instanceof Error?e.message:'Could not update trade')}finally{setBusy(false)}
  }

  useEffect(()=>{void loadPartyMembers(gameId).then(setParty).catch(()=>{})},[gameId])
  useEffect(()=>{if(tab==='trades')void loadTrades()},[character.inventory,character.gear])

  async function uploadPortrait(file:File){
    if(!file)return
    setMsg('')
    if(!file.type.startsWith('image/')){
      setMsg('Choose an image file.')
      return
    }
    if(file.size>20*1024*1024){
      setMsg('Choose an image smaller than 20 MB.')
      return
    }
    setUploadingPortrait(true)
    try{
      await uploadCharacterPortrait(character.id,file)
      await refresh()
      setMsg('Player image updated.')
    }catch(e){
      setMsg(e instanceof Error?e.message:'Could not upload player image')
    }finally{
      setUploadingPortrait(false)
    }
  }

  async function spend(stat:string){
    if(!supabase)return
    setBusy(true);setMsg('')
    try{const {error}=await supabase.rpc('spend_stat_point',{p_character_id:character.id,p_stat:stat});if(error)throw error;await refresh()}
    catch(e){setMsg(e instanceof Error?e.message:'Could not spend point')}finally{setBusy(false)}
  }
  async function openBox(id:string){
    setBusy(true);setMsg('');setLootReveal(null)
    try{
      const r=await openLootBox(id)
      setLootReveal(r)
      await refresh()
    }catch(e){setMsg(e instanceof Error?e.message:'Box failed to open')}finally{setBusy(false)}
  }
  async function renameSelf(){
    const next=window.prompt('Rename your crawler',character.name)?.trim()
    if(!next||next===character.name)return
    setBusy(true);setMsg('')
    try{
      await renameCharacter(character.id,next)
      await refresh()
      setMsg(`Crawler renamed to ${next}.`)
    }catch(e){setMsg(e instanceof Error?e.message:'Could not rename crawler')}finally{setBusy(false)}
  }

  async function equip(itemId:string,slot:GearSlot){
    setBusy(true);setMsg('')
    try{
      await equipCharacterItem(itemId,slot)
      await refresh()
      setMsg(`Equipped to ${slot}.`)
    }catch(e){setMsg(e instanceof Error?e.message:'Could not equip item')}finally{setBusy(false)}
  }

  async function unequip(itemId:string){
    setBusy(true);setMsg('')
    try{
      await unequipCharacterItem(itemId)
      await refresh()
      setMsg('Item returned to your backpack.')
    }catch(e){setMsg(e instanceof Error?e.message:'Could not unequip item')}finally{setBusy(false)}
  }
  async function useItem(itemId:string,itemName:string){
    setBusy(true);setMsg('')
    try{
      const healed=await useCharacterItem(itemId)
      await refresh()
      setMsg(`${itemName} used. Restored ${hpValue(healed)} HP.`)
    }catch(e){setMsg(e instanceof Error?e.message:'Could not use item')}finally{setBusy(false)}
  }
  return <>
    <section className="panel pad player-header"><div><div className="player-name-row"><h2>{character.name} <span className="pill">Level {character.level}</span></h2><button className="button compact-action" disabled={busy} onClick={()=>void renameSelf()}>Rename</button></div><div className="muted">{character.background}</div></div><div><div className="eyebrow">Health</div><HealthBar c={character.currentHealth} m={character.maxHealth}/></div></section>
    {character.unspentStatPoints>0&&<div className="live-banner level-up-broadcast"><div className="broadcast-kicker">SYSTEM OVERRIDE</div><strong>LEVEL UP!</strong><span>You have {character.unspentStatPoints} stat point{character.unspentStatPoints===1?'':'s'} to spend.</span></div>}
    <nav className="tabs"><button className={`button ${tab==='crawler'?'primary':''}`} onClick={()=>setTab('crawler')}><Users size={16}/>Crawler</button><button className={`button ${tab==='party'?'primary':''}`} onClick={()=>void openParty()}><Users size={16}/>Party</button><button className={`button ${tab==='trades'?'primary':''}`} onClick={()=>void openTrades()}><ArrowLeftRight size={16}/>Trades{trades.filter(t=>t.status==='pending'&&t.recipientCharacterId===character.id).length>0&&<span className="tab-badge">{trades.filter(t=>t.status==='pending'&&t.recipientCharacterId===character.id).length}</span>}</button><button className={`button ${tab==='inventory'?'primary':''}`} onClick={()=>setTab('inventory')}><Package size={16}/>Inventory</button><button className={`button ${tab==='loot'?'primary':''}`} onClick={()=>setTab('loot')}><Gift size={16}/>Loot</button><button className={`button ${tab==='achievements'?'primary':''}`} onClick={()=>setTab('achievements')}><Trophy size={16}/>Achievements</button></nav>
    {msg&&<div className="status-message">{msg}</div>}
    {tab==='crawler'&&<div className="crawler-layout">
      <section className="panel pad portrait-panel">
        <h3>Player Image</h3>
        <div className="player-portrait-frame">
          {character.portraitUrl
            ? <img className="player-portrait-image" src={character.portraitUrl} alt={`${character.name} portrait`}/>
            : <div className="player-portrait-empty"><Users size={52}/><span>No image yet</span></div>}
        </div>
        <label className="button primary wide file-button">
          {uploadingPortrait?'Uploading…':character.portraitUrl?'Change Player Image':'Upload Player Image'}
          <input
            type="file"
            accept="image/*"
            disabled={uploadingPortrait}
            onChange={e=>{const file=e.target.files?.[0];if(file)void uploadPortrait(file);e.currentTarget.value=''}}
          />
        </label>
        <div className="muted small portrait-help">Most image formats · automatically resized for upload</div>
      </section>
      <div className="crawler-details">
        <section className="panel pad player-stat-panel">
          <div className="section-title"><h3><Brain size={18}/>Core Stats</h3>{character.unspentStatPoints>0&&<span className="pill">{character.unspentStatPoints} point{character.unspentStatPoints===1?'':'s'} available</span>}</div>
          <div className="player-stats-grid">{stats.map(s=>{const gearBonus=gearStatBonuses[s];const total=character.stats[s]+gearBonus;return <div className="stat player-stat-card" key={s}><span>{s}</span><strong>+{total}</strong>{gearBonus>0&&<div className="stat-bonus-note">Base {character.stats[s]} + Gear {gearBonus}</div>}{character.unspentStatPoints>0&&<button className="button stat-spend-button" disabled={busy} onClick={()=>void spend(s)}>Spend +1</button>}</div>})}</div>
          <div className="health-formula-note"><strong>{totalConstitution} total Constitution × 4</strong><span>= {hpValue(character.maxHealth)} max HP</span></div>
          <h3>Conditions</h3>
          <div className="chips">{character.conditions.length?character.conditions.map(x=><span className="pill" key={x}>{x}</span>):<span className="muted">None</span>}</div>
        </section>
        <section className="panel pad player-skills-panel">
          <div className="player-skills-columns">
            <div><h3>Skills</h3>{character.skills.length?character.skills.map(s=><div className="line-row" key={s.name}><span>{s.name}</span><strong>+{s.rank}</strong></div>):<div className="muted">None yet.</div>}</div>
            <div><h3>Perks</h3>{character.perks.length?character.perks.map(x=><div className="tag-row" key={x}>{x}</div>):<div className="muted">None yet.</div>}</div>
          </div>
        </section>
      </div>
    </div>}
    {tab==='party'&&<section className="panel pad party-directory-panel">
      <div className="broadcast-section-heading">
        <div><div className="broadcast-kicker">ACTIVE CRAWLERS</div><h3><Users size={18}/>Your Party</h3></div>
        <span className="pill">{party.length} crawler{party.length===1?'':'s'}</span>
      </div>
      <p className="muted small party-directory-copy">These are the people currently trapped in this terrible situation with you.</p>
      {partyLoading?<div className="class-empty">Scanning for surviving party members…</div>:party.length?<div className="party-directory-grid">{party.map(member=><article className={`party-member-card ${member.id===character.id?'party-member-self':''}`} key={member.id}>
        <div className="party-member-portrait">
          {member.portraitUrl?<img src={member.portraitUrl} alt={`${member.name} portrait`}/>:<div className="party-member-placeholder"><Users size={42}/></div>}
          {member.id===character.id&&<span className="party-self-badge">YOU</span>}
        </div>
        <div className="party-member-info">
          <div className="broadcast-kicker">LEVEL {member.level}</div>
          <h2>{member.name}</h2>
          <div className="party-class">{member.className}</div>
        </div>
      </article>)}</div>:<div className="class-empty">No other crawlers detected.</div>}
    </section>}
    {tab==='trades'&&<section className="panel pad trades-panel">
      <div className="broadcast-section-heading">
        <div><div className="broadcast-kicker">CRAWLER COMMERCE SYSTEM</div><h3><ArrowLeftRight size={18}/>Trades</h3></div>
        <span className="pill">{trades.filter(t=>t.status==='pending').length} pending</span>
      </div>
      <p className="muted small trade-help">Only unequipped, tradeable backpack items can be offered. Unequip gear first if you want to trade it.</p>

      <div className="trade-layout">
        <div className="trade-builder">
          <div className="trade-section-label">Create Offer</div>
          <label>Trade with
            <select value={tradeTargetId} onChange={e=>void chooseTradeTarget(e.target.value)}>
              <option value="">Choose a crawler…</option>
              {tradeTargets.map(t=><option key={t.characterId} value={t.characterId}>{t.characterName}</option>)}
            </select>
          </label>
          <label>You give
            <select value={offeredItemId} onChange={e=>setOfferedItemId(e.target.value)}>
              <option value="">Choose one of your items…</option>
              {tradeItems.map(i=><option key={i.characterItemId} value={i.characterItemId}>{i.name}{i.quantity>1?` ×${i.quantity}`:''}</option>)}
            </select>
          </label>
          <label>You want <span className="muted small">(optional)</span>
            <select value={requestedItemId} disabled={!tradeTargetId||tradeLoading} onChange={e=>setRequestedItemId(e.target.value)}>
              <option value="">{tradeTargetId?'Nothing — this is a gift':'Choose a crawler first…'}</option>
              {requestedItems.map(i=><option key={i.characterItemId} value={i.characterItemId}>{i.name}{i.quantity>1?` ×${i.quantity}`:''}</option>)}
            </select>
          </label>
          {tradeTargetId&&offeredItemId&&<div className="trade-preview">
            <div><span>You send</span><strong>{tradeItems.find(i=>i.characterItemId===offeredItemId)?.name}</strong></div>
            <div className="trade-arrow">⇄</div>
            <div><span>You receive</span><strong>{requestedItemId?(requestedItems.find(i=>i.characterItemId===requestedItemId)?.name??'Selected item'):'Nothing'}</strong></div>
          </div>}
          <button className="button primary wide" disabled={busy||tradeLoading||!tradeTargetId||!offeredItemId} onClick={()=>void sendTrade()}>{busy?'Sending…':'Send Trade Offer'}</button>
          {!tradeItems.length&&!tradeLoading&&<div className="muted small trade-empty-note">You have no unequipped tradeable items available.</div>}
        </div>

        <div className="trade-inbox">
          <div className="trade-section-label">Incoming Offers</div>
          {tradeLoading&&trades.length===0?<div className="class-empty">Checking the market…</div>:trades.filter(t=>t.status==='pending'&&t.recipientCharacterId===character.id).length?trades.filter(t=>t.status==='pending'&&t.recipientCharacterId===character.id).map(t=><article className="trade-offer-card incoming" key={t.id}>
            <div className="trade-status-line"><span className="pill">Incoming</span><span className="muted small">{new Date(t.createdAt).toLocaleString()}</span></div>
            <h3>{t.senderName} wants to trade</h3>
            <div className="trade-exchange-row"><div><span className="muted small">You receive</span><strong>{t.offeredItemName}</strong></div><div className="trade-arrow">⇄</div><div><span className="muted small">You give</span><strong>{t.requestedItemName||'Nothing'}</strong></div></div>
            <div className="trade-card-actions"><button className="button primary" disabled={busy} onClick={()=>void respondToTrade('accept',t.id)}>Accept</button><button className="button" disabled={busy} onClick={()=>void respondToTrade('decline',t.id)}>Decline</button></div>
          </article>):<div className="class-empty">No incoming offers.</div>}
        </div>
      </div>

      <div className="trade-history">
        <div className="trade-section-label">Your Offers & History</div>
        {trades.length?<div className="trade-history-list">{trades.map(t=>{
          const outgoing=t.senderCharacterId===character.id
          const pending=t.status==='pending'
          return <article className={`trade-history-row trade-status-${t.status}`} key={t.id}>
            <div className="trade-history-main">
              <div><span className={`pill trade-pill-${t.status}`}>{t.status}</span><span className="muted small">{outgoing?'To':'From'} {outgoing?t.recipientName:t.senderName}</span></div>
              <strong>{t.offeredItemName}{t.requestedItemName?` ⇄ ${t.requestedItemName}`:' → gift'}</strong>
            </div>
            {pending&&outgoing&&<button className="button compact-action" disabled={busy} onClick={()=>void respondToTrade('cancel',t.id)}>Cancel</button>}
          </article>
        })}</div>:<div className="class-empty">No trade history yet.</div>}
      </div>
    </section>}
    {tab==='inventory'&&<section className="panel pad inventory-management-panel">
      <div className="section-title"><div><div className="eyebrow">Loadout</div><h3>Backpack</h3></div><span className="pill">{character.inventory.length} carried</span></div>
      <div className="muted small inventory-help">Equip gear here. If a slot is already occupied, the old item automatically returns to your backpack.</div>
      <div className="card-grid">{character.inventory.length?character.inventory.map(i=>{
        const slots=compatibleEquipSlots(i.slot)
        return <div className={`item-card rarity-${i.rarity}`} key={i.id}>
          <strong>{i.name}</strong>
          <div className="muted small">{i.rarity==='B'?'Bronze':i.rarity==='S'?'Silver':'Gold'} · {i.type} · Core {i.coreValue}{statBonusSummary(i.statBonuses)?` · ${statBonusSummary(i.statBonuses)} when equipped`:''}{(i.quantity??1)>1?` ×${i.quantity}`:''}</div>
          <div>{i.effect}</div>
          {i.quirk&&<div className="muted small">Quirk: {i.quirk}</div>}
          {i.type==='Consumable'
            ? <div className="consume-actions"><button className="button primary use-item-button" disabled={busy||character.currentHealth>=character.maxHealth} onClick={()=>void useItem(i.id,i.name)}>{character.currentHealth>=character.maxHealth?'Full Health':'Use Item'}</button></div>
            : slots.length
              ? <div className="equip-actions">{slots.map(slot=><button className="button equip-button" disabled={busy} key={slot} onClick={()=>void equip(i.id,slot)}>Equip {slot}</button>)}</div>
              : <div className="muted small item-not-equippable">Not equippable.</div>}
        </div>
      }):<div className="muted">Empty.</div>}</div>
      <h3>Equipped Gear</h3>
      <div className="card-grid">{gearSlots.map(slot=>{
        const i=character.gear[slot]
        return <div className={`item-card equipped-item-card ${i?`rarity-${i.rarity}`:''}`} key={slot}>
          <div className="gear-label">{slot}</div>
          <strong>{i?.name??'Empty'}</strong>
          {i&&<><div className="muted small">{i.rarity==='B'?'Bronze':i.rarity==='S'?'Silver':'Gold'} · Core {i.coreValue}{statBonusSummary(i.statBonuses)?` · ${statBonusSummary(i.statBonuses)}`:''}</div><div className="muted small">{i.effect}</div><button className="button wide unequip-button" disabled={busy} onClick={()=>void unequip(i.id)}>Unequip</button></>}
        </div>
      })}</div>
    </section>}
    {tab==='loot'&&<section className="panel pad loot-vault-panel">
      <div className="broadcast-section-heading"><div><div className="broadcast-kicker">DUNGEON REWARD VAULT</div><h3>Unopened Loot Boxes</h3></div><span className="broadcast-light">LIVE</span></div>
      {lootReveal&&<div className={`broadcast-reveal loot-broadcast rarity-broadcast-${lootReveal.rarity}`}>
        <div className="broadcast-scanline"/>
        <div className="broadcast-alert-row"><span>REWARD DISPENSED</span><span>{lootReveal.rarity==='B'?'BRONZE':lootReveal.rarity==='S'?'SILVER':'GOLD'}</span></div>
        <div className="loot-broadcast-icon">🎁</div>
        <div className="broadcast-kicker">{lootReveal.boxName}</div>
        <h2>{lootReveal.item.name}</h2>
        <p className="dungeon-announcement">{lootReveal.openingMessage}</p>
        <div className="loot-broadcast-effect"><strong>{lootReveal.item.effect}</strong>{lootReveal.item.quirk&&<span>AI NOTE: {lootReveal.item.quirk}</span>}{statBonusSummary(lootReveal.item.statBonuses)&&<span className="item-stat-bonus-summary">EQUIPPED BONUS · {statBonusSummary(lootReveal.item.statBonuses)}</span>}</div>
        <button className="button wide" onClick={()=>setLootReveal(null)}>Dismiss Broadcast</button>
      </div>}
      <div className="card-grid loot-box-grid">{character.boxes.length?character.boxes.map(b=><div className={`item-card loot-box-card rarity-${b.rarity}`} key={b.id}><div className="loot-box-rarity">{b.rarity==='B'?'BRONZE':b.rarity==='S'?'SILVER':'GOLD'} CACHE</div><strong>🎁 {b.name}</strong><div className="muted small">Authorized for immediate opening. Consequences not included.</div><button className="button primary wide" disabled={busy} onClick={()=>void openBox(b.id)}>{busy?'Decrypting…':'Open Box'}</button></div>):<div className="muted">No unopened boxes. The Dungeon is disappointed in your earning potential.</div>}</div>
    </section>}
    {tab==='achievements'&&<section className="panel pad achievement-panel">
      <div className="broadcast-section-heading"><div><div className="broadcast-kicker">OFFICIAL DUNGEON RECORD</div><h3><Trophy size={18}/>Achievements</h3></div><span className="pill">{character.achievements.length} unlocked</span></div>
      {character.achievements.length?<div className="achievement-grid">{character.achievements.map((a,index)=><article className="achievement-unlock-card" key={a.id}>
        <div className="achievement-number">ACH-{String(index+1).padStart(3,'0')}</div>
        <div className="achievement-trophy">🏆</div>
        <div className="broadcast-kicker">ACHIEVEMENT UNLOCKED</div>
        <h2>{a.name}</h2>
        <div className="achievement-commentary">{a.commentary}</div>
      </article>)}</div>:<div className="class-empty">No achievements yet. Try doing something stupid enough to become memorable.</div>}
    </section>}
  </>
}

type DungeonCommand = {
  summary: string
  recipients: string[]
  action: {
    kind: 'loot_box'|'item'|'health'
    rarity: 'B'|'S'|'G'
    box_name: string
    opening_message: string
    item: {
      name: string
      item_type: string
      slot: GearSlot|null
      effect: string
      quirk: string
      stat_bonuses: Character['stats']
    }
    health_delta: number
    full_heal: boolean
  }
  source?: string
}

function Judge({gameId,characters,refresh}:{gameId:string;characters:Character[];refresh:()=>Promise<void>}) {
  const [event,setEvent]=useState('')
  const [verdict,setVerdict]=useState<DungeonVerdict|null>(null)
  const [busy,setBusy]=useState(false)
  const [msg,setMsg]=useState('')
  const [commandText,setCommandText]=useState('')
  const [commandPreview,setCommandPreview]=useState<DungeonCommand|null>(null)
  const [commandBusy,setCommandBusy]=useState(false)
  const [commandMsg,setCommandMsg]=useState('')
  async function judge(){
    if(!supabase||!event.trim())return
    setBusy(true);setMsg('')
    try{
      const {data,error}=await supabase.functions.invoke('dungeon-judge',{body:{gameId,event,tone:'unhinged',frequency:'balanced',characters:characters.map(c=>{const bonus=equippedStatBonuses(c);return {id:c.id,name:c.name,level:c.level,stats:Object.fromEntries(stats.map(s=>[s,c.stats[s]+bonus[s]])),base_stats:c.stats,health:[c.currentHealth/4,c.maxHealth/4],skills:c.skills,gear:Object.values(c.gear).filter(Boolean)}})}})
      if(error){
        let detail=error.message
        const response=(error as any).context as Response | undefined
        try{
          const payload=await response?.clone().json()
          if(payload?.error)detail=String(payload.error)
        }catch{}
        throw new Error(detail)
      }
      if(data?.error)throw new Error(String(data.error))
      setVerdict(data)
    }catch(e){setMsg(e instanceof Error?e.message:'Judge failed')}finally{setBusy(false)}
  }
  async function apply(){
    if(!verdict)return
    setBusy(true)
    try{await applyDungeonVerdict(gameId,event,verdict);await refresh();setMsg('Dungeon decision applied.');setVerdict(null);setEvent('')}
    catch(e){setMsg(e instanceof Error?e.message:'Could not apply verdict')}finally{setBusy(false)}
  }

  async function interpretCommand(){
    if(!supabase||!commandText.trim())return
    setCommandBusy(true);setCommandMsg('');setCommandPreview(null)
    try{
      const {data,error}=await supabase.functions.invoke('dungeon-command',{
        body:{
          gameId,
          command:commandText.trim(),
          characters:characters.map(c=>({id:c.id,name:c.name})),
        }
      })
      if(error){
        let detail=error.message
        const response=(error as any).context as Response | undefined
        try{
          const payload=await response?.clone().json()
          if(payload?.error)detail=String(payload.error)
        }catch{}
        throw new Error(detail)
      }
      if(data?.error)throw new Error(String(data.error))
      setCommandPreview(data as DungeonCommand)
    }catch(e){setCommandMsg(e instanceof Error?e.message:'Could not interpret command')}finally{setCommandBusy(false)}
  }

  async function executeCommand(){
    if(!commandPreview||!commandText.trim())return
    if(!commandPreview.recipients.length){
      setCommandMsg('No crawlers were identified for this command. Name a crawler or say everyone / the party.')
      return
    }
    setCommandBusy(true);setCommandMsg('')
    try{
      await applyDungeonCommand(gameId,commandText.trim(),commandPreview)
      await refresh()
      setCommandMsg('Direct GM command executed.')
      setCommandPreview(null)
      setCommandText('')
    }catch(e){setCommandMsg(e instanceof Error?e.message:'Could not execute command')}finally{setCommandBusy(false)}
  }
  return <>
  <section className="panel pad dungeon-judge-panel">
    <div className="judge-masthead">
      <div className="judge-warning">⚠</div>
      <div><div className="broadcast-kicker">DUNGEON AI // EVENT REVIEW</div><h2>DUNGEON JUDGE</h2><div className="muted small">Describe the incident. The system will decide whether incompetence deserves recognition.</div></div>
      <span className="broadcast-light">AI ONLINE</span>
    </div>
    <div className="judge-input-shell">
      <div className="judge-input-label"><span>INCIDENT REPORT</span><span>{event.length} CHARS</span></div>
      <textarea rows={6} value={event} onChange={e=>setEvent(e.target.value)} placeholder="Describe what the crawlers just did…"/>
      <button className="button primary judge-button" disabled={busy||!event.trim()} onClick={()=>void judge()}>{busy?'ANALYZING BAD DECISIONS…':'SUBMIT TO THE DUNGEON'}</button>
    </div>
    {verdict&&<div className={`dungeon-verdict ${verdict.should_reward?'verdict-rewarded':'verdict-denied'}`}>
      <div className="broadcast-scanline"/>
      <div className="verdict-status">{verdict.should_reward?'EVENT WORTHY':'EVENT REVIEWED'}</div>
      <div className="broadcast-kicker">{verdict.achievement?'ACHIEVEMENT DECISION':verdict.reward.kind!=='none'?'REWARD DECISION':'NO REWARD ISSUED'}</div>
      <h2>{verdict.should_reward?(verdict.achievement?.title||verdict.reward.name):'THE DUNGEON IS NOT IMPRESSED'}</h2>
      <p className="dungeon-announcement">{verdict.achievement?.commentary||'Your behavior has been documented. Unfortunately, documentation is all you get.'}</p>
      {verdict.reward.kind!=='none'&&<div className={`verdict-reward-card rarity-broadcast-${verdict.reward.rarity}`}>
        <div className="reward-label">{verdict.reward.rarity==='B'?'BRONZE':verdict.reward.rarity==='S'?'SILVER':verdict.reward.rarity==='G'?'GOLD':'DUNGEON'} {verdict.reward.kind.replace('_',' ').toUpperCase()}</div>
        <strong>{verdict.reward.name}</strong>
        <div>{verdict.reward.effect}</div>
        {verdict.reward.quirk&&<div className="muted small">AI QUIRK: {verdict.reward.quirk}</div>}
        {verdict.reward.stat_bonuses&&statBonusSummary(verdict.reward.stat_bonuses)&&<div className="item-stat-bonus-summary">EQUIPPED BONUS · {statBonusSummary(verdict.reward.stat_bonuses)}</div>}
      </div>}
      <details className="gm-reasoning"><summary>GM-only reasoning</summary><div>{verdict.reasoning_for_gm}</div></details>
      <button className="button primary wide apply-verdict-button" onClick={()=>void apply()}>APPROVE & APPLY DECISION</button>
    </div>}
    {msg&&<div className="status-message broadcast-status">{msg}</div>}
  </section>

  <section className="panel pad dungeon-command-panel">
    <div className="command-masthead">
      <div>
        <div className="broadcast-kicker">GM OVERRIDE // DIRECT CONTROL</div>
        <h2>DUNGEON COMMAND</h2>
        <p className="muted small">This does not judge the players. Give it the general idea and the Dungeon AI will turn it into a polished, sarcastic command while preserving your important constraints.</p>
      </div>
      <span className="command-badge">NO JUDGMENT</span>
    </div>

    <div className="command-input-shell">
      <div className="judge-input-label"><span>GM COMMAND</span><span>{commandText.length} CHARS</span></div>
      <textarea
        rows={4}
        value={commandText}
        onChange={e=>{setCommandText(e.target.value);setCommandPreview(null)}}
        placeholder="Example: Award everyone a Bronze loot box containing a Healing Potion."
      />
      <button className="button command-interpret-button wide" disabled={commandBusy||!commandText.trim()} onClick={()=>void interpretCommand()}>
        {commandBusy?'INTERPRETING ORDER…':'INTERPRET COMMAND'}
      </button>
    </div>

    {commandPreview&&<div className="command-preview">
      <div className="command-preview-head">
        <div><div className="broadcast-kicker">COMMAND PREVIEW</div><h3>{commandPreview.summary}</h3></div>
        <span className="pill">{commandPreview.recipients.length} recipient{commandPreview.recipients.length===1?'':'s'}</span>
      </div>
      {commandPreview.action.opening_message&&<div className="command-ai-broadcast"><span>DUNGEON AI</span><strong>{commandPreview.action.opening_message}</strong></div>}
      <div className="command-recipient-list">
        {commandPreview.recipients.length
          ? commandPreview.recipients.map(id=><span className="pill" key={id}>{characters.find(c=>c.id===id)?.name??'Unknown Crawler'}</span>)
          : <span className="error-banner command-inline-error">No recipients identified.</span>}
      </div>

      {commandPreview.action.kind==='loot_box'&&<div className={`command-action-card rarity-${commandPreview.action.rarity}`}>
        <div className="reward-label">{commandPreview.action.rarity==='B'?'BRONZE':commandPreview.action.rarity==='S'?'SILVER':'GOLD'} LOOT BOX</div>
        <strong>🎁 {commandPreview.action.box_name}</strong>
        <div className="command-guarantee"><span>Guaranteed contents</span><strong>{commandPreview.action.item.name}</strong></div>
        {commandPreview.action.item.effect&&<div>{commandPreview.action.item.effect}</div>}
        {commandPreview.action.item.quirk&&<div className="muted small">Quirk: {commandPreview.action.item.quirk}</div>}
        {statBonusSummary(commandPreview.action.item.stat_bonuses)&&<div className="item-stat-bonus-summary">EQUIPPED BONUS · {statBonusSummary(commandPreview.action.item.stat_bonuses)}</div>}
      </div>}

      {commandPreview.action.kind==='item'&&<div className={`command-action-card rarity-${commandPreview.action.rarity}`}>
        <div className="reward-label">{commandPreview.action.rarity==='B'?'BRONZE':commandPreview.action.rarity==='S'?'SILVER':'GOLD'} DIRECT ITEM</div>
        <strong>{commandPreview.action.item.name}</strong>
        {commandPreview.action.item.effect&&<div>{commandPreview.action.item.effect}</div>}
        {commandPreview.action.item.quirk&&<div className="muted small">Quirk: {commandPreview.action.item.quirk}</div>}
        {statBonusSummary(commandPreview.action.item.stat_bonuses)&&<div className="item-stat-bonus-summary">EQUIPPED BONUS · {statBonusSummary(commandPreview.action.item.stat_bonuses)}</div>}
      </div>}

      {commandPreview.action.kind==='health'&&<div className="command-action-card health-command-card">
        <div className="reward-label">HEALTH OVERRIDE</div>
        <strong>{commandPreview.action.full_heal?'Restore to full health':hpDeltaLabel(commandPreview.action.health_delta)}</strong>
      </div>}

      <div className="command-warning">This bypasses Dungeon judgment. The AI may creatively interpret the idea, but execution applies exactly what is shown in this preview.</div>
      <button className="button primary wide command-execute-button" disabled={commandBusy||!commandPreview.recipients.length} onClick={()=>void executeCommand()}>
        EXECUTE GM COMMAND
      </button>
    </div>}

    {commandMsg&&<div className="status-message broadcast-status">{commandMsg}</div>}
  </section>
  </>
}

function StoryLog({gameId,characters}:{gameId:string;characters:Character[]}) {
  const [events,setEvents]=useState<DungeonStoryEvent[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')

  async function reload(){
    setError('')
    try{
      setEvents(await loadDungeonStory(gameId))
    }catch(e){
      setError(e instanceof Error?e.message:'Could not load story log')
    }finally{
      setLoading(false)
    }
  }

  useEffect(()=>{void reload()},[gameId,characters])

  const nameFor=(id:string)=>characters.find(c=>c.id===id)?.name??'Unknown Crawler'
  const rarityName=(rarity:string)=>rarity==='B'?'Bronze':rarity==='S'?'Silver':rarity==='G'?'Gold':''
  const formatTime=(value:string)=>{
    const date=new Date(value)
    return Number.isNaN(date.getTime())?'':date.toLocaleString([],{
      month:'short',day:'numeric',hour:'numeric',minute:'2-digit'
    })
  }

  return <section className="panel pad story-log-panel">
    <div className="section-title">
      <div><div className="eyebrow">GM Memory</div><h3><ScrollText size={18}/>Story Log</h3></div>
      <span className="pill">{events.length} approved</span>
    </div>
    <p className="muted small">Every Dungeon AI decision you approve is recorded here so you can keep the campaign straight.</p>
    {loading&&<div className="muted">Loading the Dungeon's receipts…</div>}
    {error&&<div className="error-banner">{error}</div>}
    {!loading&&!error&&events.length===0&&<div className="class-empty">No approved Dungeon decisions yet.</div>}
    <div className="story-log-list">
      {events.map(entry=>{
        const verdict=entry.verdict
        const recipients=(verdict.recipients??[]).map(nameFor)
        const hasReward=Boolean(verdict.reward?.kind&&verdict.reward.kind!=='none')
        const badgeClass=hasReward&&verdict.reward.rarity!=='none'?'pill rarity-pill-'+verdict.reward.rarity:'pill'
        const badgeText=hasReward
          ? (rarityName(verdict.reward.rarity)+' '+verdict.reward.kind.replace('_',' '))
          : verdict.achievement?'Achievement':'No Reward'
        return <article className="story-entry broadcast-log-entry" key={entry.id}>
          <div className="story-entry-head">
            <div><div className="broadcast-kicker">ARCHIVED DUNGEON EVENT</div><span className="story-time">{formatTime(entry.createdAt)}</span></div>
            <span className={badgeClass}>{badgeText}</span>
          </div>
          <div className="story-event-text">{entry.eventText}</div>
          {recipients.length>0&&<div className="muted small">Crawler{recipients.length===1?'':'s'}: {recipients.join(', ')}</div>}
          {verdict.achievement&&<div className="story-result">
            <strong>🏆 {verdict.achievement.title}</strong>
            {verdict.achievement.commentary&&<div>{verdict.achievement.commentary}</div>}
          </div>}
          {hasReward&&<div className={'story-result story-reward rarity-'+verdict.reward.rarity}>
            <strong>🎁 {verdict.reward.name}</strong>
            {verdict.reward.effect&&<div>{verdict.reward.effect}</div>}
            {verdict.reward.quirk&&<div className="muted small">Quirk: {verdict.reward.quirk}</div>}
          </div>}
          {!verdict.achievement&&!hasReward&&<div className="muted small">The Dungeon approved this moment but awarded nothing.</div>}
          {verdict.reasoning_for_gm&&<details className="story-reasoning"><summary>GM reasoning</summary><div className="muted small">{verdict.reasoning_for_gm}</div></details>}
        </article>
      })}
    </div>
  </section>
}

function GM({game,characters,refresh}:{game:GameSummary;characters:Character[];refresh:()=>Promise<void>}) {
  const gameId=game.id
  const [selected,setSelected]=useState('')
  const [tab,setTab]=useState<'profiles'|'judge'|'story'|'settings'>('profiles')
  const [msg,setMsg]=useState('')
  const [itemName,setItemName]=useState('')
  const [itemRarity,setItemRarity]=useState<'B'|'S'|'G'>('B')
  const [itemType,setItemType]=useState<'Weapon'|'Armor'|'Accessory'|'Consumable'|'Utility'|'Quest'>('Utility')
  const [itemSlot,setItemSlot]=useState('')
  const [itemCoreValue,setItemCoreValue]=useState(0)
  const [itemStatBonuses,setItemStatBonuses]=useState<Character['stats']>(zeroStatBonuses())
  const [itemEffect,setItemEffect]=useState('')
  const [itemQuirk,setItemQuirk]=useState('')
  const [itemQuantity,setItemQuantity]=useState(1)
  const [skillName,setSkillName]=useState('')
  const [skillLevel,setSkillLevel]=useState(1)
  const [gameName,setGameName]=useState(game.name)
  const [floorNumber,setFloorNumber]=useState(game.floorNumber)
  const [floorTheme,setFloorTheme]=useState(game.floorTheme)
  const [settingsBusy,setSettingsBusy]=useState(false)
  const current=characters.find(c=>c.id===selected)||characters[0]
  const currentGearBonuses=current?equippedStatBonuses(current):zeroStatBonuses()
  const currentTotalConstitution=current?current.stats.Constitution+currentGearBonuses.Constitution:0
  useEffect(()=>{if(!selected&&characters[0])setSelected(characters[0].id)},[characters,selected])
  useEffect(()=>{
    setGameName(game.name)
    setFloorNumber(game.floorNumber)
    setFloorTheme(game.floorTheme)
  },[game.name,game.floorNumber,game.floorTheme])
  async function rpc(name:string,args:any){
    if(!supabase)return false
    setMsg('')
    const {error}=await supabase.rpc(name,args)
    if(error){setMsg(error.message);return false}
    await refresh()
    return true
  }

  async function grantItem(){
    if(!current||!itemName.trim())return
    const ok=await rpc('gm_grant_item',{
      p_character_id:current.id,
      p_name:itemName.trim(),
      p_rarity:itemRarity,
      p_item_type:itemType,
      p_slot:itemSlot||null,
      p_effect:itemEffect.trim(),
      p_quirk:itemQuirk.trim(),
      p_core_value:Math.max(0,Math.min(999,itemCoreValue||0)),
      p_quantity:Math.max(1,Math.min(99,itemQuantity||1)),
      p_strength_bonus:Math.max(0,Math.min(999,itemStatBonuses.Strength||0)),
      p_dexterity_bonus:Math.max(0,Math.min(999,itemStatBonuses.Dexterity||0)),
      p_intelligence_bonus:Math.max(0,Math.min(999,itemStatBonuses.Intelligence||0)),
      p_constitution_bonus:Math.max(0,Math.min(999,itemStatBonuses.Constitution||0)),
      p_charisma_bonus:Math.max(0,Math.min(999,itemStatBonuses.Charisma||0)),
    })
    if(ok){
      setItemName('')
      setItemCoreValue(0)
      setItemStatBonuses(zeroStatBonuses())
      setItemEffect('')
      setItemQuirk('')
      setItemQuantity(1)
      setMsg(`${itemRarity==='B'?'Bronze':itemRarity==='S'?'Silver':'Gold'} item granted to ${current.name}.`)
    }
  }

  async function addSkill(){
    if(!current||!skillName.trim())return
    const ok=await rpc('gm_set_skill',{
      p_character_id:current.id,
      p_name:skillName.trim(),
      p_rank:Math.max(1,Math.min(999,skillLevel||1)),
    })
    if(ok){
      setSkillName('')
      setSkillLevel(1)
      setMsg(`Skill added to ${current.name}.`)
    }
  }
  async function saveGameSettings(){
    const cleanName=gameName.trim()
    const cleanTheme=floorTheme.trim()
    const floor=Math.max(1,Math.min(999,Math.trunc(floorNumber||1)))
    if(!cleanName){setMsg('Game name is required.');return}
    setSettingsBusy(true);setMsg('')
    try{
      await updateGameSettings(gameId,cleanName,floor,cleanTheme)
      setFloorNumber(floor)
      await refresh()
      setMsg(`Game settings updated: ${cleanName} · Floor ${floor}${cleanTheme?` · ${cleanTheme}`:''}.`)
    }catch(e){
      setMsg(e instanceof Error?e.message:'Could not update game settings')
    }finally{
      setSettingsBusy(false)
    }
  }

  async function deletePlayer(character:Character){
    if(!supabase)return
    const confirmed=window.confirm(`Remove ${character.name} from this game? This permanently deletes their crawler, inventory, achievements, loot boxes, and trade history for this game.`)
    if(!confirmed)return
    setMsg('')
    const {error}=await supabase.rpc('gm_delete_player',{p_character_id:character.id})
    if(error){setMsg(error.message);return}
    setSelected('')
    await refresh()
    setMsg(`${character.name} was removed from the game.`)
  }
  async function renameCrawler(character:Character){
    const next=window.prompt('Rename crawler',character.name)?.trim()
    if(!next||next===character.name)return
    setMsg('')
    try{
      await renameCharacter(character.id,next)
      await refresh()
      setMsg(`Crawler renamed to ${next}.`)
    }catch(e){setMsg(e instanceof Error?e.message:'Could not rename crawler')}
  }

  async function renameItem(itemId:string,currentName:string){
    const next=window.prompt('Rename item',currentName)?.trim()
    if(!next||next===currentName)return
    setMsg('')
    try{
      await gmRenameItem(itemId,next)
      await refresh()
      setMsg(`Item renamed to ${next}.`)
    }catch(e){setMsg(e instanceof Error?e.message:'Could not rename item')}
  }
  async function copyRecoveryCode(character:Character){
    try{
      await navigator.clipboard.writeText(character.recoveryCode)
      setMsg(`Recovery code copied for ${character.name}.`)
    }catch{
      setMsg(`Recovery code: ${character.recoveryCode}`)
    }
  }

  async function regenerateRecoveryCode(character:Character){
    if(!supabase)return
    const confirmed=window.confirm(`Regenerate ${character.name}'s recovery code? Their old code will stop working immediately.`)
    if(!confirmed)return
    setMsg('')
    const {data,error}=await supabase.rpc('gm_regenerate_recovery_code',{p_character_id:character.id})
    if(error){setMsg(error.message);return}
    await refresh()
    setMsg(`New recovery code for ${character.name}: ${String(data)}`)
  }
  return <>
    <nav className="tabs"><button className={`button ${tab==='profiles'?'primary':''}`} onClick={()=>setTab('profiles')}><Users size={16}/>Party Profiles</button><button className={`button ${tab==='judge'?'primary':''}`} onClick={()=>setTab('judge')}><Sparkles size={16}/>Dungeon Judge</button><button className={`button ${tab==='story'?'primary':''}`} onClick={()=>setTab('story')}><ScrollText size={16}/>Story Log</button><button className={`button ${tab==='settings'?'primary':''}`} onClick={()=>setTab('settings')}><Settings size={16}/>Game Settings</button></nav>
    {msg&&<div className="status-message">{msg}</div>}
    {tab==='judge'&&<Judge gameId={gameId} characters={characters} refresh={refresh}/>}
    {tab==='story'&&<StoryLog gameId={gameId} characters={characters}/>}
    {tab==='settings'&&<section className="panel pad game-settings-panel">
      <div className="settings-hero">
        <div>
          <div className="broadcast-kicker">DUNGEON CONFIGURATION</div>
          <h2>Game & Floor Settings</h2>
          <p className="muted">These details update the live game for everyone connected.</p>
        </div>
        <span className="pill">Join Code {game.joinCode}</span>
      </div>
      <div className="game-settings-grid">
        <label>Game name<input value={gameName} maxLength={80} onChange={e=>setGameName(e.target.value)} placeholder="Friday Crawl"/></label>
        <label>Floor number<input type="number" min={1} max={999} value={floorNumber} onChange={e=>setFloorNumber(Number(e.target.value))}/></label>
        <label className="game-theme-field">Floor theme<input value={floorTheme} maxLength={120} onChange={e=>setFloorTheme(e.target.value)} placeholder="Examples: Goblin warrens, flooded crypt, abandoned mall"/></label>
      </div>
      <div className="floor-theme-preview">
        <div className="eyebrow">Current Floor Identity</div>
        <strong>FLOOR {Math.max(1,Math.trunc(floorNumber||1))}</strong>
        <span>{floorTheme.trim()||'No theme named yet.'}</span>
      </div>
      <button className="button primary settings-save-button" disabled={settingsBusy||!gameName.trim()} onClick={()=>void saveGameSettings()}>{settingsBusy?'SAVING…':'SAVE GAME SETTINGS'}</button>
    </section>}
    {tab==='profiles'&&!current&&<section className="panel pad"><h3>Waiting for crawlers</h3><p className="muted">Share the join code. Profiles appear here automatically.</p></section>}
    {tab==='profiles'&&current&&<div className="gm-layout"><aside className="panel pad"><h3>Party</h3>{characters.map(c=>{const gearBonus=equippedStatBonuses(c);return <div className={`roster-card-shell ${current.id===c.id?'selected':''}`} key={c.id}>
      <button className={`roster-card ${current.id===c.id?'selected':''}`} onClick={()=>setSelected(c.id)}>
        <div className="roster-avatar">
          {c.portraitUrl
            ? <img className="gm-roster-image" src={c.portraitUrl} alt={`${c.name} portrait`}/>
            : <Users size={28}/>}
        </div>
        <div className="roster-copy">
          <strong>{c.name}</strong>
          <div className="muted small">Level {c.level} · {c.background}</div>
          <HealthBar c={c.currentHealth} m={c.maxHealth}/>
          <div className="roster-core-stats" aria-label={`${c.name} current core stats`}>
            {stats.map(stat=><div className={`roster-stat ${gearBonus[stat]>0?'has-gear-bonus':''}`} key={stat}>
              <span>{stat.slice(0,3).toUpperCase()}</span>
              <strong>+{c.stats[stat]+gearBonus[stat]}</strong>
              {gearBonus[stat]>0&&<small>gear +{gearBonus[stat]}</small>}
            </div>)}
          </div>
        </div>
      </button>
      <details className="roster-skills-dropdown">
        <summary><span>Skills & Levels</span><span className="roster-skill-count">{c.skills.length}</span></summary>
        <div className="roster-skills-list">
          <div className="roster-level-row"><span>Crawler Level</span><strong>{c.level}</strong></div>
          {c.skills.length
            ? c.skills.map(skill=><div className="roster-skill-row" key={skill.name}><span>{skill.name}</span><strong>+{skill.rank}</strong></div>)
            : <div className="roster-skills-empty">No skills yet.</div>}
        </div>
      </details>
    </div>})}</aside><main className="profile-stack">
      <section className="panel pad gm-profile-hero">
        <div className="gm-profile-portrait">
          {current.portraitUrl
            ? <img className="gm-profile-image" src={current.portraitUrl} alt={`${current.name} portrait`}/>
            : <div className="gm-profile-empty"><Users size={44}/></div>}
        </div>
        <div className="gm-profile-main"><h2>{current.name}</h2><div className="muted">Level {current.level} · {current.background}</div><div className="gm-profile-health"><div className="eyebrow">Health</div><HealthBar c={current.currentHealth} m={current.maxHealth}/></div></div>
        <div className="gm-profile-actions"><button className="button" onClick={()=>void renameCrawler(current)}>Rename Player</button><button className="button danger-button" onClick={()=>void deletePlayer(current)}>Delete Player</button></div>
      </section>
      <section className="panel pad gm-core-stats-panel">
        <div className="section-title">
          <div><div className="eyebrow">GM Controls</div><h3>Core Stats</h3></div>
          <span className="pill">{current.unspentStatPoints} unspent</span>
        </div>
        <div className="gm-health-control-block">
          <div className="quick-actions">
            <button className="button primary" onClick={()=>void rpc('gm_level_up',{p_character_id:current.id,p_levels:1,p_points_per_level:1})}>Level Up +1</button>
          </div>
          <div className="gm-health-controls">
            <div className="gm-health-label"><span>Health Adjustment</span><HealthBar c={current.currentHealth} m={current.maxHealth}/><small>{currentTotalConstitution} total CON × 4 = {hpValue(current.maxHealth)} max HP</small></div>
            <div className="gm-health-buttons">
              <button className="button" onClick={()=>void rpc('gm_adjust_health',{p_character_id:current.id,p_quarters:-4})}>−1 HP</button>
              <button className="button" onClick={()=>void rpc('gm_adjust_health',{p_character_id:current.id,p_quarters:-1})}>−0.25 HP</button>
              <button className="button" onClick={()=>void rpc('gm_adjust_health',{p_character_id:current.id,p_quarters:1})}>+0.25 HP</button>
              <button className="button" onClick={()=>void rpc('gm_adjust_health',{p_character_id:current.id,p_quarters:4})}>+1 HP</button>
            </div>
          </div>
        </div>
        <div className="gm-stats-grid">{stats.map(s=><div className="gm-stat-card" key={s}>
          <span>{s}</span>
          <strong>+{current.stats[s]+currentGearBonuses[s]}</strong>
          {currentGearBonuses[s]>0&&<div className="stat-bonus-note">Base {current.stats[s]} + Gear {currentGearBonuses[s]}</div>}
          <div className="gm-stat-controls">
            <button className="button stat-step" aria-label={`Decrease ${s}`} onClick={()=>void rpc('gm_adjust_stat',{p_character_id:current.id,p_stat:s,p_delta:-1})}>−</button>
            <span className="muted small">Adjust</span>
            <button className="button stat-step" aria-label={`Increase ${s}`} onClick={()=>void rpc('gm_adjust_stat',{p_character_id:current.id,p_stat:s,p_delta:1})}>+</button>
          </div>
        </div>)}</div>
      </section>
      <div className="two-col">
        <section className="panel pad">
          <h3>Inventory</h3>
          {current.inventory.length?current.inventory.map(i=><div className={`tag-row gm-inventory-item rarity-${i.rarity}`} key={i.id}>
            <div className="gm-item-heading"><strong>{i.name}</strong><span className="pill">{i.rarity==='B'?'Bronze':i.rarity==='S'?'Silver':'Gold'} · Core {i.coreValue}</span></div>
            <div className="muted small">{i.type}{statBonusSummary(i.statBonuses)?` · ${statBonusSummary(i.statBonuses)} when equipped`:''}{(i.quantity??1)>1?` ×${i.quantity}`:''}</div>
            {i.effect&&<div className="small gm-item-copy">{i.effect}</div>}
            {i.quirk&&<div className="muted small">Quirk: {i.quirk}</div>}
            <div className="gm-item-actions">
              <details className="gm-item-bonus-editor">
                <summary>Item values & stat bonuses</summary>
                <div className="gm-core-value-editor">
                  <span className="muted small">Core value</span>
                  <button className="button stat-step" onClick={()=>void rpc('gm_adjust_item_core_value',{p_character_item_id:i.id,p_delta:-1})}>−</button>
                  <strong>{i.coreValue}</strong>
                  <button className="button stat-step" onClick={()=>void rpc('gm_adjust_item_core_value',{p_character_item_id:i.id,p_delta:1})}>+</button>
                </div>
                <div className="gm-item-stat-bonuses">{stats.map(stat=><div className="gm-item-stat-bonus-row" key={stat}>
                  <span>{stat.slice(0,3).toUpperCase()}</span>
                  <button className="button stat-step" onClick={()=>void rpc('gm_adjust_item_stat_bonus',{p_character_item_id:i.id,p_stat:stat,p_delta:-1})}>−</button>
                  <strong>+{i.statBonuses[stat]}</strong>
                  <button className="button stat-step" onClick={()=>void rpc('gm_adjust_item_stat_bonus',{p_character_item_id:i.id,p_stat:stat,p_delta:1})}>+</button>
                </div>)}</div>
              </details>
              <button className="button" onClick={()=>void renameItem(i.id,i.name)}>Rename</button>
              <button className="button" onClick={()=>void rpc('gm_remove_character_item',{p_character_item_id:i.id})}>Remove</button>
            </div>
          </div>):<div className="muted">Empty.</div>}
          <h3>Equipped Gear</h3>
          {gearSlots.map(slot=>{
            const i=current.gear[slot]
            return <div className={`tag-row gm-inventory-item ${i?`rarity-${i.rarity}`:''}`} key={slot}>
              <div className="gm-item-heading"><strong>{i?.name??'Empty'}</strong><span className="pill">{slot}</span></div>
              {i&&<>
                <div className="muted small">{i.type} · {i.rarity==='B'?'Bronze':i.rarity==='S'?'Silver':'Gold'} · Core {i.coreValue}{statBonusSummary(i.statBonuses)?` · ${statBonusSummary(i.statBonuses)}`:''}</div>
                {i.effect&&<div className="small gm-item-copy">{i.effect}</div>}
                <div className="gm-item-actions">
                  <details className="gm-item-bonus-editor">
                    <summary>Item values & stat bonuses</summary>
                    <div className="gm-core-value-editor">
                      <span className="muted small">Core value</span>
                      <button className="button stat-step" onClick={()=>void rpc('gm_adjust_item_core_value',{p_character_item_id:i.id,p_delta:-1})}>−</button>
                      <strong>{i.coreValue}</strong>
                      <button className="button stat-step" onClick={()=>void rpc('gm_adjust_item_core_value',{p_character_item_id:i.id,p_delta:1})}>+</button>
                    </div>
                    <div className="gm-item-stat-bonuses">{stats.map(stat=><div className="gm-item-stat-bonus-row" key={stat}>
                      <span>{stat.slice(0,3).toUpperCase()}</span>
                      <button className="button stat-step" onClick={()=>void rpc('gm_adjust_item_stat_bonus',{p_character_item_id:i.id,p_stat:stat,p_delta:-1})}>−</button>
                      <strong>+{i.statBonuses[stat]}</strong>
                      <button className="button stat-step" onClick={()=>void rpc('gm_adjust_item_stat_bonus',{p_character_item_id:i.id,p_stat:stat,p_delta:1})}>+</button>
                    </div>)}</div>
                  </details>
                  <button className="button" onClick={()=>void renameItem(i.id,i.name)}>Rename</button>
                  <button className="button" onClick={()=>void rpc('gm_remove_character_item',{p_character_item_id:i.id})}>Remove</button>
                </div>
              </>}
            </div>
          })}
        </section>

        <section className="panel pad">
          <h3>Grant Item</h3>
          <div className="gm-item-form">
            <label className="gm-form-wide">Item name<input value={itemName} onChange={e=>setItemName(e.target.value)} placeholder="Goblin Cleaver"/></label>
            <label>Rarity<select value={itemRarity} onChange={e=>setItemRarity(e.target.value as 'B'|'S'|'G')}><option value="B">Bronze</option><option value="S">Silver</option><option value="G">Gold</option></select></label>
            <label>Core value<input type="number" min={0} max={999} value={itemCoreValue} onChange={e=>setItemCoreValue(Number(e.target.value))}/></label>
            <fieldset className="gm-stat-bonus-fields gm-form-wide">
              <legend>Core stat bonuses while equipped</legend>
              <div className="gm-stat-bonus-inputs">{stats.map(stat=><label key={stat}>{stat}<input type="number" min={0} max={999} value={itemStatBonuses[stat]} onChange={e=>setItemStatBonuses(current=>({...current,[stat]:Math.max(0,Number(e.target.value)||0)}))}/></label>)}</div>
            </fieldset>
            <label>Item type<select value={itemType} onChange={e=>setItemType(e.target.value as typeof itemType)}><option>Weapon</option><option>Armor</option><option>Accessory</option><option>Consumable</option><option>Utility</option><option>Quest</option></select></label>
            <label>Equipment slot<select value={itemSlot} onChange={e=>setItemSlot(e.target.value)}><option value="">None</option><option>Head</option><option>Shirt</option><option>Pants</option><option>Hands</option><option>Feet</option><option>Weapon 1</option><option>Weapon 2</option><option>Accessory 1</option><option>Accessory 2</option></select></label>
            <label>Quantity<input type="number" min={1} max={99} value={itemQuantity} onChange={e=>setItemQuantity(Number(e.target.value))}/></label>
            <label className="gm-form-wide">Effect<textarea rows={3} value={itemEffect} onChange={e=>setItemEffect(e.target.value)} placeholder="What does it actually do?"/></label>
            <label className="gm-form-wide">Quirk<input value={itemQuirk} onChange={e=>setItemQuirk(e.target.value)} placeholder="Optional weirdness"/></label>
          </div>
          <button className={`button primary wide rarity-button-${itemRarity}`} disabled={!itemName.trim()} onClick={()=>void grantItem()}>Grant {itemRarity==='B'?'Bronze':itemRarity==='S'?'Silver':'Gold'} Item</button>

          <h3>Skills</h3>
          <div className="gm-skill-list">
            {current.skills.length?current.skills.map(s=><div className="gm-skill-row" key={s.name}>
              <span>{s.name}</span>
              <div className="skill-stepper">
                <button className="button stat-step" onClick={()=>void rpc('gm_adjust_skill',{p_character_id:current.id,p_name:s.name,p_delta:-1})}>−</button>
                <strong>+{s.rank}</strong>
                <button className="button stat-step" onClick={()=>void rpc('gm_adjust_skill',{p_character_id:current.id,p_name:s.name,p_delta:1})}>+</button>
              </div>
            </div>):<div className="muted">No skills yet.</div>}
          </div>
          <div className="gm-add-skill">
            <label>New skill<input value={skillName} onChange={e=>setSkillName(e.target.value)} placeholder="Lockpicking"/></label>
            <label>Starting level<input type="number" min={1} max={999} value={skillLevel} onChange={e=>setSkillLevel(Number(e.target.value))}/></label>
          </div>
          <button className="button wide" disabled={!skillName.trim()} onClick={()=>void addSkill()}>Add Skill</button>
          <div className="muted small gm-tool-note">Reducing a skill below +1 removes it.</div>
        </section>
      </div>
      <section className="panel pad crawler-recovery-panel">
        <div>
          <div className="eyebrow">Crawler Recovery</div>
          <h3>{current.recoveryCode}</h3>
          <div className="muted small">Send this code with the game join code if {current.name} needs to reclaim this crawler on another device.</div>
        </div>
        <div className="crawler-recovery-actions">
          <button className="button primary" onClick={()=>void copyRecoveryCode(current)}>Copy Code</button>
          <button className="button" onClick={()=>void regenerateRecoveryCode(current)}>Regenerate</button>
        </div>
      </section>

    </main></div>}
  </>
}

function Lobby({userId,isAnonymous,accountEmail,games,reload,open}:{userId:string;isAnonymous:boolean;accountEmail:string;games:GameSummary[];reload:()=>Promise<GameSummary[]>;open:(g:GameSummary)=>Promise<void>}) {
  const [name,setName]=useState('Friday Crawl')
  const [code,setCode]=useState('')
  const [msg,setMsg]=useState('')
  const [busy,setBusy]=useState(false)
  const [loginEmail,setLoginEmail]=useState('')
  const [loginPassword,setLoginPassword]=useState('')
  const [recoverGameCode,setRecoverGameCode]=useState('')
  const [recoveryCode,setRecoveryCode]=useState('')
  const ownsGame=games.some(g=>g.isOwner)

  async function make(){setBusy(true);try{const r=await createGame(name);setMsg(`Game created. Join code: ${r.joinCode}`);const g=(await reload()).find(x=>x.id===r.gameId);if(g)await open(g)}catch(e){setMsg(e instanceof Error?e.message:'Create failed')}finally{setBusy(false)}}
  async function join(){setBusy(true);try{await joinGame(code);const list=await reload();const g=list.find(x=>x.joinCode===code.trim().toUpperCase());if(g)await open(g)}catch(e){setMsg(e instanceof Error?e.message:'Join failed')}finally{setBusy(false)}}

  async function recover(){
    if(!recoverGameCode.trim()||!recoveryCode.trim())return
    setBusy(true);setMsg('')
    try{
      await recoverCrawler(recoverGameCode,recoveryCode)
      const list=await reload()
      const normalized=recoverGameCode.trim().toUpperCase()
      const g=list.find(x=>x.joinCode===normalized)
      if(!g)throw new Error('Crawler recovered, but the game could not be opened. Refresh and try again.')
      setMsg('Crawler recovered. Welcome back.')
      await open(g)
    }catch(e){
      setMsg(e instanceof Error?e.message:'Could not recover crawler')
    }finally{
      setBusy(false)
    }
  }

  async function createLogin(){
    if(!loginEmail.trim()||loginPassword.length<8)return
    setBusy(true);setMsg('')
    try{
      await createGmLogin(loginEmail,loginPassword)
      window.location.reload()
    }catch(e){
      setMsg(e instanceof Error?e.message:'Could not create GM login')
    }finally{
      setBusy(false)
    }
  }

  async function login(){
    if(!loginEmail.trim()||!loginPassword)return
    setBusy(true);setMsg('')
    try{
      await signInGm(loginEmail,loginPassword)
      window.location.reload()
    }catch(e){
      setMsg(e instanceof Error?e.message:'Could not sign in')
    }finally{
      setBusy(false)
    }
  }

  async function logout(){
    setBusy(true);setMsg('')
    try{
      await signOutUser()
      localStorage.removeItem('crawler-active-game')
      window.location.reload()
    }catch(e){
      setMsg(e instanceof Error?e.message:'Could not sign out')
      setBusy(false)
    }
  }

  async function removeGame(g:GameSummary){
    if(!g.isOwner)return
    const confirmed=window.confirm(`Delete "${g.name}" permanently? This removes the group, every crawler, inventory item, achievement, loot box, trade, and Dungeon event in it. This cannot be undone.`)
    if(!confirmed)return
    setBusy(true);setMsg('')
    try{
      await deleteGame(g.id)
      await reload()
      setMsg(`${g.name} was permanently deleted.`)
    }catch(e){
      setMsg(e instanceof Error?e.message:'Could not delete group')
    }finally{
      setBusy(false)
    }
  }

  return <div className="app-shell">
    <header className="topbar broadcast-topbar">
      <div className="topbar-copy"><div className="broadcast-kicker">DUNGEON NETWORK // ACCESS TERMINAL</div><h1>Crawler</h1><div className="muted">Multiplayer lobby</div></div>
      <span className="pill topbar-role-pill">{isAnonymous?`DEVICE · ${userId.slice(0,8)}`:`GM ACCOUNT · ${accountEmail}`}</span>
    </header>

    {isAnonymous
      ? <section className="panel pad gm-login-panel">
          <div className="gm-login-copy">
            <h3>GM Login</h3>
            <p className="muted">{ownsGame?'Create a permanent GM login to open these groups from any phone, tablet, or computer.':'Already created a GM login? Sign in here to access your groups from this device.'}</p>
          </div>
          <div className="gm-login-fields">
            <label>Email<input type="email" autoComplete="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} placeholder="you@example.com"/></label>
            <label>Password<input type="password" autoComplete={ownsGame?'new-password':'current-password'} value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} placeholder="At least 8 characters"/></label>
          </div>
          <div className="gm-login-actions">
            {ownsGame&&<button className="button primary" disabled={busy||!loginEmail.trim()||loginPassword.length<8} onClick={()=>void createLogin()}>Create GM Login</button>}
            <button className={`button ${ownsGame?'':'primary'}`} disabled={busy||!loginEmail.trim()||!loginPassword} onClick={()=>void login()}>Sign In as GM</button>
          </div>
          {ownsGame&&<div className="muted small">Creating the login keeps your existing groups, players, loot, and game history attached to the new account.</div>}
        </section>
      : <section className="panel pad signed-in-panel">
          <div><div className="eyebrow">GM Account</div><strong>{accountEmail}</strong><div className="muted small">You can sign into this account from another device.</div></div>
          <button className="button" disabled={busy} onClick={()=>void logout()}>Sign Out</button>
        </section>}

    {games.length>0&&<section className="panel pad games-panel"><div className="section-title"><div><div className="eyebrow">Active Groups</div><h3>My Games</h3></div><span className="pill">{games.length} total</span></div><div className="game-list">{games.map(g=><div className="game-card-shell" key={g.id}><button className="game-card game-open-card" disabled={busy} onClick={()=>void open(g)}><div><strong>{g.name}</strong><div className="muted small">{g.isOwner?'Owner · ':g.role==='gm'?'GM · ':'Crawler · '}Floor {g.floorNumber}</div></div><span className="join-code">{g.joinCode}</span></button>{g.isOwner&&<button className="button danger-button game-delete-button" disabled={busy} onClick={()=>void removeGame(g)}>Delete Group</button>}</div>)}</div></section>}

    <div className="two-col lobby-grid">
      <section className="panel pad"><h3>Create Game</h3><input value={name} onChange={e=>setName(e.target.value)}/><button className="button primary wide" disabled={busy} onClick={()=>void make()}>Create Game</button></section>
      <section className="panel pad"><h3>Join Game</h3><input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="JOIN CODE"/><button className="button primary wide" disabled={busy} onClick={()=>void join()}>Join Game</button></section>
    </div>

    <section className="panel pad recovery-login-panel">
      <div className="section-title"><div><div className="eyebrow">Returning Player</div><h3>Recover My Crawler</h3></div></div>
      <p className="muted small">On a new device, enter the game join code plus the recovery code your GM gave you.</p>
      <div className="recovery-login-fields">
        <label>Game code<input value={recoverGameCode} onChange={e=>setRecoverGameCode(e.target.value.toUpperCase())} placeholder="JOIN CODE"/></label>
        <label>Crawler recovery code<input value={recoveryCode} onChange={e=>setRecoveryCode(e.target.value.toUpperCase())} placeholder="K7M4-P2Q9"/></label>
      </div>
      <button className="button primary wide" disabled={busy||!recoverGameCode.trim()||!recoveryCode.trim()} onClick={()=>void recover()}>Recover My Crawler</button>
      <div className="muted small">Recovering moves control of that crawler to this device. The old device will no longer control it.</div>
    </section>
    {msg&&<div className="status-message">{msg}</div>}
  </div>
}

export default function App(){
  const [userId,setUserId]=useState('')
  const [isAnonymous,setIsAnonymous]=useState(true)
  const [accountEmail,setAccountEmail]=useState('')
  const [games,setGames]=useState<GameSummary[]>([])
  const [game,setGame]=useState<GameSummary|null>(null)
  const [characters,setCharacters]=useState<Character[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [liveStatus,setLiveStatus]=useState<'connecting'|'live'|'reconnecting'>('connecting')

  async function reloadGames(uid=userId){if(!uid)return[];const g=await listMyGames(uid);setGames(g);return g}
  async function refresh(g=game){
    if(!g)return
    const charactersPromise=loadCharacters(g.id)
    const gamesPromise=userId?listMyGames(userId):Promise.resolve<GameSummary[]|null>(null)
    const [nextCharacters,nextGames]=await Promise.all([charactersPromise,gamesPromise])
    setCharacters(nextCharacters)
    if(nextGames){
      setGames(nextGames)
      const updated=nextGames.find(item=>item.id===g.id)
      if(updated)setGame(updated)
    }
  }
  async function open(g:GameSummary){setGame(g);localStorage.setItem('crawler-active-game',g.id);await refresh(g)}

  useEffect(()=>{if(!supabaseConfigured){setLoading(false);return}void(async()=>{try{const u=await ensureAnonymousUser();setUserId(u.id);setIsAnonymous(Boolean(u.is_anonymous));setAccountEmail(String(u.email??''));const gs=await listMyGames(u.id);setGames(gs);const remembered=gs.find(g=>g.id===localStorage.getItem('crawler-active-game'));if(remembered)await open(remembered)}catch(e){setError(e instanceof Error?e.message:'Startup failed')}finally{setLoading(false)}})()},[])
  useEffect(()=>{
    if(!game)return
    setLiveStatus('connecting')
    const ch=subscribeToGame(
      game.id,
      ()=>void refresh(game),
      status=>setLiveStatus(status==='SUBSCRIBED'?'live':'reconnecting'),
    )
    return()=>{void supabase?.removeChannel(ch)}
  },[game?.id])
  useEffect(()=>{
    if(!game)return
    const sync=()=>{if(document.visibilityState==='visible')void refresh(game)}
    window.addEventListener('focus',sync)
    document.addEventListener('visibilitychange',sync)
    return()=>{
      window.removeEventListener('focus',sync)
      document.removeEventListener('visibilitychange',sync)
    }
  },[game?.id])

  if(!supabaseConfigured)return <div className="app-shell"><section className="panel pad"><h2>Crawler needs Supabase configuration</h2><p className="muted">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the deployment environment.</p></section></div>
  if(loading)return <div className="app-shell"><section className="panel pad system-loading-panel"><div className="system-loading-mark">⚠</div><div><div className="broadcast-kicker">DUNGEON NETWORK</div><h2>Opening the Dungeon…</h2><div className="system-loading-bar"><span/></div></div></section></div>
  if(error)return <div className="app-shell"><section className="panel pad fatal-panel"><div className="broadcast-kicker">ACCESS FAILURE</div><h2>Could not enter</h2><p>{error}</p></section></div>
  if(!game)return <Lobby userId={userId} isAnonymous={isAnonymous} accountEmail={accountEmail} games={games} reload={()=>reloadGames(userId)} open={open}/>

  const me=characters.find(c=>c.userId===userId)
  return <div className="app-shell">
    <header className="topbar broadcast-topbar game-topbar">
      <div className="topbar-copy">
        <div className="broadcast-kicker">DUNGEON NETWORK // FLOOR {game.floorNumber}</div>
        <h1>{game.name}</h1>
        <div className="topbar-meta"><span>Floor {game.floorNumber}</span>{game.floorTheme&&<><span className="topbar-divider">/</span><span>{game.floorTheme}</span></>}<span className="topbar-divider">/</span><span>Join code <strong className="join-code inline-code">{game.joinCode}</strong></span></div>
      </div>
      <div className="topbar-actions">
        <span className={`pill topbar-role-pill role-${game.role}`}>{game.role==='gm'?'GM CONTROL':'CRAWLER'}</span>
        <button className="button lobby-return-button" onClick={()=>{setGame(null);localStorage.removeItem('crawler-active-game')}}>Lobby</button>
      </div>
    </header>
    <div className={`system-strip live-status-${liveStatus}`}><span className="system-dot"/><strong>{liveStatus==='live'?'SYSTEM ONLINE':liveStatus==='connecting'?'CONNECTING':'RECONNECTING'}</strong><span>{liveStatus==='live'?'Live multiplayer connected':'Syncing live game state…'}</span><span className="system-strip-spacer"/><span className="system-floor">FLOOR {game.floorNumber}</span></div>
    {game.role==='gm'?<GM game={game} characters={characters} refresh={()=>refresh(game)}/>:me?!me.setupComplete?<Setup character={me} onDone={()=>refresh(game)}/>:<Player gameId={game.id} character={me} refresh={()=>refresh(game)}/>:<section className="panel pad"><p>Preparing your crawler…</p></section>}
  </div>
}
