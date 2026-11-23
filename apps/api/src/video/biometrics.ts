import {createHmac,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {StudioStore} from '../persistence/storage';
import {ApiError} from '../errors';
import {readBounded} from '../media/bounded-response';
import {videoProviderEndpoint} from './video-provider';

type Person={org:string;subject:string};
type Row=Person & {ref:string;state:'enrolling'|'active'|'deleting'|'deleted';policy:string;vault_origin:string};
const id=z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/);
const erased=['samples','models','scene-cache','recordings'] as const;
export function vaultConfig() {
  const base=videoProviderEndpoint(process.env.STUDIO_BIOMETRIC_VAULT_URL), token=process.env.STUDIO_BIOMETRIC_VAULT_KEY?.trim(),
    policy=process.env.STUDIO_BIOMETRIC_CONSENT_VERSION?.trim();
  if(!base || !token || !policy) return;
  return {base,token,policy};
}
export class BiometricVault {
  private drains=new Map<string,Promise<boolean>>();
  private timer:ReturnType<typeof setInterval>;
  private closed=false;
  private polling?:Promise<void>;
  private cursor='';
  private shutdown=new AbortController();
  constructor(private store:StudioStore,private purgeLocal:(ref:string)=>Promise<void>,private config=vaultConfig()) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS biometric_accounts(org TEXT NOT NULL,subject TEXT NOT NULL,ref TEXT UNIQUE NOT NULL,
      state TEXT NOT NULL,policy TEXT NOT NULL, PRIMARY KEY(org,subject));
      CREATE TABLE IF NOT EXISTS biometric_access(id INTEGER PRIMARY KEY,ref TEXT NOT NULL,action TEXT NOT NULL,at TEXT NOT NULL,detail TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS biometric_artifacts(ref TEXT NOT NULL,kind TEXT NOT NULL,key TEXT NOT NULL,deck TEXT NOT NULL,PRIMARY KEY(ref,kind,key));`);
    if(!store.db.prepare('PRAGMA table_info(biometric_accounts)').all().some(row=>row.name==='vault_origin'))
      store.db.exec('ALTER TABLE biometric_accounts ADD COLUMN vault_origin TEXT');
    this.timer=setInterval(()=>this.retry(),60000);
    this.timer.unref();
    queueMicrotask(()=>this.retry());
  }
  private row(person:Person) {return this.store.db.prepare('SELECT * FROM biometric_accounts WHERE org=? AND subject=?').get(person.org,person.subject) as Row|undefined;}
  private byRef(ref:string) {return this.store.db.prepare('SELECT * FROM biometric_accounts WHERE ref=?').get(ref) as Row|undefined;}
  private audit(ref:string,action:string,detail='') {
    this.store.db.prepare('INSERT INTO biometric_access(ref,action,at,detail) VALUES(?,?,?,?)').run(ref,action,new Date().toISOString(),detail);
  }
  private transition(ref:string,state:Row['state']) {
    this.store.db.prepare('UPDATE biometric_accounts SET state=? WHERE ref=?').run(state,ref);
  }
  async close() {this.closed=true;clearInterval(this.timer);this.shutdown.abort();await this.polling;await Promise.allSettled(this.drains.values());}
  retry() {
    if(this.closed) return;
    for(const row of this.store.db.prepare("SELECT ref FROM biometric_accounts WHERE state='deleting'").all()) void this.erase(String(row.ref));
    if(this.config && !this.polling) this.polling=this.checkRemoteRevocations().finally(()=>{this.polling=undefined;});
  }
  private async checkRemoteRevocations() {
    // Bound periodic work across tenants. Every actual render and delivery still checks the grant immediately.
    const rows=this.store.db.prepare("SELECT * FROM biometric_accounts WHERE state='active' AND ref>? ORDER BY ref LIMIT 24").all(this.cursor) as Row[];
    for(const row of rows) {
      if(this.closed) break;
      await this.check(row,'status').catch(()=>{});
      this.cursor=row.ref;
    }
    if(rows.length<24) this.cursor='';
  }
  summary(person:Person) {
    const row=this.row(person);
    return {configured:!!this.config,policy:this.config?.policy,state:row?.state ?? 'none' as const};
  }
  async status(person:Person) {
    const row=this.row(person);
    if(row && ['active','enrolling'].includes(row.state)) await this.check(row,'status');
    return this.summary(person);
  }
  active(ref:string) {return this.byRef(ref)?.state==='active';}
  identify(person:Person) {const row=this.row(person);return this.config && row?.state==='active' && row.policy===this.config.policy && row.vault_origin===this.config.base ? row.ref : undefined;}
  private async post(ref:string,path:string,data:Record<string,unknown>,signal?:AbortSignal) {
    if(!this.config || this.byRef(ref)?.vault_origin!==this.config.base) throw new ApiError(503,'The regional biometric operator is unavailable.');
    this.audit(ref,'operator.'+path);
    try {
      const response=await fetch(this.config.base+'/'+path,{method:'POST',redirect:'error',
        signal:AbortSignal.any([this.shutdown.signal,AbortSignal.timeout(10_000),...(signal ? [signal]:[])]),
        headers:{Authorization:'Bearer '+this.config.token,'Content-Type':'application/json'},
        body:JSON.stringify({subjectRef:ref,...data})});
      if(!response.ok) {await response.body?.cancel();throw Error();}
      const bytes=await readBounded(response,8192);
      if(!bytes) throw Error();
      return z.object({subjectRef:z.literal(ref)}).passthrough().parse(JSON.parse(bytes.toString()));
    } catch {signal?.throwIfAborted();throw new ApiError(503,'The regional biometric operator is unavailable.');}
  }
  async enroll(person:Person,policy:string) {
    if(!this.config || policy!==this.config.policy) throw new ApiError(409,'Review the current consent terms.');
    const previous=this.row(person);
    if(previous?.state==='deleting' || previous?.state==='active') throw new ApiError(409,'Review the current avatar status.');
    const ref=previous?.state==='enrolling' ? previous.ref : randomUUID();
    this.store.transaction(()=>{
      this.store.db.prepare('INSERT INTO biometric_accounts(org,subject,ref,state,policy,vault_origin) VALUES(?,?,?,?,?,?) ON CONFLICT(org,subject) DO UPDATE SET ref=excluded.ref,state=excluded.state,policy=excluded.policy,vault_origin=excluded.vault_origin')
        .run(person.org,person.subject,ref,'enrolling',policy,this.config!.base);
      this.audit(ref,'consent.accepted',policy);
    });
    const identityBinding=createHmac('sha256',this.config.token).update(JSON.stringify([person.org,person.subject])).digest('hex');
    const result=await this.post(ref,'enrollments',{consentVersion:policy,identityBinding});
    const url=z.url().parse(result.enrollmentUrl), link=new URL(url);
    if(link.origin!==new URL(this.config.base).origin || link.username || link.password || this.byRef(ref)?.state!=='enrolling')
      throw new ApiError(409,'Enrollment is unavailable.');
    return {enrollmentUrl:url};
  }
  private async check(row:Row,operation:string,context:Record<string,string>={},signal?:AbortSignal) {
    if(!this.config || row.policy!==this.config.policy) throw new ApiError(403,'Renew consent with the biometric operator.');
    const result=await this.post(row.ref,'authorizations',{operation,consentVersion:row.policy,...context},signal);
    const outcome=z.object({state:z.enum(['pending','active','revoked']),consentVersion:z.literal(row.policy),avatarId:id.optional()}).safeParse(result);
    if(!outcome.success) throw new ApiError(503,'The operator response could not be verified.');
    const persisted=this.byRef(row.ref);
    if(!persisted || !['enrolling','active'].includes(persisted.state)) throw new ApiError(403,'Avatar consent has been revoked.');
    if(outcome.data.state==='revoked') {
      this.hold(row.ref);void this.erase(row.ref);
      if(operation==='status') return;
      throw new ApiError(403,'Avatar consent has been revoked.');
    }
    if(outcome.data.state==='active' && outcome.data.avatarId) {
      this.transition(row.ref,'active');
      return outcome.data.avatarId;
    }
    if(operation==='status' && persisted.state==='enrolling') return;
    throw new ApiError(403,'Active avatar consent is required.');
  }
  async authorize(ref:string,operation:string,context:Record<string,string>,signal?:AbortSignal) {
    const row=this.byRef(ref);
    if(row?.state!=='active') throw new ApiError(403,'Active avatar consent is required.');
    const avatar=await this.check(row,operation,context,signal);
    if(!avatar) throw new ApiError(403,'Active avatar consent is required.');
    return avatar;
  }
  track(ref:string,kind:'scene'|'video',key:string,deck:string) {
    if(this.byRef(ref)?.state!=='active') throw new ApiError(403,'Avatar consent has been revoked.');
    this.store.db.prepare('INSERT OR IGNORE INTO biometric_artifacts VALUES(?,?,?,?)').run(ref,kind,key,deck);
    this.audit(ref,'use.'+kind,deck);
  }
  private hold(ref:string) {this.store.transaction(()=>{this.transition(ref,'deleting');this.audit(ref,'deletion.requested');});}
  async revoke(person:Person) {
    const row=this.row(person);
    if(!row || row.state==='deleted') return this.summary(person);
    if(row.state!=='deleting') this.hold(row.ref);
    await this.erase(row.ref);
    return this.summary(person);
  }
  private erase(ref:string):Promise<boolean> {
    const ongoing=this.drains.get(ref);
    if(ongoing) return ongoing;
    const task=(async()=>{
      await this.purgeLocal(ref);
      const row=this.byRef(ref);
      if(row?.state!=='deleting') return true;
      const result=await this.post(ref,'deletions',{deletionId:ref,scopes:erased});
      const receipt=z.object({deletionId:z.literal(ref),status:z.literal('deleted'),erased:z.array(z.enum(erased)),receipt:id}).safeParse(result);
      if(!receipt.success || !erased.every(scope=>receipt.data.erased.includes(scope))) return false;
      this.store.transaction(()=>{
        this.transition(ref,'deleted');
        this.store.db.prepare('DELETE FROM biometric_artifacts WHERE ref=?').run(ref);
        this.audit(ref,'deletion.confirmed',receipt.data.receipt);
      });
      return true;
    })().catch(()=>false).finally(()=>this.drains.delete(ref));
    this.drains.set(ref,task);return task;
  }
}
