import { useEffect, useState } from 'react'
import { Brain, Gift, Package, Sparkles, Trophy, Users } from 'lucide-react'
import type { Character, DungeonVerdict } from './lib/types'
import { supabase, supabaseConfigured } from './lib/supabase'
import {
  applyDungeonVerdict, completeCharacterSetup, createGame, createGmLogin, deleteGame, ensureAnonymousUser, joinGame,
  listMyGames, loadCharacters, openLootBox, persistCharacterDiff, signInGm, signOutUser, subscribeToGame,
} from './lib/live'
import type { GameSummary } from './lib/live'

const stats = ['Strength','Dexterity','Intelligence','Constitution','Charisma'] as const
function Hearts({c,m}:{c:number;m:number}) {
  return <div className="hearts">{Array.from({length:m},(_,i)=><span key={i} className={i<c?'heart':'heart empty'}>♥</span>)}</div>
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
            maxLength={1200}
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

function Player({character,refresh}:{character:Character;refresh:()=>Promise<void>}) {
  const [tab,setTab]=useState<'crawler'|'inventory'|'loot'|'achievements'>('crawler')
  const [msg,setMsg]=useState('')
  const [busy,setBusy]=useState(false)
  const [uploadingPortrait,setUploadingPortrait]=useState(false)

  async function uploadPortrait(file:File){
    if(!file)return
    setMsg('')
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
      setMsg('Use a JPG, PNG, or WebP image.')
      return
    }
    if(file.size>5*1024*1024){
      setMsg('Player images must be 5 MB or smaller.')
      return
    }
    setUploadingPortrait(true)
    try{
      const dataUrl=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader()
        reader.onload=()=>resolve(String(reader.result))
        reader.onerror=()=>reject(new Error('Could not read that image.'))
        reader.readAsDataURL(file)
      })
      await persistCharacterDiff(character,{...character,portraitUrl:dataUrl},character.userId)
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
    setBusy(true);setMsg('')
    try{const r=await openLootBox(id);setMsg(`${r.openingMessage} — You received ${r.item.name}.`);await refresh()}
    catch(e){setMsg(e instanceof Error?e.message:'Box failed to open')}finally{setBusy(false)}
  }
  return <>
    <section className="panel pad player-header"><div><h2>{character.name} <span className="pill">Level {character.level}</span></h2><div className="muted">{character.background}</div></div><div><div className="eyebrow">Health</div><Hearts c={character.currentHealth} m={character.maxHealth}/></div></section>
    {character.unspentStatPoints>0&&<div className="live-banner"><strong>LEVEL UP!</strong> You have {character.unspentStatPoints} stat point{character.unspentStatPoints===1?'':'s'} to spend.</div>}
    <nav className="tabs"><button className={`button ${tab==='crawler'?'primary':''}`} onClick={()=>setTab('crawler')}><Users size={16}/>Crawler</button><button className={`button ${tab==='inventory'?'primary':''}`} onClick={()=>setTab('inventory')}><Package size={16}/>Inventory</button><button className={`button ${tab==='loot'?'primary':''}`} onClick={()=>setTab('loot')}><Gift size={16}/>Loot</button><button className={`button ${tab==='achievements'?'primary':''}`} onClick={()=>setTab('achievements')}><Trophy size={16}/>Achievements</button></nav>
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
            accept="image/jpeg,image/png,image/webp"
            disabled={uploadingPortrait}
            onChange={e=>{const file=e.target.files?.[0];if(file)void uploadPortrait(file);e.currentTarget.value=''}}
          />
        </label>
        <div className="muted small portrait-help">JPG, PNG, or WebP · max 5 MB</div>
      </section>
      <div className="crawler-details">
        <div className="two-col"><section className="panel pad"><h3><Brain size={18}/>Stats</h3><div className="stats-grid">{stats.map(s=><div className="stat" key={s}><span>{s}</span><strong>+{character.stats[s]}</strong>{character.unspentStatPoints>0&&<button className="button" disabled={busy} onClick={()=>void spend(s)}>+1</button>}</div>)}</div><h3>Conditions</h3><div className="chips">{character.conditions.length?character.conditions.map(x=><span className="pill" key={x}>{x}</span>):<span className="muted">None</span>}</div></section><section className="panel pad"><h3>Skills</h3>{character.skills.map(s=><div className="line-row" key={s.name}><span>{s.name}</span><strong>+{s.rank}</strong></div>)}<h3>Perks</h3>{character.perks.length?character.perks.map(x=><div className="tag-row" key={x}>{x}</div>):<div className="muted">None yet.</div>}</section></div>
      </div>
    </div>}
    {tab==='inventory'&&<section className="panel pad"><h3>Backpack</h3><div className="card-grid">{character.inventory.length?character.inventory.map(i=><div className={`item-card rarity-${i.rarity}`} key={i.id}><strong>{i.name}</strong><div className="muted small">{i.rarity==='B'?'Bronze':i.rarity==='S'?'Silver':'Gold'} · {i.type} · Core {i.coreValue}{(i.quantity??1)>1?` ×${i.quantity}`:''}</div><div>{i.effect}</div>{i.quirk&&<div className="muted small">Quirk: {i.quirk}</div>}</div>):<div className="muted">Empty.</div>}</div><h3>Equipped Gear</h3><div className="card-grid">{Object.entries(character.gear).map(([slot,i])=><div className="item-card" key={slot}><div className="gear-label">{slot}</div><strong>{i?.name??'Empty'}</strong>{i&&<><div className="muted small">{i.rarity==='B'?'Bronze':i.rarity==='S'?'Silver':'Gold'} · Core {i.coreValue}</div><div className="muted small">{i.effect}</div></>}</div>)}</div></section>}
    {tab==='loot'&&<section className="panel pad"><h3>Unopened Loot Boxes</h3><div className="card-grid">{character.boxes.length?character.boxes.map(b=><div className={`item-card rarity-${b.rarity}`} key={b.id}><strong>🎁 {b.name}</strong><button className="button primary wide" disabled={busy} onClick={()=>void openBox(b.id)}>Open Box</button></div>):<div className="muted">No unopened boxes.</div>}</div></section>}
    {tab==='achievements'&&<section className="panel pad"><h3>Achievements</h3>{character.achievements.length?character.achievements.map(a=><div className="tag-row" key={a.id}>🏆 <strong>{a.name}</strong><div className="muted small">{a.commentary}</div></div>):<div className="muted">None yet.</div>}</section>}
  </>
}

