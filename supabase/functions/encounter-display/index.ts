import { createClient } from 'npm:@supabase/supabase-js@2.104.1'
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json','Cache-Control':'no-store'}
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers})
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers})
  if(req.method!=='POST')return reply({error:'POST required'},405)
  try{
    // Capability authentication: this unguessable per-game token grants only
    // the presentation fields below. It cannot read the encounter table or mutate it.
    const {token,knownRevealId,knownEnemyId}=await req.json()
    if(typeof token!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token))return reply({error:'Invalid player screen link'},404)
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})
    const {data:display,error}=await admin.from('encounter_displays').select('game_id,enemy_id,reveal_id,idle_image_path').eq('display_token',token).maybeSingle()
    if(error)throw error
    if(!display)return reply({error:'This player screen link is no longer active.'},404)
    async function idleImageUrl(){
      if(!display.idle_image_path?.startsWith(`${display.game_id}/display/`))return null
      const {data:idleImage,error:idleImageError}=await admin.storage.from('enemy-art').createSignedUrl(display.idle_image_path,3600)
      if(idleImageError)throw idleImageError
      return idleImage.signedUrl
    }
    if(!display.enemy_id){
      if(knownRevealId===display.reveal_id && !knownEnemyId)return reply({unchanged:true})
      return reply({revealId:display.reveal_id,enemy:null,idleImageUrl:await idleImageUrl()})
    }
    const {data:enemy,error:enemyError}=await admin.from('encounter_enemies').select('id,name,level,enemy_kind,entrance,image_path,image_status,current_hp').eq('id',display.enemy_id).eq('game_id',display.game_id).maybeSingle()
    if(enemyError)throw enemyError
    if(!enemy||enemy.image_status!=='ready'||!enemy.image_path?.startsWith(`${display.game_id}/${enemy.id}/`))return reply({revealId:display.reveal_id,enemy:null,idleImageUrl:await idleImageUrl()})
    const defeated=Number(enemy.current_hp)<=0
    if(!defeated && knownRevealId===display.reveal_id && knownEnemyId===enemy.id)return reply({unchanged:true})
    const {data:image,error:imageError}=await admin.storage.from('enemy-art').createSignedUrl(enemy.image_path,3600)
    if(imageError)throw imageError
    if(defeated){
      const {error:clearError}=await admin.from('encounter_displays')
        .update({enemy_id:null,reveal_id:crypto.randomUUID()})
        .eq('game_id',display.game_id).eq('enemy_id',enemy.id)
      if(clearError)throw clearError
    }
    return reply({revealId:display.reveal_id,idleImageUrl:await idleImageUrl(),enemy:{id:enemy.id,name:enemy.name,level:enemy.level,kind:enemy.enemy_kind,entrance:enemy.entrance,imageUrl:image.signedUrl,defeated}})
  }catch(e){console.error('Display failed',e instanceof Error?e.message:e);return reply({error:'Player screen is reconnecting. Please wait.'},503)}
})