function Judge({gameId,characters,refresh}:{gameId:string;characters:Character[];refresh:()=>Promise<void>}) {
  const [event,setEvent]=useState('')
  const [verdict,setVerdict]=useState<DungeonVerdict|null>(null)
  const [busy,setBusy]=useState(false)
  const [msg,setMsg]=useState('')
  async function judge(){
    if(!supabase||!event.trim())return
    setBusy(true);setMsg('')
    try{
      const {data,error}=await supabase.functions.invoke('dungeon-judge',{body:{gameId,event,tone:'unhinged',frequency:'balanced',characters:characters.map(c=>({id:c.id,name:c.name,level:c.level,stats:c.stats,health:[c.currentHealth,c.maxHealth],skills:c.skills,gear:Object.values(c.gear).filter(Boolean)}))}})
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
  return <section className="panel pad"><h3><Sparkles size={18}/>Dungeon Judge</h3><textarea rows={5} value={event} onChange={e=>setEvent(e.target.value)} placeholder="Describe what the crawlers just did…"/><button className="button primary" disabled={busy} onClick={()=>void judge()}>{busy?'Judging…':'Let the Dungeon Judge'}</button>{verdict&&<div className="loot-reveal"><h2>{verdict.should_reward?(verdict.achievement?.title||verdict.reward.name):'No Reward'}</h2><p>{verdict.achievement?.commentary||'The Dungeon is not impressed.'}</p>{verdict.reward.kind!=='none'&&<div className="item-card"><strong>{verdict.reward.name}</strong><div>{verdict.reward.effect}</div></div>}<div className="muted small">{verdict.reasoning_for_gm}</div><button className="button primary wide" onClick={()=>void apply()}>Apply Decision</button></div>}{msg&&<div className="status-message">{msg}</div>}</section>
}

function GM({gameId,characters,refresh}:{gameId:string;characters:Character[];refresh:()=>Promise<void>}) {
  const [selected,setSelected]=useState('')
  const [tab,setTab]=useState<'profiles'|'judge'>('profiles')
  const [msg,setMsg]=useState('')
  const [itemName,setItemName]=useState('')
  const [itemRarity,setItemRarity]=useState<'B'|'S'|'G'>('B')
  const [itemType,setItemType]=useState<'Weapon'|'Armor'|'Accessory'|'Consumable'|'Utility'|'Quest'>('Utility')
  const [itemSlot,setItemSlot]=useState('')
  const [itemCoreValue,setItemCoreValue]=useState(0)
  const [itemEffect,setItemEffect]=useState('')
  const [itemQuirk,setItemQuirk]=useState('')
  const [itemQuantity,setItemQuantity]=useState(1)
  const [skillName,setSkillName]=useState('')
  const [skillLevel,setSkillLevel]=useState(1)
  const current=characters.find(c=>c.id===selected)||characters[0]
  useEffect(()=>{if(!selected&&characters[0])setSelected(characters[0].id)},[characters,selected])
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
    })
    if(ok){
      setItemName('')
      setItemCoreValue(0)
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
  if(!current&&tab==='profiles')return <section className="panel pad"><h3>Waiting for crawlers</h3><p className="muted">Share the join code. Profiles appear here automatically.</p></section>
  return <>
    <nav className="tabs"><button className={`button ${tab==='profiles'?'primary':''}`} onClick={()=>setTab('profiles')}><Users size={16}/>Party Profiles</button><button className={`button ${tab==='judge'?'primary':''}`} onClick={()=>setTab('judge')}><Sparkles size={16}/>Dungeon Judge</button></nav>
    {msg&&<div className="status-message">{msg}</div>}
    {tab==='judge'&&<Judge gameId={gameId} characters={characters} refresh={refresh}/>}
    {tab==='profiles'&&current&&<div className="gm-layout"><aside className="panel pad"><h3>Party</h3>{characters.map(c=><button className={`roster-card ${current.id===c.id?'selected':''}`} key={c.id} onClick={()=>setSelected(c.id)}>
      <div className="roster-avatar">
        {c.portraitUrl
          ? <img className="gm-roster-image" src={c.portraitUrl} alt={`${c.name} portrait`}/>
          : <Users size={28}/>}
      </div>
      <div className="roster-copy"><strong>{c.name}</strong><div className="muted small">Level {c.level} · {c.background}</div><Hearts c={c.currentHealth} m={c.maxHealth}/></div>
    </button>)}</aside><main className="profile-stack">
      <section className="panel pad gm-profile-hero">
        <div className="gm-profile-portrait">
          {current.portraitUrl
            ? <img className="gm-profile-image" src={current.portraitUrl} alt={`${current.name} portrait`}/>
            : <div className="gm-profile-empty"><Users size={44}/></div>}
        </div>
        <div className="gm-profile-main"><h2>{current.name}</h2><div className="muted">Level {current.level} · {current.background}</div><div className="gm-profile-health"><div className="eyebrow">Health</div><Hearts c={current.currentHealth} m={current.maxHealth}/></div></div>
        <div className="gm-profile-actions"><button className="button danger-button" onClick={()=>void deletePlayer(current)}>Delete Player</button></div>
      </section>
      <section className="panel pad"><div className="quick-actions"><button className="button primary" onClick={()=>void rpc('gm_level_up',{p_character_id:current.id,p_levels:1,p_points_per_level:1})}>Level Up +1</button><button className="button" onClick={()=>void supabase?.from('characters').update({current_health:Math.max(0,current.currentHealth-1)}).eq('id',current.id).then(()=>refresh())}>−1 Health</button><button className="button" onClick={()=>void supabase?.from('characters').update({current_health:Math.min(current.maxHealth,current.currentHealth+1)}).eq('id',current.id).then(()=>refresh())}>+1 Health</button></div><div className="muted small">Unspent stat points: {current.unspentStatPoints}</div><div className="stats-grid">{stats.map(s=><div className="stat" key={s}><span>{s}</span><strong>+{current.stats[s]}</strong><div className="inline-actions"><button className="button" onClick={()=>void rpc('gm_adjust_stat',{p_character_id:current.id,p_stat:s,p_delta:-1})}>−</button><button className="button" onClick={()=>void rpc('gm_adjust_stat',{p_character_id:current.id,p_stat:s,p_delta:1})}>+</button></div></div>)}</div></section>
      <div className="two-col">
        <section className="panel pad">
          <h3>Inventory</h3>
          {current.inventory.length?current.inventory.map(i=><div className={`tag-row gm-inventory-item rarity-${i.rarity}`} key={i.id}>
            <div className="gm-item-heading"><strong>{i.name}</strong><span className="pill">{i.rarity==='B'?'Bronze':i.rarity==='S'?'Silver':'Gold'} · Core {i.coreValue}</span></div>
            <div className="muted small">{i.type}{(i.quantity??1)>1?` ×${i.quantity}`:''}</div>
            {i.effect&&<div className="small gm-item-copy">{i.effect}</div>}
            {i.quirk&&<div className="muted small">Quirk: {i.quirk}</div>}
            <div className="gm-item-actions">
              <span className="muted small">Core value</span>
              <button className="button stat-step" onClick={()=>void rpc('gm_adjust_item_core_value',{p_character_item_id:i.id,p_delta:-1})}>−</button>
              <strong>{i.coreValue}</strong>
              <button className="button stat-step" onClick={()=>void rpc('gm_adjust_item_core_value',{p_character_item_id:i.id,p_delta:1})}>+</button>
              <button className="button" onClick={()=>void rpc('gm_remove_character_item',{p_character_item_id:i.id})}>Remove</button>
            </div>
          </div>):<div className="muted">Empty.</div>}
        </section>

        <section className="panel pad">
          <h3>Grant Item</h3>
          <div className="gm-item-form">
            <label className="gm-form-wide">Item name<input value={itemName} onChange={e=>setItemName(e.target.value)} placeholder="Goblin Cleaver"/></label>
            <label>Rarity<select value={itemRarity} onChange={e=>setItemRarity(e.target.value as 'B'|'S'|'G')}><option value="B">Bronze</option><option value="S">Silver</option><option value="G">Gold</option></select></label>
            <label>Core value<input type="number" min={0} max={999} value={itemCoreValue} onChange={e=>setItemCoreValue(Number(e.target.value))}/></label>
            <label>Item type<select value={itemType} onChange={e=>setItemType(e.target.value as typeof itemType)}><option>Weapon</option><option>Armor</option><option>Accessory</option><option>Consumable</option><option>Utility</option><option>Quest</option></select></label>
            <label>Equipment slot<select value={itemSlot} onChange={e=>setItemSlot(e.target.value)}><option value="">None</option><option>Head</option><option>Body</option><option>Hands</option><option>Feet</option><option>Weapon 1</option><option>Weapon 2</option><option>Accessory 1</option><option>Accessory 2</option></select></label>
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
  const ownsGame=games.some(g=>g.isOwner)

  async function make(){setBusy(true);try{const r=await createGame(name);setMsg(`Game created. Join code: ${r.joinCode}`);const g=(await reload()).find(x=>x.id===r.gameId);if(g)await open(g)}catch(e){setMsg(e instanceof Error?e.message:'Create failed')}finally{setBusy(false)}}
  async function join(){setBusy(true);try{await joinGame(code);const list=await reload();const g=list.find(x=>x.joinCode===code.trim().toUpperCase());if(g)await open(g)}catch(e){setMsg(e instanceof Error?e.message:'Join failed')}finally{setBusy(false)}}

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
    <header className="topbar">
      <div><h1>Crawler</h1><div className="muted">Multiplayer lobby</div></div>
      <span className="pill">{isAnonymous?`Device ${userId.slice(0,8)}`:`GM · ${accountEmail}`}</span>
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

    {games.length>0&&<section className="panel pad"><h3>My Games</h3><div className="game-list">{games.map(g=><div className="game-card-shell" key={g.id}><button className="game-card game-open-card" disabled={busy} onClick={()=>void open(g)}><div><strong>{g.name}</strong><div className="muted small">{g.isOwner?'Owner · ':g.role==='gm'?'GM · ':'Crawler · '}Floor {g.floorNumber}</div></div><span className="join-code">{g.joinCode}</span></button>{g.isOwner&&<button className="button danger-button game-delete-button" disabled={busy} onClick={()=>void removeGame(g)}>Delete Group</button>}</div>)}</div></section>}

    <div className="two-col lobby-grid">
      <section className="panel pad"><h3>Create Game</h3><input value={name} onChange={e=>setName(e.target.value)}/><button className="button primary wide" disabled={busy} onClick={()=>void make()}>Create Game</button></section>
      <section className="panel pad"><h3>Join Game</h3><input value={code} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="JOIN CODE"/><button className="button primary wide" disabled={busy} onClick={()=>void join()}>Join Game</button></section>
    </div>
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

  async function reloadGames(uid=userId){if(!uid)return[];const g=await listMyGames(uid);setGames(g);return g}
  async function refresh(g=game){if(!g)return;setCharacters(await loadCharacters(g.id))}
  async function open(g:GameSummary){setGame(g);localStorage.setItem('crawler-active-game',g.id);await refresh(g)}

  useEffect(()=>{if(!supabaseConfigured){setLoading(false);return}void(async()=>{try{const u=await ensureAnonymousUser();setUserId(u.id);setIsAnonymous(Boolean(u.is_anonymous));setAccountEmail(String(u.email??''));const gs=await listMyGames(u.id);setGames(gs);const remembered=gs.find(g=>g.id===localStorage.getItem('crawler-active-game'));if(remembered)await open(remembered)}catch(e){setError(e instanceof Error?e.message:'Startup failed')}finally{setLoading(false)}})()},[])
  useEffect(()=>{if(!game)return;const ch=subscribeToGame(game.id,()=>void refresh(game));return()=>{void supabase?.removeChannel(ch)}},[game?.id])

  if(!supabaseConfigured)return <div className="app-shell"><section className="panel pad"><h2>Crawler needs Supabase configuration</h2><p className="muted">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the deployment environment.</p></section></div>
  if(loading)return <div className="app-shell"><section className="panel pad"><h2>Opening the Dungeon…</h2></section></div>
  if(error)return <div className="app-shell"><section className="panel pad"><h2>Could not enter</h2><p>{error}</p></section></div>
  if(!game)return <Lobby userId={userId} isAnonymous={isAnonymous} accountEmail={accountEmail} games={games} reload={()=>reloadGames(userId)} open={open}/>

  const me=characters.find(c=>c.userId===userId)
  return <div className="app-shell"><header className="topbar"><div><h1>{game.name}</h1><div className="muted">Floor {game.floorNumber} · Join code <strong>{game.joinCode}</strong></div></div><button className="button" onClick={()=>{setGame(null);localStorage.removeItem('crawler-active-game')}}>Lobby</button></header><div className="live-banner">Live multiplayer connected.</div>{game.role==='gm'?<GM gameId={game.id} characters={characters} refresh={()=>refresh(game)}/>:me?!me.setupComplete?<Setup character={me} onDone={()=>refresh(game)}/>:<Player character={me} refresh={()=>refresh(game)}/>:<section className="panel pad"><p>Preparing your crawler…</p></section>}</div>
}
